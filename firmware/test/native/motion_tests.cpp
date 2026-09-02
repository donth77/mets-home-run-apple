#include "apple/motion/timed_actuator.hpp"

#include "apple/core/engine.hpp"

#include <cstdlib>
#include <iostream>
#include <set>
#include <string>
#include <string_view>

namespace {

using apple::core::Command;
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
using apple::motion::CurrentSenseProfile;
using apple::motion::Drive;
using apple::motion::kReferenceProfile;
using apple::motion::Rejection;
using apple::motion::Step;
using apple::motion::TimedActuator;
using apple::motion::TimedActuatorProfile;

[[noreturn]] void fail(const std::string& message, int line) {
  std::cerr << "FAIL line " << line << ": " << message << '\n';
  std::exit(1);
}

#define EXPECT_TRUE(value)                                                     \
  do {                                                                         \
    if (!(value))                                                              \
      fail("expected true: " #value, __LINE__);                                \
  } while (false)

#define EXPECT_EQ(actual, expected)                                            \
  do {                                                                         \
    const auto actual_value = (actual);                                        \
    const auto expected_value = (expected);                                    \
    if (!(actual_value == expected_value))                                     \
      fail("values differ: " #actual " != " #expected, __LINE__);              \
  } while (false)

// Round numbers keep the arithmetic in the tests readable. The reference
// profile is exercised separately against the engine's deadline.
constexpr TimedActuatorProfile kTestProfile{50, 5'000, 4'000, 1'000, 50};

Command motion(CommandType type, std::uint64_t deadline_ms) {
  Command command;
  command.type = type;
  command.event_key = "test";
  command.position_mm = type == CommandType::MotionExtend ? 50 : 0;
  command.deadline_ms = deadline_ms;
  return command;
}

void test_invalid_profile_never_drives() {
  TimedActuator actuator(TimedActuatorProfile{});
  EXPECT_EQ(actuator.accept(motion(CommandType::MotionExtend, 0), 0),
            Rejection::InvalidProfile);
  const Step step = actuator.tick(0);
  EXPECT_EQ(step.drive, Drive::Off);
  EXPECT_TRUE(!step.report_position);
  EXPECT_TRUE(!actuator.busy());
}

void test_extend_drives_full_time_then_reports_stroke() {
  TimedActuator actuator(kTestProfile);
  EXPECT_EQ(actuator.required_ms(CommandType::MotionExtend), 6'000U);
  EXPECT_EQ(actuator.required_ms(CommandType::MotionRetract), 5'000U);
  EXPECT_EQ(actuator.accept(motion(CommandType::MotionExtend, 10'000), 0),
            Rejection::None);

  Step step = actuator.tick(0);
  EXPECT_EQ(step.drive, Drive::Extend);
  EXPECT_TRUE(step.drive_changed);
  EXPECT_TRUE(!step.report_position);
  EXPECT_TRUE(actuator.busy());
  EXPECT_TRUE(!actuator.position_known());

  step = actuator.tick(2'500);
  EXPECT_EQ(step.drive, Drive::Extend);
  EXPECT_TRUE(!step.drive_changed);
  EXPECT_EQ(actuator.estimated_position_mm(2'500), 25);

  step = actuator.tick(5'999);
  EXPECT_EQ(step.drive, Drive::Extend);
  EXPECT_EQ(actuator.estimated_position_mm(5'999), 50);

  step = actuator.tick(6'000);
  EXPECT_EQ(step.drive, Drive::Off);
  EXPECT_TRUE(step.drive_changed);
  EXPECT_TRUE(step.report_position);
  EXPECT_EQ(step.position_mm, 50);
  EXPECT_TRUE(actuator.position_known());
  EXPECT_TRUE(!actuator.busy());

  step = actuator.tick(9'000);
  EXPECT_EQ(step.drive, Drive::Off);
  EXPECT_TRUE(!step.drive_changed);
  EXPECT_TRUE(!step.report_position);
}

void test_deadline_too_short_refuses_to_start() {
  TimedActuator actuator(kTestProfile);
  EXPECT_EQ(actuator.accept(motion(CommandType::MotionExtend, 5'999), 0),
            Rejection::DeadlineTooShort);
  EXPECT_TRUE(!actuator.busy());
  const Step step = actuator.tick(0);
  EXPECT_EQ(step.drive, Drive::Off);
  EXPECT_TRUE(!step.report_position);

  EXPECT_EQ(actuator.accept(motion(CommandType::MotionExtend, 6'000), 0),
            Rejection::None);
  EXPECT_EQ(actuator.tick(0).drive, Drive::Extend);
}

void test_zero_deadline_means_none() {
  TimedActuator actuator(kTestProfile);
  EXPECT_EQ(actuator.accept(motion(CommandType::MotionRetract, 0), 100),
            Rejection::None);
  EXPECT_EQ(actuator.tick(100).drive, Drive::Retract);
  const Step done = actuator.tick(5'100);
  EXPECT_EQ(done.drive, Drive::Off);
  EXPECT_TRUE(done.report_position);
  EXPECT_EQ(done.position_mm, 0);
}

void test_reverse_waits_for_bridge_off_pause() {
  TimedActuator actuator(kTestProfile);
  actuator.accept(motion(CommandType::MotionExtend, 0), 0);
  actuator.tick(0);
  EXPECT_TRUE(actuator.tick(6'000).report_position);

  // Reversing 10 ms after the bridge went off must wait out the 50 ms pause,
  // and the deadline check includes that wait.
  EXPECT_EQ(actuator.accept(motion(CommandType::MotionRetract, 11'049), 6'010),
            Rejection::DeadlineTooShort);
  EXPECT_EQ(actuator.accept(motion(CommandType::MotionRetract, 11'050), 6'010),
            Rejection::None);
  EXPECT_EQ(actuator.tick(6'010).drive, Drive::Off);
  EXPECT_TRUE(actuator.busy());
  EXPECT_EQ(actuator.tick(6'049).drive, Drive::Off);
  const Step started = actuator.tick(6'050);
  EXPECT_EQ(started.drive, Drive::Retract);
  EXPECT_TRUE(started.drive_changed);
  const Step done = actuator.tick(11'050);
  EXPECT_EQ(done.drive, Drive::Off);
  EXPECT_TRUE(done.report_position);
  EXPECT_EQ(done.position_mm, 0);
}

void test_same_direction_again_needs_no_pause() {
  TimedActuator actuator(kTestProfile);
  actuator.accept(motion(CommandType::MotionExtend, 0), 0);
  actuator.tick(0);
  actuator.tick(6'000);
  actuator.accept(motion(CommandType::MotionExtend, 0), 6'001);
  EXPECT_EQ(actuator.tick(6'001).drive, Drive::Extend);
}

void test_disable_stops_immediately_without_report() {
  TimedActuator actuator(kTestProfile);
  actuator.accept(motion(CommandType::MotionExtend, 0), 0);
  actuator.tick(0);
  actuator.tick(2'000);
  EXPECT_EQ(actuator.accept(motion(CommandType::MotionDisable, 0), 2'000),
            Rejection::None);
  const Step step = actuator.tick(2'000);
  EXPECT_EQ(step.drive, Drive::Off);
  EXPECT_TRUE(!step.report_position);
  EXPECT_TRUE(!actuator.busy());
  EXPECT_TRUE(!actuator.position_known());
  EXPECT_EQ(actuator.estimated_position_mm(2'000), 20);
  EXPECT_EQ(actuator.tick(9'000).drive, Drive::Off);
  EXPECT_TRUE(!actuator.tick(9'000).report_position);
}

void test_reversal_while_driving_stops_first() {
  TimedActuator actuator(kTestProfile);
  actuator.accept(motion(CommandType::MotionExtend, 0), 0);
  actuator.tick(0);
  actuator.tick(1'000);
  EXPECT_EQ(actuator.accept(motion(CommandType::MotionRetract, 0), 1'000),
            Rejection::None);
  EXPECT_EQ(actuator.tick(1'000).drive, Drive::Off);
  EXPECT_EQ(actuator.tick(1'049).drive, Drive::Off);
  EXPECT_EQ(actuator.tick(1'050).drive, Drive::Retract);
  // Retracting from the estimated 10 mm still drives the full time so the home
  // switch is guaranteed.
  const Step done = actuator.tick(6'050);
  EXPECT_TRUE(done.report_position);
  EXPECT_EQ(done.position_mm, 0);
  EXPECT_TRUE(actuator.position_known());
}

class MemoryLedger final : public EventLedger {
 public:
  LedgerLookup lookup(std::string_view event_key) const override {
    return keys.count(std::string(event_key)) == 0 ? LedgerLookup::Missing
                                                   : LedgerLookup::Present;
  }
  bool persist(std::string_view event_key) override {
    keys.insert(std::string(event_key));
    return true;
  }
  std::set<std::string> keys;
};

InputEnvelope live_game(std::string cursor, UpdateMode mode) {
  InputEnvelope input;
  input.update_mode = mode;
  input.game_pk = 777001;
  input.cursor = std::move(cursor);
  input.phase = Phase::Live;
  input.half = Half::Bottom;
  input.inning = 6;
  input.away_team_id = 143;
  input.home_team_id = apple::core::kMetsTeamId;
  return input;
}

PlayEvidence mets_home_run() {
  PlayEvidence play;
  play.event_key = "777001:play:42";
  play.at_bat_index = 42;
  play.batting_team_id = apple::core::kMetsTeamId;
  play.batter_name = "Juan Soto";
  play.kind = PlayKind::HomeRun;
  play.complete = true;
  play.review = ReviewState::None;
  return play;
}

// Drives the real engine sequence with the reference profile: every command
// the engine emits must fit its own deadline, and the timed reports must walk
// the sequence home again.
void test_reference_profile_completes_engine_sequence() {
  TimedActuator actuator(kReferenceProfile);
  EXPECT_TRUE(actuator.required_ms(CommandType::MotionExtend) <=
              apple::core::kMotionDeadlineMs);
  EXPECT_TRUE(actuator.required_ms(CommandType::MotionRetract) <=
              apple::core::kMotionDeadlineMs);

  MemoryLedger ledger;
  Engine engine(ledger);
  engine.ingest(live_game("20260901_190000", UpdateMode::Bootstrap), 0);
  auto update = live_game("20260901_190010", UpdateMode::Incremental);
  update.plays.push_back(mets_home_run());
  engine.ingest(update, 100);
  EXPECT_EQ(engine.sequence_state(), SequenceState::LeadIn);

  std::uint64_t now_ms = 100;
  bool saw_extend = false;
  bool saw_raised = false;
  bool saw_retract = false;
  std::uint64_t raised_at_ms = 0;
  while (now_ms < 120'000 && engine.sequence_state() != SequenceState::Idle) {
    now_ms += 10;
    const EngineOutput output = engine.tick(now_ms);
    for (const Command& command : output.commands) {
      EXPECT_EQ(actuator.accept(command, now_ms), Rejection::None);
      if (command.type == CommandType::MotionExtend) saw_extend = true;
      if (command.type == CommandType::MotionRetract) saw_retract = true;
    }
    EXPECT_TRUE(!engine.fault_latched());
    const Step step = actuator.tick(now_ms);
    if (step.report_position) {
      engine.report_position(step.position_mm, now_ms);
      if (step.position_mm == 50) {
        saw_raised = true;
        raised_at_ms = now_ms;
        EXPECT_EQ(engine.sequence_state(), SequenceState::Raised);
      }
    }
  }

  EXPECT_TRUE(saw_extend);
  EXPECT_TRUE(saw_raised);
  EXPECT_TRUE(saw_retract);
  EXPECT_EQ(engine.sequence_state(), SequenceState::Idle);
  EXPECT_TRUE(!engine.fault_latched());
  EXPECT_EQ(actuator.drive(), Drive::Off);
  EXPECT_TRUE(actuator.position_known());
  EXPECT_EQ(actuator.estimated_position_mm(now_ms), 0);
  // Extend is issued at the end of the 2 s lead-in, starts on that same tick,
  // and reports after its full drive.
  EXPECT_EQ(raised_at_ms,
            100 + apple::core::kCelebrationLeadInMs +
                actuator.required_ms(CommandType::MotionExtend));
}

// A profile slower than the deadline must refuse to start rather than fault
// mid-stroke with the Apple raised.
void test_slow_profile_refuses_and_engine_faults_at_home() {
  constexpr TimedActuatorProfile kSlow{50, 20'000, 20'000, 0, 50};
  TimedActuator actuator(kSlow);
  MemoryLedger ledger;
  Engine engine(ledger);
  engine.ingest(live_game("20260901_190000", UpdateMode::Bootstrap), 0);
  auto update = live_game("20260901_190010", UpdateMode::Incremental);
  update.plays.push_back(mets_home_run());
  engine.ingest(update, 100);

  bool refused = false;
  bool disabled = false;
  std::uint64_t now_ms = 100;
  while (now_ms < 60'000 && !engine.fault_latched()) {
    now_ms += 10;
    const EngineOutput output = engine.tick(now_ms);
    for (const Command& command : output.commands) {
      const Rejection rejection = actuator.accept(command, now_ms);
      if (command.type == CommandType::MotionExtend) {
        EXPECT_EQ(rejection, Rejection::DeadlineTooShort);
        refused = true;
      }
      if (command.type == CommandType::MotionDisable) disabled = true;
    }
    EXPECT_EQ(actuator.tick(now_ms).drive, Drive::Off);
  }
  EXPECT_TRUE(refused);
  EXPECT_TRUE(disabled);
  EXPECT_TRUE(engine.fault_latched());
  EXPECT_EQ(actuator.drive(), Drive::Off);
}

constexpr CurrentSenseProfile kTestSense{150, 300, 60, 100, 1'200, 250};

void test_current_collapse_confirms_arrival_early() {
  TimedActuator actuator(kTestProfile, kTestSense);
  actuator.accept(motion(CommandType::MotionExtend, 0), 0);
  EXPECT_EQ(actuator.tick(0).drive, Drive::Extend);

  // Motor running: 330 mA samples every 50 ms.
  for (std::uint64_t t = 50; t <= 2'000; t += 50) {
    actuator.observe_current(330, t);
    const Step step = actuator.tick(t);
    EXPECT_EQ(step.drive, Drive::Extend);
    EXPECT_TRUE(!step.report_position);
  }
  EXPECT_EQ(actuator.last_current_ma(), 330);

  // The end-stop switch opens: current collapses. Arrival needs the low
  // reading held for 100 ms.
  actuator.observe_current(5, 2'050);
  EXPECT_EQ(actuator.tick(2'050).drive, Drive::Extend);
  actuator.observe_current(5, 2'100);
  EXPECT_EQ(actuator.tick(2'100).drive, Drive::Extend);
  actuator.observe_current(5, 2'150);
  const Step arrived = actuator.tick(2'150);
  EXPECT_EQ(arrived.drive, Drive::Off);
  EXPECT_TRUE(arrived.drive_changed);
  EXPECT_TRUE(arrived.report_position);
  EXPECT_EQ(arrived.position_mm, 50);
  EXPECT_TRUE(arrived.arrived_by_current);
  EXPECT_TRUE(!arrived.stall);
  EXPECT_TRUE(actuator.position_known());
  EXPECT_TRUE(!actuator.busy());
  EXPECT_TRUE(!actuator.tick(6'000).report_position);
}

void test_low_current_before_flow_is_not_arrival() {
  TimedActuator actuator(kTestProfile, kTestSense);
  actuator.accept(motion(CommandType::MotionExtend, 0), 0);
  actuator.tick(0);
  // A sensor reading near zero from the start, for a full second, must not
  // count as arrival: the motor never flowed.
  for (std::uint64_t t = 50; t <= 1'000; t += 50) {
    actuator.observe_current(3, t);
    EXPECT_EQ(actuator.tick(t).drive, Drive::Extend);
  }
  // Flow for only 200 ms, under min_flow_ms, then a collapse: still timed.
  for (std::uint64_t t = 1'050; t <= 1'250; t += 50) {
    actuator.observe_current(330, t);
    actuator.tick(t);
  }
  for (std::uint64_t t = 1'300; t <= 1'600; t += 50) {
    actuator.observe_current(3, t);
    EXPECT_EQ(actuator.tick(t).drive, Drive::Extend);
  }
  const Step done = actuator.tick(6'000);
  EXPECT_EQ(done.drive, Drive::Off);
  EXPECT_TRUE(done.report_position);
  EXPECT_TRUE(!done.arrived_by_current);
}

void test_stall_stops_drive_without_position_and_engine_latches() {
  TimedActuator actuator(kTestProfile, kTestSense);
  actuator.accept(motion(CommandType::MotionExtend, 0), 0);
  actuator.tick(0);
  for (std::uint64_t t = 50; t <= 1'000; t += 50) {
    actuator.observe_current(330, t);
    actuator.tick(t);
  }
  // Jammed: 1.5 A. The stall must hold for 250 ms before it counts.
  actuator.observe_current(1'500, 1'050);
  EXPECT_EQ(actuator.tick(1'050).drive, Drive::Extend);
  actuator.observe_current(1'500, 1'200);
  EXPECT_EQ(actuator.tick(1'200).drive, Drive::Extend);
  actuator.observe_current(1'500, 1'300);
  const Step stalled = actuator.tick(1'300);
  EXPECT_EQ(stalled.drive, Drive::Off);
  EXPECT_TRUE(stalled.drive_changed);
  EXPECT_TRUE(stalled.stall);
  EXPECT_TRUE(!stalled.report_position);
  EXPECT_TRUE(!actuator.position_known());
  EXPECT_TRUE(!actuator.busy());

  MemoryLedger ledger;
  Engine engine(ledger);
  engine.ingest(live_game("20260901_190000", UpdateMode::Bootstrap), 0);
  auto update = live_game("20260901_190010", UpdateMode::Incremental);
  update.plays.push_back(mets_home_run());
  engine.ingest(update, 100);
  engine.tick(2'100);
  EXPECT_EQ(engine.sequence_state(), SequenceState::Extending);
  const EngineOutput fault = engine.report_motion_fault("MOTOR_STALL", 3'400);
  EXPECT_TRUE(engine.fault_latched());
  EXPECT_EQ(engine.sequence_state(), SequenceState::Fault);
  bool disabled = false;
  bool traced = false;
  for (const Command& command : fault.commands) {
    if (command.type == CommandType::MotionDisable) disabled = true;
  }
  for (const auto& trace : fault.traces) {
    if (trace.code == "FAULT_LATCHED" && trace.detail == "MOTOR_STALL") traced = true;
  }
  EXPECT_TRUE(disabled);
  EXPECT_TRUE(traced);
  // A second report changes nothing.
  EXPECT_TRUE(engine.report_motion_fault("AGAIN", 3'500).commands.empty());
}

void test_without_sense_profile_samples_are_ignored() {
  TimedActuator actuator(kTestProfile);
  actuator.accept(motion(CommandType::MotionExtend, 0), 0);
  actuator.tick(0);
  for (std::uint64_t t = 50; t <= 1'000; t += 50) {
    actuator.observe_current(330, t);
    actuator.tick(t);
  }
  for (std::uint64_t t = 1'050; t <= 3'000; t += 50) {
    actuator.observe_current(t < 2'000 ? 2 : 5'000, t);
    const Step step = actuator.tick(t);
    EXPECT_EQ(step.drive, Drive::Extend);
    EXPECT_TRUE(!step.stall);
  }
  const Step done = actuator.tick(6'000);
  EXPECT_TRUE(done.report_position);
  EXPECT_TRUE(!done.arrived_by_current);
}

}  // namespace

int main() {
  test_invalid_profile_never_drives();
  test_extend_drives_full_time_then_reports_stroke();
  test_deadline_too_short_refuses_to_start();
  test_zero_deadline_means_none();
  test_reverse_waits_for_bridge_off_pause();
  test_same_direction_again_needs_no_pause();
  test_disable_stops_immediately_without_report();
  test_reversal_while_driving_stops_first();
  test_reference_profile_completes_engine_sequence();
  test_slow_profile_refuses_and_engine_faults_at_home();
  test_current_collapse_confirms_arrival_early();
  test_low_current_before_flow_is_not_arrival();
  test_stall_stops_drive_without_position_and_engine_latches();
  test_without_sense_profile_samples_are_ignored();
  std::cout << "apple_motion_tests passed\n";
  return 0;
}
