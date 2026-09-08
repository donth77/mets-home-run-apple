#include "apple/firmware/lab_fixtures.generated.hpp"
#include "apple/firmware/maintenance_session.hpp"
#include "apple/firmware/status_snapshot.hpp"
#include "apple/core/engine.hpp"
#include "apple/core/evidence_bridge.hpp"
#include "apple/game_state/projector.hpp"
#include "apple/motion/timed_actuator.hpp"

// This test is written with assert(); keep the checks alive in the Release
// native build, where NDEBUG would otherwise compile every one of them out.
#undef NDEBUG
#include <cassert>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>

using namespace apple;

class RecordingLedger final : public core::EventLedger {
 public:
  core::LedgerLookup lookup(std::string_view key) const override {
    return keys.count(std::string(key)) ? core::LedgerLookup::Present : core::LedgerLookup::Missing;
  }
  bool persist(std::string_view key) override { keys.insert(std::string(key)); return true; }
  std::set<std::string> keys;
};

void maintenance_trace() {
  firmware::MaintenanceSession session;
  assert(!session.request(false, "unauthenticated", 0));
  assert(!session.confirm(0));
  assert(!session.request(true, "", 0));
  assert(session.request(true, "first", 100));
  assert(session.pending(30'099));
  assert(!session.consume("first", 200));
  assert(!session.confirm(30'100));
  assert(session.request(true, "second", 40'000));
  assert(session.confirm(40'001));
  assert(session.remaining_ms(40'001) == 60'000);
  assert(!session.consume("wrong", 40'002));
  assert(session.consume("second", 40'003));
  assert(!session.consume("second", 40'003));
  assert(!session.armed(40'003));
  assert(session.request(true, "expired", 50'000));
  assert(session.confirm(50'001));
  assert(!session.consume("expired", 110'001));
  assert(session.request(true, "rollover", UINT32_MAX - 100));
  assert(session.confirm(50));
  assert(session.armed(60'049));
  assert(!session.armed(60'050));
  session.expire(60'050);
  assert(!session.armed(50));  // Cannot revive after a full counter wrap.
  assert(session.request(true, "replacement", 70'000));
  assert(session.confirm(70'001));
  assert(session.request(true, "new-request", 70'002));
  assert(!session.consume("replacement", 70'003));
  session.clear();
  assert(!session.pending(70'004));
  assert(session.request(true, "delayed-start", 80'000));
  assert(session.confirm(80'001));
  assert(!session.cancel("wrong"));
  assert(session.cancel("delayed-start"));
  assert(!session.consume("delayed-start", 80'002));
}

void cancellation_stays_disabled() {
  RecordingLedger ledger;
  core::Engine engine(ledger);
  game_state::Projector projector;
  motion::TimedActuator actuator(motion::kReferenceProfile);
  const auto* fixture = firmware::find_lab_fixture("home-run");
  assert(fixture);
  for (const auto& frame : fixture->frames) {
    if (frame.at_ms > 1000) break;
    assert(projector.replace(frame.frame));
    engine.ingest(core::to_input_envelope(projector.decision_evidence()), frame.at_ms);
  }
  for (const auto& command : engine.tick(3000).commands) actuator.accept(command, 3000);
  assert(actuator.tick(3000).drive == motion::Drive::Extend);
  for (const auto& command : engine.report_motion_fault("FIXTURE_CANCELLED", 4000).commands)
    actuator.accept(command, 4000);
  assert(actuator.tick(4000).drive == motion::Drive::Off);
  assert(engine.fault_latched());
  assert(!actuator.position_known());
  for (std::uint64_t now = 4000; now <= 180'000; now += 1000) {
    for (const auto& command : engine.tick(now).commands)
      assert(command.type != core::CommandType::MotionExtend && command.type != core::CommandType::MotionRetract);
    assert(actuator.tick(now).drive == motion::Drive::Off);
  }
}

std::string run_fixture(const firmware::LabFixture& fixture) {
  RecordingLedger ledger;
  core::Engine engine(ledger);
  game_state::Projector projector;
  motion::TimedActuator actuator(motion::kReferenceProfile);
  std::size_t frame = 0;
  int raises = 0;
  std::ostringstream trace;
  const auto record = [&](const core::EngineOutput& output, std::uint64_t now) {
    for (const auto& command : output.commands) {
      if (command.type == core::CommandType::MotionExtend) {
        assert(ledger.lookup(command.event_key) == core::LedgerLookup::Present);
        ++raises;
        trace << now << ":extend ";
      }
      if (command.type == core::CommandType::MotionRetract) trace << now << ":retract ";
      assert(actuator.accept(command, now) == motion::Rejection::None);
    }
  };
  for (std::uint64_t now = 0; now <= 180'000; now += 10) {
    while (frame < fixture.frames.size() && now >= fixture.frames[frame].at_ms) {
      assert(projector.replace(fixture.frames[frame++].frame));
      record(engine.ingest(core::to_input_envelope(projector.decision_evidence()), now), now);
    }
    record(engine.tick(now), now);
    const auto step = actuator.tick(now);
    if (step.report_position) record(engine.report_position(step.position_mm, now), now);
    assert(!engine.fault_latched());
    if (frame == fixture.frames.size() && now >= fixture.duration_ms &&
        engine.sequence_state() == core::SequenceState::Idle) {
      assert(!actuator.busy());
      assert(actuator.estimated_position_mm(now) == 0);
      assert(raises == fixture.expected_sequences);
      return std::string(fixture.id) + " " + trace.str() + "home\n";
    }
  }
  assert(false && "fixture exceeded its bound");
  return {};
}

void snapshot_golden(const char* path, bool write) {
  auto frame = firmware::lab_fixtures().front().frames.front().frame;
  frame.at_bat = game_state::AtBatState{2, 1, {true, false, true}, "Fixture Batter",
                                       "1 for 2", "Fixture Pitcher", 42};
  frame.linescore.innings = {{1, 0, 1}, {2, 2, std::nullopt}};
  frame.linescore.away_hits = 3;
  frame.linescore.home_hits = 2;
  frame.venue = "Fixture Park";
  game_state::Projector projector;
  assert(projector.replace(frame));
  JsonDocument doc;
  firmware::write_status_snapshot(doc.to<JsonObject>(), projector.snapshot());
  std::string json;
  serializeJson(doc, json);
  if (write) { std::ofstream(path) << json << '\n'; return; }
  std::ifstream file(path);
  std::string expected;
  std::getline(file, expected);
  assert(json == expected);
}

int main(int argc, char** argv) {
  assert(argc >= 3);
  const bool write = argc == 4 && std::string(argv[3]) == "--write";
  maintenance_trace();
  cancellation_stays_disabled();
  std::string trace = "maintenance: unauthenticated=denied presence=30s session=60s single-use rollover=ok stop-before-start=retired cancellation=fault-latched\n";
  for (const auto& fixture : firmware::lab_fixtures()) trace += run_fixture(fixture);
  assert(firmware::lab_fixtures().size() == 14);
  assert(firmware::find_lab_fixture("unknown") == nullptr);
  if (write) std::ofstream(argv[1]) << trace;
  else {
    std::ifstream file(argv[1]);
    std::stringstream expected;
    expected << file.rdbuf();
    assert(trace == expected.str());
  }
  snapshot_golden(argv[2], write);
  std::cout << trace;
}
