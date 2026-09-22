#include "apple_live/owner/settings.hpp"

#include "apple_live/net/manager_hooks.hpp"

#include "apple/firmware/time_zones.hpp"

#include <Arduino.h>
#include <Preferences.h>

#include <cstdio>

namespace apple::live {
namespace {

Preferences settings_store;

}  // namespace

Settings settings;

// Resolves an IANA id through the Manager's table; false leaves the zone as is.
bool set_time_zone(const char* iana_id) {
  const apple::firmware::TimeZoneInfo* zone = apple::firmware::find_time_zone(iana_id);
  if (zone == nullptr) return false;
  std::snprintf(settings.time_zone, sizeof(settings.time_zone), "%s", zone->id);
  settings.posix_tz = zone->posix;
  return true;
}

void read_settings() {
  settings_store.begin("settings", false);
  const std::uint16_t raised = settings_store.getUShort("raised", settings.raised_seconds);
  settings.raised_seconds = raised < kRaisedSecondsMin ? kRaisedSecondsMin
                            : raised > kRaisedSecondsMax ? kRaisedSecondsMax
                                                         : raised;
  settings.motor = settings_store.getBool("motor", settings.motor);
  settings.follow = settings_store.getBool("follow", settings.follow);
  settings.sleep_display = settings_store.getBool("sleep", settings.sleep_display);
  settings.require_code = settings_store.getBool("lock", settings.require_code);
  manager.set_code_required(settings.require_code);
  const String zone = settings_store.getString("tz", "");
  if (!set_time_zone(zone.c_str())) set_time_zone(apple::firmware::kDefaultTimeZoneId);
  settings.tz_chosen = settings_store.getBool("tzset", false);
  const std::uint8_t bright = settings_store.getUChar("bright", settings.brightness);
  const std::uint8_t vol = settings_store.getUChar("volume", settings.volume);
  settings.volume = vol > 100 ? 100 : vol;
  settings.win_full_track = settings_store.getBool("winfull", settings.win_full_track);
  settings.auto_update = settings_store.getBool("autoupd", settings.auto_update);
  settings.beta = settings_store.getBool("beta", settings.beta);
  settings_store.getString("ghtok", settings.github_token, sizeof(settings.github_token));
  settings.brightness = bright < kBrightnessMin ? kBrightnessMin : bright > 100 ? 100 : bright;
}

void save_settings() {
  settings_store.putUShort("raised", settings.raised_seconds);
  settings_store.putBool("motor", settings.motor);
  settings_store.putBool("follow", settings.follow);
  settings_store.putBool("sleep", settings.sleep_display);
  settings_store.putBool("lock", settings.require_code);
  settings_store.putString("tz", settings.time_zone);
  settings_store.putBool("tzset", settings.tz_chosen);
  settings_store.putUChar("bright", settings.brightness);
  settings_store.putUChar("volume", settings.volume);
  settings_store.putBool("winfull", settings.win_full_track);
  settings_store.putBool("autoupd", settings.auto_update);
  settings_store.putBool("beta", settings.beta);
  settings_store.putString("ghtok", settings.github_token);
}

void reset_settings() {
  settings_store.clear();
  settings = Settings{};
  save_settings();
}

}  // namespace apple::live
