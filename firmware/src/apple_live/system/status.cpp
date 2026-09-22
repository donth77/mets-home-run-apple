#include "apple_live/system/status.hpp"

#include "apple_live/audio/card.hpp"
#include "apple_live/audio/player.hpp"
#include "apple_live/audio/track_library.hpp"
#include "apple_live/display/celebration.hpp"
#include "apple_live/display/display.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/live_feed.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/motion/ledger.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/net/updates.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/celebration_history.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/boot_guard.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/psram.hpp"
#include "apple_live/system/trace.hpp"
#include "apple_live/version.hpp"

#include "apple/firmware/firmware_update.hpp"
#include "apple/firmware/lab_fixtures.generated.hpp"
#include "apple/firmware/next_tracks.hpp"
#include "apple/firmware/screens.hpp"
#include "apple/firmware/status_snapshot.hpp"
#include "apple/firmware/time_zones.hpp"

#include <Arduino.h>
#include <WiFi.h>

#include <algorithm>
#include <cstdint>

namespace apple::live {

using apple::core::SequenceState;
using apple::firmware::ScreenState;
using apple::game_state::GameSnapshot;
using apple::motion::Drive;

namespace {

TaskHandle_t loop_task = nullptr;

// What the panel is showing, for Apple Lab to mirror. Card screens carry
// their text so the Lab can paint the same card with the shared renderer.
const char* screen_state_name(ScreenState state) {
  switch (state) {
    case ScreenState::Waiting: return "WAITING";
    case ScreenState::Game: return "GAME";
    case ScreenState::Upcoming: return "UPCOMING";
    case ScreenState::Offseason: return "OFFSEASON";
    case ScreenState::GenericDelay: return "DELAY";
    case ScreenState::RainDelay: return "RAIN_DELAY";
    case ScreenState::Review: return "REVIEW";
    case ScreenState::Suspended: return "SUSPENDED";
    case ScreenState::Postponed: return "POSTPONED";
    case ScreenState::Cancelled: return "CANCELLED";
    case ScreenState::Final: return "FINAL";
    case ScreenState::Setup: return "SETUP";
    case ScreenState::Info: return "INFO";
    case ScreenState::SetupQr: return "SETUP_QR";
  }
  return "WAITING";
}

const char* device_mode() {
  if (safe_mode) return "SAFE_MODE";
  if (engine && engine->fault_latched()) return "SAFE_FAULT";
  if (!settings.follow && !replay_active) return "PAUSED";
  if (replay_active) return "REPLAY";
  if (celebration_active) return "CELEBRATING";
  if (!credentials.configured() || net_state == NetState::Failed) return "SETUP";
  if (net_state != NetState::Connected) return "OFFLINE";
  if (!game) return "BETWEEN_GAMES";
  if (!projector.has_projection()) {
    return apple::mlb_feed::should_poll(*game, wall_epoch(), kPregameLeadSeconds) ? "BOOTSTRAPPING" : "UPCOMING";
  }
  return phase_name(projector.snapshot().phase);
}

}  // namespace

void note_loop_task() { loop_task = xTaskGetCurrentTaskHandle(); }

void publish_hello() {
  Serial.printf(
      "APPLE_LIVE:{\"type\":\"hello\",\"profile\":\"%s\",\"firmwareVersion\":\"%s\","
      "\"motion\":\"%s\",\"wifiConfigured\":%s,\"hostname\":\"%s\",\"psram\":%s,"
      "\"setupKey\":\"%s\","
      "\"leadInMs\":%lu,\"dwellMs\":%lu,\"deadlineMs\":%lu}\n",
      kProfileName, kFirmwareVersion, settings.motor ? "L298N" : "RECORDING",
      credentials.configured() ? "true" : "false", kHostname,
      psramFound() ? "true" : "false", credentials.setup_key().c_str(),
      static_cast<unsigned long>(apple::core::kCelebrationLeadInMs),
      static_cast<unsigned long>(settings.raised_seconds) * 1000UL,
      static_cast<unsigned long>(apple::core::kMotionDeadlineMs));
}

void fill_status(JsonDocument& doc) {
  const bool connected = WiFi.status() == WL_CONNECTED;
  const std::uint64_t now = now_ms();
  doc["type"] = "status";
  auto fixture = doc["fixture"].to<JsonObject>();
  fixture["version"] = 1;
  fixture["scenarioId"] = fixture_id;
  fixture["state"] = fixture_state;
  fixture["frame"] = active_fixture ? replay_step : 0;
  fixture["totalFrames"] = active_fixture ? active_fixture->frames.size() : 0;
  manager.fill_maintenance_status(doc["maintenance"].to<JsonObject>());
  doc["mode"] = device_mode();
  doc["firmwareVersion"] = kFirmwareVersion;
  doc["hostname"] = kHostname;
  doc["motion"] = settings.motor ? "L298N" : "RECORDING";
  doc["firmwareSlot"] = apple::firmware::running_partition_label();
  doc["uptimeMs"] = now32();
  doc["resetReason"] = reset_reason_name();
  doc["updatePending"] = update_pending_boot;
  JsonObject owner = doc["settings"].to<JsonObject>();
  owner["raisedSeconds"] = settings.raised_seconds;
  owner["motor"] = settings.motor;
  owner["follow"] = settings.follow;
  owner["sleepDisplay"] = settings.sleep_display;
  owner["requireCode"] = settings.require_code;
  owner["timeZone"] = settings.time_zone;
  const apple::firmware::TimeZoneInfo* zone = apple::firmware::find_time_zone(settings.time_zone);
  owner["timeZoneLabel"] = zone ? zone->label : "";
  owner["timeZoneChosen"] = settings.tz_chosen;
  owner["brightness"] = settings.brightness;
  owner["volume"] = settings.volume;
  owner["winFullTrack"] = settings.win_full_track;
  owner["autoUpdate"] = settings.auto_update;
  owner["beta"] = settings.beta;
  owner["tokenSet"] = settings.github_token[0] != '\0';
  JsonObject audio = doc["audio"].to<JsonObject>();
  audio["card"] = audio_card_ready;
  audio["playing"] = audio_playing;
  audio["batter"] = current_batter;
  audio["maxTracks"] = kMaxTracks;
  // What is already in memory for the next celebration, so the page can mark
  // a queued track as ready to play.
  audio["readyHr"] = resident_home_run.name;
  audio["readyWin"] = resident_win.name;
  audio["maxNext"] = apple::firmware::kMaxNextPerLine;
  audio["maxNextAll"] = apple::firmware::kMaxNextTracks;
  // The lists themselves come from /api/audio/library. The counts are for
  // the Lab's overview, which only needs the totals.
  audio["rev"] = audio_rev;
  std::uint8_t hr_count = 0;
  std::uint8_t win_count = 0;
  for (std::uint8_t i = 0; i < track_count; ++i) {
    if (tracks[i].home_run) ++hr_count;
    if (tracks[i].win) ++win_count;
  }
  audio["count"] = track_count;
  audio["countHr"] = hr_count;
  audio["countWin"] = win_count;
  JsonObject rel = doc["update"].to<JsonObject>();
  rel["state"] = release_state_name(release.state);
  rel["version"] = release.pick.found ? release.pick.version.c_str() : "";
  rel["prerelease"] = release.pick.found && release.pick.prerelease;
  rel["size"] = release.pick.found ? release.pick.asset_size : 0;
  rel["checkedAt"] = release.checked_at;
  rel["nextCheckIn"] = release.next_check_ms == 0 ? -1 : std::max<std::int32_t>(0, static_cast<std::int32_t>(release.next_check_ms - now32())) / 1000;
  rel["error"] = release.error;
  rel["windowOpen"] = install_window_open();
  if (last_celebration.at != 0) {
    JsonObject last = doc["lastCelebration"].to<JsonObject>();
    last["kind"] = last_celebration.kind;
    last["subject"] = last_celebration.subject;
    last["at"] = last_celebration.at;
    last["moved"] = last_celebration.moved;
    last["outcome"] = last_celebration.outcome;
    last["track"] = last_celebration.track;
  }
  // The page shows the code once when the owner turns the lock on; with the
  // lock off anyone on the network could change settings anyway.
  owner["setupKey"] = settings.require_code ? String() : credentials.setup_key();
  owner["backlight"] = backlight_on;
  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["configured"] = credentials.configured();
  wifi["state"] = net_state_name();
  wifi["ssid"] = credentials.ssid();
  wifi["rssi"] = connected ? WiFi.RSSI() : 0;
  wifi["ip"] = connected ? WiFi.localIP().toString() : String("");
  wifi["setupNetwork"] = manager.setup_network_active();
  wifi["setupClients"] = manager.setup_clients();
  wifi["scanning"] = manager.scanning();
  wifi["networksFound"] = manager.network_count();
  doc["clock"] = clock_valid();
  {
    JsonObject screen = doc["screen"].to<JsonObject>();
    screen["state"] = celebration_active ? "CELEBRATION" : screen_state_name(model.state);
    screen["title"] = model.waiting_title;
    screen["status"] = model.status_message;
    screen["note"] = model.waiting_note;
    screen["accent"] = model.waiting_accent;
    screen["statusColor"] = model.status_color;
    screen["icon"] = static_cast<unsigned>(model.waiting_icon);
  }
  doc["heapFree"] = ESP.getFreeHeap();
  doc["heapLargest"] = ESP.getMaxAllocHeap();
  doc["psramFree"] = ESP.getFreePsram();
  // The least stack each task has had free since boot, in bytes. Both have
  // 8 KB; a figure near zero means the next deep call path could overflow.
  JsonObject stack = doc["stackFree"].to<JsonObject>();
  stack["loop"] = loop_task != nullptr ? static_cast<std::uint32_t>(uxTaskGetStackHighWaterMark(loop_task)) : 0;
  stack["audio"] = audio_task_stack_free();
  if (game) {
    JsonObject node = doc["game"].to<JsonObject>();
    node["gamePk"] = game->game_pk;
    node["gameNumber"] = game->game_number;
    node["away"] = game->away.abbreviation;
    node["home"] = game->home.abbreviation;
    node["scheduled"] = game->game_date;
    node["state"] = game->detailed_state;
  } else {
    doc["game"] = nullptr;
  }
  if (projector.has_projection()) {
    const GameSnapshot& snapshot =
        replay_active && replay_score.active ? with_replay_score(projector.snapshot()) : projector.snapshot();
    JsonObject node = doc["snapshot"].to<JsonObject>();
    apple::firmware::write_status_snapshot(node, snapshot);
    node["cursor"] = tracker.cursor();
  } else {
    doc["snapshot"] = nullptr;
  }
  JsonObject poll = doc["poll"].to<JsonObject>();
  poll["ok"] = polls_ok;
  poll["failed"] = polls_failed;
  poll["lastMs"] = last_poll_duration_ms;
  poll["lastBytes"] = last_poll_bytes;
  poll["nextInMs"] = static_cast<std::int32_t>(next_poll_ms - now32());
  poll["lastError"] = last_error;
  JsonObject sched = doc["schedule"].to<JsonObject>();
  sched["ok"] = schedule_ok;
  sched["failed"] = schedule_failed;
  sched["lastMs"] = last_schedule_ms;
  sched["lastError"] = last_schedule_error;
  sched["checkedAgoMs"] = schedule_ok ? static_cast<std::int32_t>(now32() - last_schedule_ok_ms) : -1;
  sched["nextInMs"] = static_cast<std::int32_t>(next_schedule_ms - now32());
  sched["refreshMs"] = schedule_refresh_ms;
  sched["games"] = static_cast<std::uint32_t>(schedule.size());
  doc["ledger"] = nvs_ledger.count();
  doc["sequence"] = apple::core::sequence_state_name(engine ? engine->sequence_state() : SequenceState::Idle);
  doc["fault"] = engine && engine->fault_latched();
  doc["drive"] = apple::motion::drive_name(applied_drive);
  doc["positionMm"] = actuator.estimated_position_mm(now);
  doc["ena"] = settings.motor && applied_drive != Drive::Off ? 1 : 0;
  doc["in1"] = settings.motor && applied_drive == Drive::Extend ? 1 : 0;
  doc["in2"] = settings.motor && applied_drive == Drive::Retract ? 1 : 0;
}

void publish_status() {
  JsonDocument doc(&json_allocator);
  fill_status(doc);
  Serial.print("APPLE_LIVE:");
  serializeJson(doc, Serial);
  Serial.println();
}

}  // namespace apple::live
