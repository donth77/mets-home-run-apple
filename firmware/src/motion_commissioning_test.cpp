// Physically attended commissioning target. Runs the real celebration engine
// against the timed actuator model with the production lead-in, deadlines, and
// raised dwell. One arm authorizes one simulated Mets home run; the engine then
// sequences lead-in, extend, raised dwell, and retract, and must end home or in
// a latched fault. Run it first with the actuator disconnected from OUT1/OUT2.

#include "apple/core/engine.hpp"
#include "apple/firmware/board_pins.hpp"
#include "apple/motion/timed_actuator.hpp"

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <SPI.h>
#if defined(APPLE_MOTION_CURRENT_SENSE)
#include <Adafruit_INA219.h>
#include <Wire.h>
#endif

#include <cstdint>
#include <cstdio>
#include <optional>
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
using apple::firmware::kDisplayChipSelectPin;
using apple::firmware::kDisplayDataCommandPin;
using apple::firmware::kDisplayResetPin;
using apple::motion::Drive;
using apple::motion::Rejection;
using apple::motion::Step;
using apple::motion::TimedActuator;

constexpr std::uint8_t kMotorIn1Pin = D4;
constexpr std::uint8_t kMotorIn2Pin = D5;
constexpr std::uint8_t kMotorEnablePin = D6;
constexpr std::uint32_t kArmWindowMs = 60'000;
constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr std::uint32_t kLoopPeriodMs = 10;
constexpr std::int64_t kBenchGamePk = 990'001;
constexpr char kFirmwareVersion[] = "0.1.0";
constexpr char kProfileName[] = "motion_commissioning";
#if defined(APPLE_MOTION_CURRENT_SENSE)
// INA219 inline on the fused 12 V lead. A4/A5 stay free for pixel data per
// the hardware plan, so I2C is remapped to A6/A7.
constexpr std::uint8_t kCurrentSdaPin = A6;
constexpr std::uint8_t kCurrentSclPin = A7;
constexpr std::uint32_t kCurrentSamplePeriodMs = 50;
constexpr bool kCurrentSenseBuild = true;
#else
constexpr bool kCurrentSenseBuild = false;
#endif

constexpr std::uint16_t kMetsBlue = 0x016E;
constexpr std::uint16_t kMetsOrange = 0xFAC2;
constexpr std::uint16_t kDarkBlue = 0x0008;
constexpr std::uint16_t kMutedBlue = 0x5B2E;

class BenchLedger final : public EventLedger {
 public:
  LedgerLookup lookup(std::string_view event_key) const override {
    return keys_.count(std::string(event_key)) == 0 ? LedgerLookup::Missing
                                                    : LedgerLookup::Present;
  }
  bool persist(std::string_view event_key) override {
    keys_.insert(std::string(event_key));
    return true;
  }

 private:
  std::set<std::string> keys_;
};

Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin,
                      kDisplayResetPin);
BenchLedger ledger;
std::optional<Engine> engine;
#if defined(APPLE_MOTION_CURRENT_SENSE)
TimedActuator actuator(apple::motion::kReferenceProfile,
                       apple::motion::kReferenceCurrentSense);
Adafruit_INA219 current_sensor;
bool current_sensor_ready = false;
std::uint32_t next_current_sample_ms = 0;
#else
TimedActuator actuator(apple::motion::kReferenceProfile);
constexpr bool current_sensor_ready = false;
#endif
Drive applied_drive = Drive::Off;
SequenceState shown_state = SequenceState::Idle;
bool armed = false;
bool run_active = false;
std::uint32_t arm_expires_at_ms = 0;
std::int32_t next_at_bat = 1;

std::uint64_t now_ms() { return static_cast<std::uint64_t>(millis()); }

void set_text(std::uint16_t color, std::uint8_t size) {
  panel.setTextColor(color);
  panel.setTextSize(size);
  panel.setTextWrap(false);
}

void draw_centered(const char* text, std::int16_t center_x, std::int16_t y,
                   std::uint8_t size, std::uint16_t color) {
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(color, size);
  panel.getTextBounds(text, 0, y, &bounds_x, &bounds_y, &bounds_width,
                      &bounds_height);
  panel.setCursor(center_x - static_cast<std::int16_t>(bounds_width / 2), y);
  panel.print(text);
}

const char* sequence_name(SequenceState state) {
  switch (state) {
    case SequenceState::LeadIn:
      return "LEAD_IN";
    case SequenceState::ReviewHold:
      return "REVIEW_HOLD";
    case SequenceState::Extending:
      return "EXTENDING";
    case SequenceState::Raised:
      return "RAISED";
    case SequenceState::Retracting:
      return "RETRACTING";
    case SequenceState::Fault:
      return "FAULT";
    case SequenceState::Idle:
    default:
      return "IDLE";
  }
}

SequenceState current_state() {
  return engine ? engine->sequence_state() : SequenceState::Idle;
}

bool current_fault() { return engine && engine->fault_latched(); }

unsigned pin_value(Drive drive, std::uint8_t pin) {
  if (drive == Drive::Off) return 0U;
  if (pin == kMotorEnablePin) return 1U;
  if (pin == kMotorIn1Pin) return drive == Drive::Extend ? 1U : 0U;
  return drive == Drive::Retract ? 1U : 0U;
}

void publish_hello() {
  const auto& profile = actuator.profile();
  Serial.printf(
      "APPLE_MOTION:{\"type\":\"hello\",\"profile\":\"%s\","
      "\"firmwareVersion\":\"%s\",\"strokeMm\":%ld,\"extendFullMs\":%lu,"
      "\"retractFullMs\":%lu,\"overrunMs\":%lu,\"deadlineMs\":%lu,"
      "\"leadInMs\":%lu,\"dwellMs\":%lu,\"armWindowMs\":%lu,"
      "\"currentSenseBuild\":%s,\"currentSensor\":%s}\n",
      kProfileName, kFirmwareVersion, static_cast<long>(profile.stroke_mm),
      static_cast<unsigned long>(profile.extend_full_ms),
      static_cast<unsigned long>(profile.retract_full_ms),
      static_cast<unsigned long>(profile.overrun_ms),
      static_cast<unsigned long>(apple::core::kMotionDeadlineMs),
      static_cast<unsigned long>(apple::core::kCelebrationLeadInMs),
      static_cast<unsigned long>(apple::core::kRaisedDwellMs),
      static_cast<unsigned long>(kArmWindowMs),
      kCurrentSenseBuild ? "true" : "false",
      current_sensor_ready ? "true" : "false");
}

void publish_state() {
  const std::uint64_t now = now_ms();
  Serial.printf(
      "APPLE_MOTION:{\"type\":\"state\",\"armed\":%s,\"sequence\":\"%s\","
      "\"drive\":\"%s\",\"positionMm\":%ld,\"positionKnown\":%s,"
      "\"fault\":%s,\"ena\":%u,\"in1\":%u,\"in2\":%u,\"currentMa\":%ld}\n",
      armed ? "true" : "false", sequence_name(current_state()),
      apple::motion::drive_name(applied_drive),
      static_cast<long>(actuator.estimated_position_mm(now)),
      actuator.position_known() ? "true" : "false",
      current_fault() ? "true" : "false",
      pin_value(applied_drive, kMotorEnablePin),
      pin_value(applied_drive, kMotorIn1Pin),
      pin_value(applied_drive, kMotorIn2Pin),
      static_cast<long>(actuator.last_current_ma()));
}

void publish_trace(const char* code, const std::string& detail) {
  Serial.printf("APPLE_MOTION:{\"type\":\"trace\",\"code\":\"%s\","
                "\"detail\":\"%s\"}\n",
                code, detail.c_str());
}

void publish_run(const char* status) {
  Serial.printf("APPLE_MOTION:{\"type\":\"run\",\"status\":\"%s\"}\n", status);
}

void draw_state() {
  panel.fillScreen(kDarkBlue);
  panel.fillRect(0, 0, 320, 54, kMetsBlue);
  panel.fillRect(0, 50, 320, 4, kMetsOrange);
  draw_centered("MOTION COMMISSIONING", 160, 17, 2, ST77XX_WHITE);

  const SequenceState state = current_state();
  const bool active = state != SequenceState::Idle || armed;
  draw_centered(sequence_name(state), 160, 76, 3,
                current_fault() ? kMetsOrange : active ? ST77XX_WHITE : kMutedBlue);

  char drive_label[40];
  snprintf(drive_label, sizeof(drive_label), "DRIVE %s  POS %ld MM",
           apple::motion::drive_name(applied_drive),
           static_cast<long>(actuator.estimated_position_mm(now_ms())));
  draw_centered(drive_label, 160, 118, 2,
                applied_drive == Drive::Off ? kMutedBlue : kMetsOrange);

  panel.drawRoundRect(35, 150, 250, 40, 7, kMutedBlue);
  draw_centered(current_fault() ? "FAULT LATCHED - x TO RESET"
                : armed          ? "ARMED - h STARTS ONE RUN"
                                 : "DISARMED",
                160, 163, 1, current_fault() || armed ? kMetsOrange : kMutedBlue);

  draw_centered("a=ARM  h=HOME RUN  x=STOP", 160, 205, 1, kMutedBlue);
  draw_centered("?=STATUS", 160, 220, 1, kMutedBlue);
}

void apply_drive(Drive drive) {
  if (drive == Drive::Off) {
    digitalWrite(kMotorEnablePin, LOW);
    digitalWrite(kMotorIn1Pin, LOW);
    digitalWrite(kMotorIn2Pin, LOW);
  } else {
    digitalWrite(kMotorIn1Pin, drive == Drive::Extend ? HIGH : LOW);
    digitalWrite(kMotorIn2Pin, drive == Drive::Retract ? HIGH : LOW);
    digitalWrite(kMotorEnablePin, HIGH);
  }
  applied_drive = drive;
}

InputEnvelope bench_game(const char* cursor, UpdateMode mode) {
  InputEnvelope input;
  input.update_mode = mode;
  input.game_pk = kBenchGamePk;
  input.cursor = cursor;
  input.phase = Phase::Live;
  input.half = Half::Bottom;
  input.inning = 6;
  input.away_team_id = 143;
  input.home_team_id = apple::core::kMetsTeamId;
  return input;
}

void handle_output(const EngineOutput& output, std::uint64_t now) {
  for (const auto& trace : output.traces) {
    publish_trace(trace.code.c_str(), trace.detail);
  }
  for (const Command& command : output.commands) {
    const Rejection rejection = actuator.accept(command, now);
    publish_trace("COMMAND",
                  std::string(apple::core::command_type_name(command.type)) +
                      " deadline_ms=" + std::to_string(command.deadline_ms) +
                      " required_ms=" +
                      std::to_string(actuator.required_ms(command.type)));
    if (rejection != Rejection::None) {
      publish_trace("COMMAND_REJECTED", apple::motion::rejection_name(rejection));
    }
  }
}

void reset_engine(std::uint64_t now) {
  engine.emplace(ledger);
  handle_output(engine->ingest(bench_game("bench:bootstrap", UpdateMode::Bootstrap), now),
                now);
}

void stop_everything(const char* run_status) {
  const std::uint64_t now = now_ms();
  Command disable;
  disable.type = CommandType::MotionDisable;
  actuator.accept(disable, now);
  actuator.tick(now);
  apply_drive(Drive::Off);
  armed = false;
  arm_expires_at_ms = 0;
  if (run_active) {
    run_active = false;
    publish_run(run_status);
  }
  reset_engine(now);
  shown_state = current_state();
  draw_state();
  publish_state();
}

void arm() {
  if (current_fault() || current_state() != SequenceState::Idle) {
    Serial.println("MOTION_COMMISSIONING=REJECTED REASON=NOT_IDLE");
    publish_state();
    return;
  }
  armed = true;
  arm_expires_at_ms = millis() + kArmWindowMs;
  Serial.println("MOTION_COMMISSIONING=ARMED AUTO_DISARM_MS=60000");
  draw_state();
  publish_state();
}

void start_home_run() {
  if (!armed) {
    Serial.println("MOTION_COMMISSIONING=REJECTED REASON=DISARMED");
    publish_state();
    return;
  }
  if (current_state() != SequenceState::Idle || current_fault()) {
    Serial.println("MOTION_COMMISSIONING=REJECTED REASON=NOT_IDLE");
    publish_state();
    return;
  }
  // One arm authorizes exactly one run.
  armed = false;
  arm_expires_at_ms = 0;

  const std::uint64_t now = now_ms();
  char cursor[32];
  snprintf(cursor, sizeof(cursor), "bench:cursor-%ld",
           static_cast<long>(next_at_bat));
  InputEnvelope update = bench_game(cursor, UpdateMode::Incremental);
  PlayEvidence play;
  play.event_key = "bench:play-" + std::to_string(next_at_bat);
  play.at_bat_index = next_at_bat++;
  play.batting_team_id = apple::core::kMetsTeamId;
  play.batter_name = "Bench Batter";
  play.kind = PlayKind::HomeRun;
  play.complete = true;
  play.review = ReviewState::None;
  update.plays.push_back(play);

  run_active = true;
  publish_run("STARTED");
  handle_output(engine->ingest(update, now), now);
  shown_state = current_state();
  draw_state();
  publish_state();
}

void service(std::uint64_t now) {
  if (armed && static_cast<std::int32_t>(static_cast<std::uint32_t>(now) -
                                         arm_expires_at_ms) >= 0) {
    armed = false;
    arm_expires_at_ms = 0;
    Serial.println("MOTION_COMMISSIONING=ARM_EXPIRED");
    draw_state();
    publish_state();
  }

  if (engine) {
    handle_output(engine->tick(now), now);
  }

#if defined(APPLE_MOTION_CURRENT_SENSE)
  if (current_sensor_ready &&
      static_cast<std::int32_t>(static_cast<std::uint32_t>(now) -
                                next_current_sample_ms) >= 0) {
    next_current_sample_ms = static_cast<std::uint32_t>(now) + kCurrentSamplePeriodMs;
    const float milliamps = current_sensor.getCurrent_mA();
    actuator.observe_current(static_cast<std::int32_t>(lroundf(milliamps)), now);
  }
#endif

  const Step step = actuator.tick(now);
  if (step.stall && engine) {
    publish_trace("STALL_DETECTED",
                  std::to_string(actuator.last_current_ma()) + " mA");
    handle_output(engine->report_motion_fault("MOTOR_STALL", now), now);
  }
  if (step.arrived_by_current) {
    publish_trace("ARRIVAL_BY_CURRENT",
                  std::to_string(actuator.last_current_ma()) + " mA");
  }
  if (step.drive_changed) {
    apply_drive(step.drive);
    publish_trace(step.drive == Drive::Off ? "DRIVE_OFF" : "DRIVE_ON",
                  apple::motion::drive_name(step.drive));
    publish_state();
    draw_state();
  }
  if (step.report_position && engine) {
    publish_trace("POSITION_REPORT", std::to_string(step.position_mm));
    handle_output(engine->report_position(step.position_mm, now), now);
  }

  const SequenceState state = current_state();
  if (state != shown_state) {
    shown_state = state;
    if (run_active && state == SequenceState::Idle) {
      run_active = false;
      publish_run("COMPLETED");
    }
    if (current_fault()) {
      apply_drive(Drive::Off);
      if (run_active) {
        run_active = false;
        publish_run("FAULTED");
      }
    }
    draw_state();
    publish_state();
  }
}

}  // namespace

void setup() {
  apple::firmware::disarm_motion_outputs();

  Serial.begin(115200);
  const std::uint32_t serial_wait_started_ms = millis();
  while (!Serial && millis() - serial_wait_started_ms < kSerialWaitTimeoutMs) {
    delay(10);
  }

  SPI.begin();
  panel.init(240, 320);
  panel.setRotation(1);
  panel.invertDisplay(true);

#if defined(APPLE_MOTION_CURRENT_SENSE)
  Wire.begin(kCurrentSdaPin, kCurrentSclPin);
  current_sensor_ready = current_sensor.begin(&Wire);
  if (!current_sensor_ready) {
    publish_trace("CURRENT_SENSOR_MISSING", "timed drive only");
  }
#endif

  reset_engine(now_ms());
  apply_drive(Drive::Off);
  draw_state();
  publish_hello();
  publish_state();
  Serial.println("MOTION_COMMISSIONING=READY COMMANDS=a:arm h:home_run "
                 "x:stop_and_reset ?:status");
}

void loop() {
  service(now_ms());

  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    if (command == 'x' || command == 'X') {
      stop_everything("STOPPED");
    } else if (command == 'a' || command == 'A') {
      arm();
    } else if (command == 'h' || command == 'H') {
      start_home_run();
    } else if (command == '?') {
      publish_hello();
      publish_state();
    }
  }

  delay(kLoopPeriodMs);
}
