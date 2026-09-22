#include "apple_live/motion/motion.hpp"

#include "apple_live/audio/player.hpp"
#include "apple_live/audio/scaled_source.hpp"
#include "apple_live/display/celebration.hpp"
#include "apple_live/display/display.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/live_feed.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/owner/celebration_history.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/pins.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/firmware/board_pins.hpp"
#include "apple/firmware/screens.hpp"

#include <Arduino.h>

#include <cstdint>

namespace apple::live {

using apple::core::Command;
using apple::core::CommandType;
using apple::core::Engine;
using apple::core::EngineOutput;
using apple::core::EventLedger;
using apple::core::SequenceState;
using apple::firmware::copy_text;
using apple::motion::Drive;
using apple::motion::Rejection;
using apple::motion::Step;
using apple::motion::TimedActuator;

std::optional<Engine> engine;
TimedActuator actuator(apple::motion::kReferenceProfile);
Drive applied_drive = Drive::Off;

namespace {

SequenceState shown_sequence = SequenceState::Idle;

}  // namespace

void make_engine(EventLedger& ledger) {
  engine.emplace(ledger);
  engine->set_raised_dwell_ms(static_cast<std::uint64_t>(settings.raised_seconds) * 1000);
}

// The owner's hold, or the fixed one a Lab scenario expects.
void apply_raised_dwell() {
  if (!engine) return;
  engine->set_raised_dwell_ms(active_fixture ? apple::core::kRaisedDwellMs
                                             : static_cast<std::uint64_t>(settings.raised_seconds) * 1000);
}

void apply_drive(Drive drive) {
  if (settings.motor) {
    if (drive == Drive::Off) {
      digitalWrite(kMotorEnablePin, LOW);
      digitalWrite(kMotorIn1Pin, LOW);
      digitalWrite(kMotorIn2Pin, LOW);
    } else {
      digitalWrite(kMotorIn1Pin, drive == Drive::Extend ? HIGH : LOW);
      digitalWrite(kMotorIn2Pin, drive == Drive::Retract ? HIGH : LOW);
      digitalWrite(kMotorEnablePin, HIGH);
    }
  } else {
    apple::firmware::disarm_motion_outputs();
  }
  applied_drive = drive;
}

void handle_output(const EngineOutput& output, std::uint64_t now) {
  for (const auto& trace : output.traces) publish_trace(trace.code.c_str(), trace.detail.c_str());
  for (const auto& event : output.events) {
    if (event.type == apple::core::EventType::CelebrationStarted) begin_celebration(event);
  }
  for (const Command& command : output.commands) {
    const Rejection rejection = actuator.accept(command, now);
    Serial.printf("APPLE_LIVE:{\"type\":\"trace\",\"code\":\"COMMAND\",\"detail\":\"%s deadline_ms=%lu required_ms=%lu\"}\n",
                  apple::core::command_type_name(command.type),
                  static_cast<unsigned long>(command.deadline_ms),
                  static_cast<unsigned long>(actuator.required_ms(command.type)));
    if (rejection != Rejection::None) publish_trace("COMMAND_REJECTED", apple::motion::rejection_name(rejection));
  }
}

void service_motion(std::uint64_t now) {
  if (engine) handle_output(engine->tick(now), now);
  const Step step = actuator.tick(now);
  if (step.stall && engine) handle_output(engine->report_motion_fault("MOTOR_STALL", now), now);
  if (step.drive_changed) {
    apply_drive(step.drive);
    publish_trace(step.drive == Drive::Off ? "DRIVE_OFF" : "DRIVE_ON", apple::motion::drive_name(step.drive));
  }
  if (step.report_position && engine) handle_output(engine->report_position(step.position_mm, now), now);
  const SequenceState state = engine ? engine->sequence_state() : SequenceState::Idle;
  if (state != shown_sequence) {
    shown_sequence = state;
    Serial.printf("APPLE_LIVE:{\"type\":\"sequence\",\"state\":\"%s\",\"fault\":%s}\n",
                  apple::core::sequence_state_name(state),
                  engine && engine->fault_latched() ? "true" : "false");
    if (state == SequenceState::Idle) apply_raised_dwell();  // a streamed win stretched it
    if (state == SequenceState::Raised && engine && celebration_active && !audio_request_stream) {
      // The Apple comes down when the hold ends and would cut the track; fade
      // it out first. A win streaming its whole song is timed to end on its
      // own and is left alone.
      const std::uint32_t hold = static_cast<std::uint32_t>(engine->raised_dwell_ms());
      audio_fade_at_ms = millis() + (hold > kAudioFadeMs ? hold - kAudioFadeMs : 0);
    }
    if (last_celebration_tracking) {
      if (state == SequenceState::Raised) last_celebration_raised = true;
      if (engine && engine->fault_latched()) settle_last_celebration("FAULT");
      else if (state == SequenceState::Idle) settle_last_celebration(last_celebration_raised ? "ROSE" : "STOPPED");
    }
    if (engine && engine->fault_latched()) {
      apply_drive(Drive::Off);
      copy_text(model.waiting_title, sizeof(model.waiting_title), "MOTION DISABLED");
      copy_text(model.waiting_note, sizeof(model.waiting_note), "CHECK THE HARDWARE|THEN RESTART");
      show_waiting("MOTOR STOPPED", apple::firmware::kErrorRed, apple::firmware::WaitingIcon::Alert);
    }
  }
}

bool motion_idle() {
  return !celebration_active && (!engine || engine->sequence_state() == SequenceState::Idle);
}

void stop_motion(const char* reason) {
  manager.clear_maintenance();
  if (active_fixture) { stop_lab_fixture(); return; }
  const std::uint64_t now = now_ms();
  Command disable;
  disable.type = CommandType::MotionDisable;
  actuator.accept(disable, now);
  actuator.tick(now);
  apply_drive(Drive::Off);
  end_celebration(reason);
  // A stop away from home must not clear an existing fault or enable a new sequence.
  if (engine && (engine->fault_latched() || engine->sequence_state() != SequenceState::Idle ||
                 actuator.estimated_position_mm(now) != 0)) {
    handle_output(engine->report_motion_fault(reason, now), now);
    replay_active = false;
  }
  tracker.reset();
  shown_sequence = SequenceState::Idle;
  publish_trace("STOPPED", reason);
  request_redraw();
}

}  // namespace apple::live
