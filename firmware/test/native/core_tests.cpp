#include "apple/core/engine.hpp"

#include <cstdlib>
#include <iostream>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace {

using apple::core::CommandType;
using apple::core::Engine;
using apple::core::EngineOutput;
using apple::core::EventLedger;
using apple::core::Half;
using apple::core::InputEnvelope;
using apple::core::LedgerLookup;
using apple::core::Phase;
using apple::core::PlayEvidence;
using apple::core::PlayKind;
using apple::core::ReviewState;
using apple::core::SequenceState;
using apple::core::UpdateMode;

class MemoryLedger final : public EventLedger {
 public:
  LedgerLookup lookup(std::string_view event_key) const override {
    if (fail_lookup) return LedgerLookup::Error;
    return keys.count(std::string(event_key)) == 0 ? LedgerLookup::Missing
                                                   : LedgerLookup::Present;
  }

  bool persist(std::string_view event_key) override {
    if (fail_persist) return false;
    keys.insert(std::string(event_key));
    writes.push_back(std::string(event_key));
    return true;
  }

  bool fail_lookup{false};
  bool fail_persist{false};
  std::set<std::string> keys;
  std::vector<std::string> writes;
};

[[noreturn]] void fail(const std::string& message, int line) {
  std::cerr << "FAIL line " << line << ": " << message << '\n';
  std::exit(1);
}

#define EXPECT_TRUE(value)                                                     \
  do {                                                                         \
    if (!(value)) fail("expected true: " #value, __LINE__);                   \
  } while (false)

#define EXPECT_EQ(actual, expected)                                            \
  do {                                                                         \
    const auto actual_value = (actual);                                        \
    const auto expected_value = (expected);                                    \
    if (!(actual_value == expected_value))                                     \
      fail("values differ: " #actual " != " #expected, __LINE__);            \
  } while (false)

InputEnvelope game(std::string cursor, UpdateMode mode = UpdateMode::Incremental,
                   std::int64_t game_pk = 777001, int game_number = 1) {
  InputEnvelope input;
  input.update_mode = mode;
  input.game_pk = game_pk;
  input.game_number = game_number;
  input.cursor = std::move(cursor);
  input.phase = Phase::Live;
  input.half = Half::Bottom;
  input.inning = 6;
  input.outs = 1;
  input.away_team_id = 144;
  input.home_team_id = apple::core::kMetsTeamId;
  input.away_runs = 2;
  input.home_runs = 2;
  return input;
}

PlayEvidence home_run(std::string key = "777001:play-42",
                      int batting_team = apple::core::kMetsTeamId,
                      ReviewState review = ReviewState::None) {
  return PlayEvidence{std::move(key), 42, batting_team, "Juan Soto",
                      PlayKind::HomeRun, true, review};
}

bool has_command(const EngineOutput& output, CommandType type) {
  for (const auto& command : output.commands) {
    if (command.type == type) return true;
  }
  return false;
}

bool has_trace(const EngineOutput& output, std::string_view code) {
  for (const auto& entry : output.traces) {
    if (entry.code == code) return true;
  }
  return false;
}

void bootstrap(Engine& engine, std::int64_t game_pk = 777001,
               int game_number = 1, std::uint64_t now_ms = 0) {
  const auto output = engine.ingest(
      game("20260827_190000", UpdateMode::Bootstrap, game_pk, game_number),
      now_ms);
  EXPECT_TRUE(has_trace(output, "BOOTSTRAP_ACCEPTED"));
  EXPECT_TRUE(output.commands.empty());
}

void test_home_run_golden_trace_and_timing() {
  MemoryLedger ledger;
  Engine engine(ledger);
  bootstrap(engine, 777001, 1, 100);

  auto update = game("20260827_190010");
  update.home_runs = 3;
  update.plays.push_back(home_run());
  const auto decision = engine.ingest(update, 100);
  EXPECT_EQ(decision.commands.size(), 2U);
  EXPECT_EQ(decision.commands[0].type, CommandType::DisplayRender);
  EXPECT_EQ(decision.commands[1].type, CommandType::LedCelebrate);
  EXPECT_EQ(ledger.writes.size(), 1U);
  EXPECT_EQ(ledger.writes[0], "777001:play-42");
  EXPECT_EQ(engine.sequence_state(), SequenceState::LeadIn);

  const std::vector<std::string> expected_trace{
      "EVENT_PERSISTED", "SEQUENCE_QUEUED", "SEQUENCE_STARTED",
      "INPUT_ACCEPTED"};
  EXPECT_EQ(decision.traces.size(), expected_trace.size());
  for (std::size_t index = 0; index < expected_trace.size(); ++index) {
    EXPECT_EQ(decision.traces[index].code, expected_trace[index]);
  }

  EXPECT_TRUE(engine.tick(2'099).commands.empty());
  const auto extend = engine.tick(2'100);
  EXPECT_TRUE(has_command(extend, CommandType::MotionExtend));
  EXPECT_EQ(extend.commands[0].position_mm, 50);
  EXPECT_EQ(extend.commands[0].deadline_ms, 7'100U);
  EXPECT_EQ(engine.sequence_state(), SequenceState::Extending);

  engine.report_position(50, 4'000);
  EXPECT_EQ(engine.sequence_state(), SequenceState::Raised);
  EXPECT_TRUE(engine.tick(33'999).commands.empty());
  const auto retract = engine.tick(34'000);
  EXPECT_TRUE(has_command(retract, CommandType::MotionRetract));
  EXPECT_EQ(retract.commands[0].deadline_ms, 39'000U);
  const auto home = engine.report_position(0, 35'000);
  EXPECT_TRUE(has_trace(home, "POSITION_HOME"));
  EXPECT_EQ(engine.sequence_state(), SequenceState::Idle);
}

void test_duplicate_opponent_and_historical_are_still() {
  MemoryLedger ledger;
  Engine engine(ledger);
  auto historical = game("20260827_190000", UpdateMode::Bootstrap);
  historical.plays.push_back(home_run("777001:historical"));
  const auto boot = engine.ingest(historical, 0);
  EXPECT_TRUE(boot.commands.empty());
  EXPECT_TRUE(ledger.keys.count("777001:historical") == 1);

  auto opponent = game("20260827_190010");
  opponent.plays.push_back(home_run("777001:opponent", 144));
  const auto ignored = engine.ingest(opponent, 10);
  EXPECT_TRUE(ignored.commands.empty());
  EXPECT_TRUE(has_trace(ignored, "HOME_RUN_OPPONENT_IGNORED"));

  auto duplicate = game("20260827_190020");
  duplicate.plays.push_back(home_run("777001:historical"));
  const auto replay = engine.ingest(duplicate, 20);
  EXPECT_TRUE(replay.commands.empty());
  EXPECT_TRUE(has_trace(replay, "EVENT_DUPLICATE"));

  const auto same_cursor = engine.ingest(duplicate, 21);
  EXPECT_TRUE(has_trace(same_cursor, "INPUT_DUPLICATE"));
  auto regressed = duplicate;
  regressed.cursor = "20260827_190015";
  EXPECT_TRUE(has_trace(engine.ingest(regressed, 22),
                        "INPUT_CURSOR_REGRESSION"));
}

void test_review_pending_confirmed_and_overturned() {
  MemoryLedger ledger;
  Engine engine(ledger);
  bootstrap(engine);

  auto pending = game("20260827_190010");
  pending.phase = Phase::Review;
  pending.plays.push_back(
      home_run("777001:reviewed", apple::core::kMetsTeamId,
               ReviewState::Pending));
  const auto held = engine.ingest(pending, 100);
  EXPECT_TRUE(held.commands.empty());
  EXPECT_TRUE(has_trace(held, "HOME_RUN_REVIEW_HOLD"));

  auto confirmed = game("20260827_190020");
  confirmed.plays.push_back(
      home_run("777001:reviewed", apple::core::kMetsTeamId,
               ReviewState::Confirmed));
  const auto accepted = engine.ingest(confirmed, 200);
  EXPECT_TRUE(has_command(accepted, CommandType::DisplayRender));

  MemoryLedger other_ledger;
  Engine other_engine(other_ledger);
  bootstrap(other_engine);
  auto overturned = game("20260827_190010");
  overturned.plays.push_back(
      home_run("777001:overturned", apple::core::kMetsTeamId,
               ReviewState::Overturned));
  const auto rejected = other_engine.ingest(overturned, 10);
  EXPECT_TRUE(rejected.commands.empty());
  EXPECT_TRUE(has_trace(rejected, "HOME_RUN_OVERTURNED"));
}

void test_review_can_pause_and_cancel_lead_in() {
  MemoryLedger ledger;
  Engine engine(ledger);
  bootstrap(engine);
  auto accepted = game("20260827_190010");
  accepted.plays.push_back(home_run("777001:late-review"));
  engine.ingest(accepted, 100);

  auto pending = game("20260827_190020");
  pending.phase = Phase::Review;
  pending.plays.push_back(
      home_run("777001:late-review", apple::core::kMetsTeamId,
               ReviewState::Pending));
  EXPECT_TRUE(has_trace(engine.ingest(pending, 500), "ACTIVE_REVIEW_HOLD"));
  EXPECT_EQ(engine.sequence_state(), SequenceState::ReviewHold);
  EXPECT_TRUE(engine.tick(5'000).commands.empty());

  auto confirmed = game("20260827_190030");
  confirmed.plays.push_back(
      home_run("777001:late-review", apple::core::kMetsTeamId,
               ReviewState::Confirmed));
  EXPECT_TRUE(
      has_trace(engine.ingest(confirmed, 5'100), "ACTIVE_REVIEW_RESUMED"));
  EXPECT_TRUE(engine.tick(6'699).commands.empty());
  EXPECT_TRUE(has_command(engine.tick(6'700), CommandType::MotionExtend));

  MemoryLedger cancel_ledger;
  Engine cancel_engine(cancel_ledger);
  bootstrap(cancel_engine);
  auto first = game("20260827_190010");
  first.plays.push_back(home_run("777001:cancel"));
  cancel_engine.ingest(first, 100);
  auto cancel = game("20260827_190020");
  cancel.phase = Phase::Review;
  cancel.plays.push_back(
      home_run("777001:cancel", apple::core::kMetsTeamId,
               ReviewState::Overturned));
  EXPECT_TRUE(has_trace(cancel_engine.ingest(cancel, 500),
                        "ACTIVE_REVIEW_OVERTURNED"));
  EXPECT_EQ(cancel_engine.sequence_state(), SequenceState::Idle);
}

void test_mets_win_and_bootstrap_final() {
  MemoryLedger ledger;
  Engine engine(ledger);
  bootstrap(engine);
  auto final = game("20260827_220000");
  final.phase = Phase::Final;
  final.home_runs = 5;
  final.away_runs = 4;
  const auto win = engine.ingest(final, 1'000);
  EXPECT_TRUE(has_command(win, CommandType::DisplayRender));
  EXPECT_EQ(win.commands[0].subject, "Mets Win!");
  EXPECT_TRUE(ledger.keys.count("777001:final") == 1);

  MemoryLedger boot_ledger;
  Engine boot_engine(boot_ledger);
  auto boot_final = final;
  boot_final.update_mode = UpdateMode::Bootstrap;
  const auto historical = boot_engine.ingest(boot_final, 0);
  EXPECT_TRUE(historical.commands.empty());
  EXPECT_TRUE(boot_ledger.keys.count("777001:final") == 1);
}

void test_storage_and_motion_fail_closed() {
  MemoryLedger failed_storage;
  failed_storage.fail_persist = true;
  Engine storage_engine(failed_storage);
  bootstrap(storage_engine);
  auto update = game("20260827_190010");
  update.plays.push_back(home_run());
  const auto failed = storage_engine.ingest(update, 100);
  EXPECT_TRUE(has_command(failed, CommandType::MotionDisable));
  EXPECT_TRUE(storage_engine.fault_latched());

  MemoryLedger ledger;
  Engine motion_engine(ledger);
  bootstrap(motion_engine);
  motion_engine.ingest(update, 100);
  motion_engine.tick(2'100);
  const auto timeout = motion_engine.tick(7'100);
  EXPECT_TRUE(has_command(timeout, CommandType::MotionDisable));
  EXPECT_TRUE(has_trace(timeout, "FAULT_LATCHED"));
  EXPECT_TRUE(motion_engine.fault_latched());
}

void test_doubleheader_contexts_are_independent() {
  MemoryLedger ledger;
  Engine engine(ledger);
  bootstrap(engine, 777101, 1);
  bootstrap(engine, 777102, 2);

  auto game_one = game("20260827_190010", UpdateMode::Incremental, 777101, 1);
  game_one.plays.push_back(home_run("777101:play-8"));
  EXPECT_TRUE(has_command(engine.ingest(game_one, 100),
                          CommandType::DisplayRender));

  auto game_two = game("20260827_190020", UpdateMode::Incremental, 777102, 2);
  game_two.plays.push_back(home_run("777102:play-8"));
  const auto queued = engine.ingest(game_two, 200);
  EXPECT_TRUE(queued.commands.empty());
  EXPECT_EQ(engine.queued_sequence_count(), 1U);
  EXPECT_TRUE(ledger.keys.count("777101:play-8") == 1);
  EXPECT_TRUE(ledger.keys.count("777102:play-8") == 1);
}

void test_wrong_game_and_monotonic_regression() {
  MemoryLedger ledger;
  Engine engine(ledger);
  auto wrong = game("20260827_190000", UpdateMode::Bootstrap);
  wrong.home_team_id = 147;
  EXPECT_TRUE(has_trace(engine.ingest(wrong, 100), "INPUT_WRONG_GAME"));
  bootstrap(engine, 777001, 1, 100);
  const auto regressed = engine.tick(99);
  EXPECT_TRUE(has_command(regressed, CommandType::MotionDisable));
  EXPECT_TRUE(engine.fault_latched());
}

}  // namespace

int main() {
  test_home_run_golden_trace_and_timing();
  test_duplicate_opponent_and_historical_are_still();
  test_review_pending_confirmed_and_overturned();
  test_review_can_pause_and_cancel_lead_in();
  test_mets_win_and_bootstrap_final();
  test_storage_and_motion_fail_closed();
  test_doubleheader_contexts_are_independent();
  test_wrong_game_and_monotonic_regression();
  std::cout << "PASS apple_core_tests (8 scenarios)\n";
  return 0;
}
