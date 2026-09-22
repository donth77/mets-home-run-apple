#include "apple_live/owner/owner_button.hpp"

#include "apple_live/display/celebration.hpp"
#include "apple_live/display/display.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/pins.hpp"
#include "apple_live/system/boot_guard.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <WiFi.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>

namespace apple::live {

using apple::firmware::ScreenState;
using apple::firmware::copy_text;
using apple::motion::Drive;

namespace {

constexpr std::uint32_t kResetHoldMs = 10'000;
constexpr std::uint32_t kResetShortPressMaxMs = 1'000;
// Between a short press and the factory-reset countdown sits the restart
// window: release there and the Apple reboots like the RESET pin, keeping
// Wi-Fi and every setting.
constexpr std::uint32_t kRestartHoldMaxMs = 3'000;
constexpr std::uint32_t kInfoScreenMs = 20'000;  // one short press shows the address and code

std::uint32_t button_down_since_ms = 0;
bool button_was_down = false;
std::int32_t reset_countdown_shown = -1;
bool restart_prompt_shown = false;
bool maintenance_prompt_shown = false;
std::int32_t maintenance_prompt_seconds = -1;
std::uint32_t info_screen_until_ms = 0;

void factory_reset() {
  manager.clear_maintenance();
  publish_trace("RESET", "button held: clearing Wi-Fi and settings");
  reset_settings();
  if (engine) engine->set_raised_dwell_ms(active_fixture ? apple::core::kRaisedDwellMs : static_cast<std::uint64_t>(settings.raised_seconds) * 1000);
  apply_drive(Drive::Off);
  on_forget_request();
}

// The middle hold, released inside the restart window: reboot exactly like
// the RESET pin. Wi-Fi credentials and settings live in NVS, so the Apple
// comes back on the same network.
void restart_from_button() {
  if (celebration_active || !motion_idle()) {
    // Same rule as the Manager page's restart: never reboot mid-celebration.
    copy_text(model.waiting_title, sizeof(model.waiting_title), "CELEBRATING");
    copy_text(model.waiting_note, sizeof(model.waiting_note), "TRY AFTER THE PLAY");
    show_waiting("NOT NOW", apple::firmware::kDelayYellow, apple::firmware::WaitingIcon::Alert);
    info_screen_until_ms = now32() + 2500;
    return;
  }
  publish_trace("RESET", "button held: restarting, wi-fi kept");
  copy_text(model.waiting_title, sizeof(model.waiting_title), "BACK IN A MOMENT");
  copy_text(model.waiting_note, sizeof(model.waiting_note), "WI-FI SETTINGS KEPT");
  show_waiting("RESTARTING");
  request_restart(700);
}

}  // namespace

void begin_owner_button() {
  pinMode(kResetButtonPin, INPUT_PULLUP);
}

// One short press of the button. The name to type is the big orange line;
// the numeric address underneath is the fallback for a phone that will not
// resolve it, and the password is what the Manager asks for.
void show_info_screen() {
  const bool connected = WiFi.status() == WL_CONNECTED;
  char note[sizeof(model.waiting_note)];
  if (connected) {
    copy_text(model.waiting_title, sizeof(model.waiting_title), "OPEN IN BROWSER");
    std::snprintf(note, sizeof(note), "OR %s|PASSWORD %s", WiFi.localIP().toString().c_str(),
                  credentials.setup_key().c_str());
    copy_text(model.waiting_note, sizeof(model.waiting_note), note);
    copy_text(model.status_message, sizeof(model.status_message), "home-run-apple.local");
    model.state = ScreenState::Info;
    request_redraw();
  } else {
    copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
    std::snprintf(note, sizeof(note), "NOT ON WI-FI|PASSWORD %s", credentials.setup_key().c_str());
    copy_text(model.waiting_note, sizeof(model.waiting_note), note);
    show_waiting("SETUP NEEDED");
  }
  info_screen_until_ms = now32() + kInfoScreenMs;
}

// Apple Lab asked for a hardware test. Tell the person at the box what the
// next button tap approves, count the presence window down, and take the
// prompt away again if nobody answers, so the request cannot linger on
// screen and a later tap never approves something nobody remembers asking for.
void service_maintenance_prompt() {
  const bool pending = manager.maintenance_pending() && !celebration_active && motion_idle();
  if (pending) {
    const auto seconds = static_cast<std::int32_t>((manager.maintenance_remaining_ms() + 999) / 1000);
    if (!maintenance_prompt_shown || seconds != maintenance_prompt_seconds) {
      maintenance_prompt_shown = true;
      maintenance_prompt_seconds = seconds;
      char note[sizeof(model.waiting_note)];
      std::snprintf(note, sizeof(note), "APPLE WILL MOVE|CANCELS IN %u S",
                    static_cast<unsigned>(std::min<std::int32_t>(seconds, 99)));
      copy_text(model.waiting_title, sizeof(model.waiting_title), "APPLE LAB TEST");
      copy_text(model.waiting_note, sizeof(model.waiting_note), note);
      show_waiting("TAP BUTTON TO APPROVE", apple::firmware::kMetsOrange, apple::firmware::WaitingIcon::Alert);
      info_screen_until_ms = 0;
    }
    return;
  }
  if (maintenance_prompt_shown) {
    // Expired or cancelled without a tap; a confirmed tap clears the flag
    // itself and leaves its own 5 s card up.
    maintenance_prompt_shown = false;
    maintenance_prompt_seconds = -1;
    if (info_screen_until_ms == 0) restore_default_screen();
  }
}

void service_reset_button() {
  const bool down = digitalRead(kResetButtonPin) == LOW;
  const std::uint32_t now = now32();
  if (down && !button_was_down) {
    button_down_since_ms = now;
    reset_countdown_shown = -1;
    restart_prompt_shown = false;
  }
  if (down) {
    const std::uint32_t held = now - button_down_since_ms;
    if (held >= kResetShortPressMaxMs && held < kRestartHoldMaxMs) {
      if (!restart_prompt_shown) {
        restart_prompt_shown = true;
        copy_text(model.waiting_title, sizeof(model.waiting_title), "RELEASE TO RESTART");
        copy_text(model.waiting_note, sizeof(model.waiting_note), "KEEPS WI-FI|KEEP HOLDING TO RESET WI-FI");
        show_waiting("RESTART");
      }
    } else if (held >= kRestartHoldMaxMs) {
      const std::int32_t remaining = static_cast<std::int32_t>((kResetHoldMs - std::min(held, kResetHoldMs) + 999) / 1000);
      if (remaining != reset_countdown_shown) {
        reset_countdown_shown = remaining;
        char status[24];
        std::snprintf(status, sizeof(status), "RESET IN %ld", static_cast<long>(remaining));
        copy_text(model.waiting_title, sizeof(model.waiting_title), "HOLD TO RESET");
        copy_text(model.waiting_note, sizeof(model.waiting_note), "RELEASE TO CANCEL");
        show_waiting(status, apple::firmware::kErrorRed, apple::firmware::WaitingIcon::Alert);
      }
      if (held >= kResetHoldMs) {
        button_was_down = false;
        button_down_since_ms = now;
        factory_reset();
        return;
      }
    }
  } else if (button_was_down) {
    const std::uint32_t held = now - button_down_since_ms;
    if (held < kResetShortPressMaxMs) {
      if (engine && !engine->fault_latched() && !celebration_active && motion_idle() &&
          !replay_active && !manager.update_in_progress() && manager.confirm_maintenance()) {
        maintenance_prompt_shown = false;
        copy_text(model.waiting_title, sizeof(model.waiting_title), "APPLE LAB TEST");
        copy_text(model.waiting_note, sizeof(model.waiting_note), "STARTING - STAND CLEAR");
        show_waiting("APPROVED", apple::firmware::kMetsOrange, apple::firmware::WaitingIcon::Alert);
        info_screen_until_ms = now + 5000;
      } else {
        show_info_screen();
      }
    } else if (held < kRestartHoldMaxMs) {
      restart_from_button();
    } else {
      // Released during the countdown: cancel and put the current screen back.
      info_screen_until_ms = 0;
      restore_default_screen();
    }
  }
  button_was_down = down;
  if (info_screen_until_ms != 0 && due(info_screen_until_ms)) {
    info_screen_until_ms = 0;
    restore_default_screen();
  }
}

}  // namespace apple::live
