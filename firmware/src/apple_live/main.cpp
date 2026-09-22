// Autonomous Home Run Apple target.
//
// On first boot it opens its own setup network; the owner joins it from a
// phone and the captive Apple Manager page takes the home Wi-Fi credentials,
// which live in the board's flash from then on. The Apple then polls the MLB
// Stats API over certificate-validated HTTPS and runs the shared C++ pipeline
// on the board: feed adapter -> game-state projector -> decision core ->
// screens, celebration animations, and the timed motion model. The L298N is
// driven whenever the owner's Motor setting is on, which is the default; with
// it off the model still runs and reports positions, but the pins stay LOW.
//
// Serial keys: `?` status, `x` stop motion (faults remain latched),
// `s` refresh the schedule now, `p` poll the feed now, `w` forget the saved
// Wi-Fi network and reopen the setup network.
//
// The program is split by subsystem under src/apple_live/: audio/ (the card,
// playback and the track library), display/ (the panel, its screens and the
// celebration), game/ (the schedule, the live feed and replays), motion/ (the
// decision core and the lift), net/ (Wi-Fi, HTTPS, the Manager and updates),
// owner/ (settings and the owner button) and system/ (clock, memory, traces,
// boot guard, serial and status). This file only starts them and runs the loop.

#include "apple_live/audio/card.hpp"
#include "apple_live/audio/player.hpp"
#include "apple_live/audio/track_library.hpp"
#include "apple_live/display/celebration.hpp"
#include "apple_live/display/display.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/motion/ledger.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/net/updates.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/owner_button.hpp"
#include "apple_live/owner/owner_settings.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/boot_guard.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/serial_commands.hpp"
#include "apple_live/system/status.hpp"
#include "apple_live/system/trace.hpp"
#include "apple_live/version.hpp"

#include "apple/firmware/board_pins.hpp"
#include "apple/firmware/firmware_update.hpp"
#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <esp_task_wdt.h>

#include <cstdint>
#include <cstdio>

namespace apple::live {

using apple::firmware::copy_text;
using apple::motion::Drive;

namespace {

constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr std::uint32_t kLoopPeriodMs = 10;
constexpr std::uint32_t kWatchdogSeconds = 90;
constexpr std::uint32_t kStatusPeriodMs = 30'000;
std::uint32_t next_status_ms = 0;

}  // namespace
}  // namespace apple::live

void setup() {
  using namespace apple::live;
  apple::firmware::disarm_motion_outputs();
  begin_owner_button();

  Serial.begin(115200);
  const std::uint32_t serial_wait_started_ms = millis();
  while (!Serial && millis() - serial_wait_started_ms < kSerialWaitTimeoutMs) delay(10);

  {
    char detail[sizeof(TraceEntry::detail)];
    std::snprintf(detail, sizeof(detail), "reset: %s; firmware %s on %s", reset_reason_name(), kFirmwareVersion,
                  apple::firmware::running_partition_label());
    publish_trace("BOOT", detail);
  }
  begin_trace_log();
  allocate_track_library();
  begin_display();
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  model.waiting_note[0] = '\0';
  show_waiting("STARTING");
  render_if_needed();
  nvs_ledger.begin();
  load_settings();
  apply_backlight();
  make_engine(nvs_ledger);
  apply_drive(Drive::Off);

  // Audio. A missing card, or a card with no tracks, simply means silent
  // celebrations.
  begin_audio_output();
  // The boot guard and the watchdog come before anything that can block. A
  // hang in the card scan once stranded the Apple on a bad image because the
  // guard had not yet counted the boot and the watchdog was not yet armed.
  guard_boot();
  esp_task_wdt_init(kWatchdogSeconds, true);
  esp_task_wdt_add(nullptr);

  begin_card_bus();
  mount_audio_card();
  start_audio_task();
  note_loop_task();

  credentials.begin();  // so the hello below reports the saved network truthfully
  publish_hello();
  Serial.printf("APPLE_LIVE=READY COMMANDS=?:status x:stop s:schedule p:poll w:forget_wifi MOTOR=%s\n",
                settings.motor ? "on" : "off");
  if (safe_mode) {
    publish_trace("SAFE_MODE", "repeated early crashes; network and Manager skipped, reflash with pio");
    copy_text(model.waiting_title, sizeof(model.waiting_title), "SAFE MODE");
    copy_text(model.waiting_note, sizeof(model.waiting_note), "REFLASH OVER USB|THEN RESET");
    show_waiting("STARTUP CRASHED", apple::firmware::kErrorRed, apple::firmware::WaitingIcon::Alert);
  } else {
    start_wifi();
  }
  publish_status();
  next_status_ms = now32() + kStatusPeriodMs;
}

void loop() {
  using namespace apple::live;
  esp_task_wdt_reset();
  const std::uint64_t now = now_ms();
  service_boot_guard(now);
  handle_serial();
  service_audio();
  service_wifi();
  service_motion(now);
  service_replay();
  service_audio();
  service_network();
  service_release();
  if (celebration_active) {
    service_celebration();
  } else {
    render_if_needed();
  }
  service_backlight();
  service_panel_refresh();
  service_setup_screen();
  service_reset_button();
  service_maintenance_prompt();
  update_idle_note(false);
  if (due(next_status_ms)) {
    next_status_ms = now32() + kStatusPeriodMs;
    publish_status();
  }
  delay(manager.setup_network_active() ? 1 : kLoopPeriodMs);
}
