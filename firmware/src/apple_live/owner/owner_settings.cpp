#include "apple_live/owner/owner_settings.hpp"

#include "apple_live/audio/player.hpp"
#include "apple_live/audio/track_library.hpp"
#include "apple_live/display/display.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/net/updates.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/celebration_history.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/firmware/screens.hpp"

#include <Arduino.h>

#include <cstdio>
#include <cstdlib>
#include <ctime>

namespace apple::live {

using apple::firmware::ScreenState;
using apple::firmware::copy_text;
using apple::motion::Drive;

void load_settings() {
  read_settings();
  apply_time_zone();
  load_celebration_history();
}

// Pushes the chosen zone into the C library and refreshes anything that
// printed a local time: the next-game card and the schedule day window.
void apply_time_zone() {
  setenv("TZ", settings.posix_tz, 1);
  tzset();
  if (game && model.state == ScreenState::Upcoming) show_upcoming(*game);
  if (net_state == NetState::Connected) next_schedule_ms = now32();
  request_redraw();
}

String on_settings(const apple::firmware::SettingsUpdate& update) {
  if (update.raised_seconds >= 0 &&
      (update.raised_seconds < kRaisedSecondsMin || update.raised_seconds > kRaisedSecondsMax)) {
    return "RAISED_RANGE";
  }
  if (update.raised_seconds >= 0) {
    settings.raised_seconds = static_cast<std::uint16_t>(update.raised_seconds);
    // A celebration under way keeps the hold it started with (a streamed win
    // holds for the whole song); the engine picks the new value up at idle.
    if (engine && motion_idle()) apply_raised_dwell();
  }
  if (update.motor >= 0) {
    if (active_fixture) stop_lab_fixture();
    manager.clear_maintenance();
    settings.motor = update.motor == 1;
    apply_drive(settings.motor ? applied_drive : Drive::Off);
  }
  if (update.follow >= 0 && (update.follow == 1) != settings.follow) {
    if (update.follow == 1) {
      resume_following();
    } else {
      pause_following();
    }
  }
  if (update.sleep >= 0) settings.sleep_display = update.sleep == 1;
  if (update.lock >= 0) {
    settings.require_code = update.lock == 1;
    manager.set_code_required(settings.require_code);
  }
  if (update.win_full >= 0) settings.win_full_track = update.win_full == 1;
  if (update.volume >= 0) {
    if (update.volume > 100) return "VOLUME_RANGE";
    const bool changed = settings.volume != static_cast<std::uint8_t>(update.volume);
    settings.volume = static_cast<std::uint8_t>(update.volume);
    // What is already in memory was scaled at the old level, so fetch it again.
    if (changed) {
      resident_home_run.name[0] = '\0';
      resident_win.name[0] = '\0';
      resident_refresh_wanted = true;
      save_audio_manifest();
    }
  }
  if (update.brightness >= 0) {
    if (update.brightness < kBrightnessMin || update.brightness > 100) return "BRIGHTNESS_RANGE";
    settings.brightness = static_cast<std::uint8_t>(update.brightness);
    apply_backlight();
  }
  if (update.time_zone.length() > 0) {
    if (!set_time_zone(update.time_zone.c_str())) return "TIME_ZONE";
    settings.tz_chosen = true;
    apply_time_zone();
  }
  if (update.auto_update >= 0) settings.auto_update = update.auto_update == 1;
  if (update.beta >= 0) {
    settings.beta = update.beta == 1;
    release.check_requested = true;  // the answer may change
  }
  if (update.token_given) {
    if (update.github_token.length() >= sizeof(settings.github_token)) return "TOKEN_LENGTH";
    copy_text(settings.github_token, sizeof(settings.github_token), update.github_token.c_str());
    release.check_requested = true;
  }
  save_settings();
  char detail[160];
  std::snprintf(detail, sizeof(detail),
                "raised=%us motor=%s follow=%s sleep=%s lock=%s tz=%s bright=%u auto=%s beta=%s token=%s",
                static_cast<unsigned>(settings.raised_seconds), settings.motor ? "on" : "off",
                settings.follow ? "auto" : "paused", settings.sleep_display ? "on" : "off",
                settings.require_code ? "on" : "off", settings.time_zone,
                static_cast<unsigned>(settings.brightness), settings.auto_update ? "on" : "off",
                settings.beta ? "on" : "off", settings.github_token[0] ? "set" : "none");
  publish_trace("SETTINGS", detail);
  request_redraw();
  return String();
}

}  // namespace apple::live
