#include "apple_live/game/replay.hpp"

#include "apple_live/audio/player.hpp"
#include "apple_live/display/celebration.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/live_feed.hpp"
#include "apple_live/motion/ledger.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/psram.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/core/evidence_bridge.hpp"
#include "apple/firmware/lab_fixtures.generated.hpp"
#include "../../../fixtures/mlb/fixtures.hpp"

#include <Arduino.h>
#include <ArduinoJson.h>

#include <cstddef>
#include <cstdint>

namespace apple::live {

using apple::game_state::GameSnapshot;
using apple::mlb_feed::ScheduleGame;
using apple::motion::Drive;

namespace {

constexpr std::int64_t kReplayGamePk = 822929;

std::uint32_t fixture_started_ms = 0;
std::uint32_t next_replay_ms = 0;

struct ReplayStep {
  const char* name;
  const char* feed;
  std::uint32_t delay_ms;
};
const ReplayStep kReplay[] = {
    {"pregame", apple::fixtures::mlb::k_822929_pregame, 0},
    {"first pitch", apple::fixtures::mlb::k_822929_hr_pending, 4'000},
    {"Lindor home run", apple::fixtures::mlb::k_822929_hr, 4'000},
    {"fourth inning", apple::fixtures::mlb::k_822929_live_mid, 55'000},
    {"final", apple::fixtures::mlb::k_822929_final, 8'000},
};
// A Mets win, 2026-09-02 at Tampa Bay, 6-4 in the sixth then 10-4 final.
const ReplayStep kWinReplay[] = {
    {"ninth inning", apple::fixtures::mlb::k_822931_live, 0},
    {"final, Mets win", apple::fixtures::mlb::k_822931_final, 6'000},
};
const ReplayStep* replay_table = kReplay;
std::size_t replay_count = sizeof(kReplay) / sizeof(kReplay[0]);

}  // namespace

const apple::firmware::LabFixture* active_fixture = nullptr;
const char* fixture_state = "IDLE";
String fixture_id;
bool replay_active = false;
std::size_t replay_step = 0;
ReplayScore replay_score;

namespace {

void finish_replay(const char* status) {
  if (!replay_active) return;
  replay_active = false;
  replay_score.active = false;
  Serial.printf("APPLE_LIVE:{\"type\":\"replay\",\"status\":\"%s\"}\n", status);
  make_engine(nvs_ledger);
  tracker.reset();
  projector = apple::game_state::Projector{};  // drop the replay's scoreboard
  game.reset();
  reset_final_tracking();
  next_schedule_ms = now32();
  if (net_state != NetState::Connected) {
    if (manager.setup_network_active()) {
      show_setup_screen();
    } else {
      show_joining_screen();
    }
  }
}

}  // namespace

// A win replay asked to show a real game's ending: the recorded game supplies
// the plays, this puts the requested teams and score on every screen.
GameSnapshot with_replay_score(const GameSnapshot& snapshot) {
  GameSnapshot shown = snapshot;
  shown.away.abbreviation = replay_score.away;
  shown.away.runs = static_cast<std::int32_t>(replay_score.away_runs);
  shown.away.id = replay_score.mets_home ? 0 : apple::mlb_feed::kMetsTeamId;
  shown.home.abbreviation = replay_score.home;
  shown.home.runs = static_cast<std::int32_t>(replay_score.home_runs);
  shown.home.id = replay_score.mets_home ? apple::mlb_feed::kMetsTeamId : 0;
  if (replay_score.venue[0] != '\0') shown.venue = replay_score.venue;
  if (replay_score.away_name[0] != '\0') shown.away.name = replay_score.away_name;
  if (replay_score.home_name[0] != '\0') shown.home.name = replay_score.home_name;
  return shown;
}

void start_replay(bool win) {
  if (replay_active) return;
  replay_table = win ? kWinReplay : kReplay;
  replay_count = win ? sizeof(kWinReplay) / sizeof(kWinReplay[0]) : sizeof(kReplay) / sizeof(kReplay[0]);
  if (!motion_idle()) {
    publish_trace("REPLAY", "refused: sequence active");
    return;
  }
  replay_active = true;
  replay_step = 0;
  next_replay_ms = now32();
  replay_ledger.clear();
  make_engine(replay_ledger);
  tracker.reset();
  reset_final_tracking();
  ScheduleGame replay_game;
  replay_game.game_pk = kReplayGamePk;
  replay_game.game_number = 1;
  replay_game.game_date = "2026-09-01T22:40:00Z";
  replay_game.abstract_state = "Live";
  replay_game.detailed_state = "In Progress";
  replay_game.venue = "Tropicana Field";
  replay_game.away = {121, "NYM", "New York Mets"};
  replay_game.home = {139, "TB", "Tampa Bay Rays"};
  if (win && replay_score.active) {
    if (replay_score.venue[0] != '\0') replay_game.venue = replay_score.venue;
    replay_game.away = {replay_score.mets_home ? 0 : 121, replay_score.away,
                        replay_score.away_name[0] ? replay_score.away_name : replay_score.away};
    replay_game.home = {replay_score.mets_home ? 121 : 0, replay_score.home,
                        replay_score.home_name[0] ? replay_score.home_name : replay_score.home};
  }
  game = replay_game;
  Serial.println("APPLE_LIVE:{\"type\":\"replay\",\"status\":\"STARTED\"}");
}

String start_lab_fixture(const String& id) {
  if (!engine || engine->fault_latched() || replay_active || !motion_idle() || actuator.busy() ||
      actuator.estimated_position_mm(now_ms()) != 0 || manager.update_in_progress()) return "BUSY";
  const auto* selected = apple::firmware::find_lab_fixture(id.c_str());
  if (!selected || selected->frames.empty()) return "BAD_FIXTURE";
  if (!settings.motor) return "MOTOR_DISABLED";
  replay_active = true;
  active_fixture = selected;
  fixture_id = id;
  fixture_state = "RUNNING";
  replay_step = 0;
  fixture_started_ms = now32();
  game.reset();
  replay_ledger.clear();
  make_engine(replay_ledger);
  engine->set_raised_dwell_ms(apple::core::kRaisedDwellMs);
  projector = apple::game_state::Projector{};
  tracker.reset();
  reset_final_tracking();
  return String();
}

String stop_lab_fixture() {
  if (!active_fixture) return String();
  const auto now = now_ms();
  const bool home = motion_idle() && !actuator.busy() && actuator.estimated_position_mm(now) == 0;
  if (!home && engine) {
    handle_output(engine->report_motion_fault("FIXTURE_CANCELLED", now), now);
    actuator.tick(now);
    apply_drive(Drive::Off);
    end_celebration("FIXTURE_CANCELLED");
  }
  active_fixture = nullptr;
  fixture_state = "CANCELLED";
  if (home) finish_replay("CANCELLED");
  else { replay_active = false; tracker.reset(); }
  return String();
}

void service_replay() {
  if (!replay_active) return;
  if (active_fixture) {
    if (engine && engine->fault_latched()) {
      active_fixture = nullptr; fixture_state = "FAILED"; replay_active = false; return;
    }
    const auto elapsed = now32() - fixture_started_ms;
    if (elapsed > 180000) { stop_lab_fixture(); fixture_state = "FAILED"; return; }
    while (replay_step < active_fixture->frames.size() && elapsed >= active_fixture->frames[replay_step].at_ms) {
      const auto& frame = active_fixture->frames[replay_step++].frame;
      if (!projector.replace(frame)) { stop_lab_fixture(); fixture_state = "FAILED"; return; }
      note_batter(projector.snapshot());
      const auto now = now_ms();
      handle_output(engine->ingest(apple::core::to_input_envelope(projector.decision_evidence()), now), now);
      show_snapshot(projector.snapshot());
    }
    if (replay_step == active_fixture->frames.size() && elapsed >= active_fixture->duration_ms && motion_idle()) {
      active_fixture = nullptr; fixture_state = "COMPLETED"; finish_replay("COMPLETED");
    }
    return;
  }
  if (replay_step >= replay_count) {
    if (motion_idle()) finish_replay("COMPLETED");
    return;
  }
  if (!due(next_replay_ms) || !motion_idle()) return;
  const ReplayStep& step = replay_table[replay_step];
  JsonDocument filter;
  deserializeJson(filter, apple::mlb_feed::live_feed_filter_json());
  JsonDocument doc(&json_allocator);
  const ArduinoJson::DeserializationError error =
      deserializeJson(doc, step.feed, ArduinoJson::DeserializationOption::Filter(filter),
                      ArduinoJson::DeserializationOption::NestingLimit(apple::mlb_feed::kLiveFeedNestingLimit));
  if (error != ArduinoJson::DeserializationError::Ok) {
    set_error("REPLAY_JSON");
    finish_replay("FAILED");
    return;
  }
  Serial.printf("APPLE_LIVE:{\"type\":\"replay\",\"status\":\"STEP\",\"name\":\"%s\"}\n", step.name);
  accept_feed(doc.as<JsonVariantConst>(), 1, "replay");
  ++replay_step;
  next_replay_ms = now32() + (replay_step < replay_count ? replay_table[replay_step].delay_ms : 0);
}

}  // namespace apple::live
