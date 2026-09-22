#include "apple/firmware/board_pins.hpp"

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <SPI.h>

#include <cstdint>
#include <cstdio>

namespace {

using apple::firmware::kDisplayChipSelectPin;
using apple::firmware::kDisplayDataCommandPin;
using apple::firmware::kDisplayResetPin;

constexpr std::uint8_t kMotorIn1Pin = D4;
constexpr std::uint8_t kMotorIn2Pin = D5;
constexpr std::uint8_t kMotorEnablePin = D6;
#if defined(APPLE_L298N_METER_TEST)
constexpr std::uint32_t kJogDurationMs = 10'000;
constexpr char kFirmwareProfile[] = "l298n_output_meter_test";
constexpr char kDisplayTitle[] = "L298N METER TEST";
#else
constexpr std::uint32_t kJogDurationMs = 200;
constexpr char kFirmwareProfile[] = "actuator_jog_test";
constexpr char kDisplayTitle[] = "ACTUATOR JOG";
#endif
constexpr std::uint32_t kBreakBeforeReverseMs = 50;
constexpr std::uint32_t kArmWindowMs = 60'000;
constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr char kFirmwareVersion[] = "0.1.0";

constexpr std::uint16_t kMetsBlue = 0x016E;
constexpr std::uint16_t kMetsOrange = 0xFAC2;
constexpr std::uint16_t kDarkBlue = 0x0008;
constexpr std::uint16_t kMutedBlue = 0x5B2E;

enum class MotionState : std::uint8_t {
  Stop,
  Extend,
  Retract,
};

Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin,
                      kDisplayResetPin);
MotionState motion_state = MotionState::Stop;
std::uint32_t jog_ends_at_ms = 0;
std::uint32_t arm_expires_at_ms = 0;
bool armed = false;

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

const char* motion_name() {
  static char label[24];
  switch (motion_state) {
    case MotionState::Extend:
    case MotionState::Retract:
      snprintf(label, sizeof(label), "%s - %lu MS",
               motion_state == MotionState::Extend ? "EXTEND" : "RETRACT",
               static_cast<unsigned long>(kJogDurationMs));
      return label;
    case MotionState::Stop:
    default:
      return armed ? "ARMED / STOPPED" : "DISARMED / STOPPED";
  }
}

const char* serial_motion_name() {
  switch (motion_state) {
    case MotionState::Extend:
      return "EXTEND";
    case MotionState::Retract:
      return "RETRACT";
    case MotionState::Stop:
    default:
      return "STOP";
  }
}

void draw_state() {
  panel.fillScreen(kDarkBlue);
  panel.fillRect(0, 0, 320, 54, kMetsBlue);
  panel.fillRect(0, 50, 320, 4, kMetsOrange);
  draw_centered(kDisplayTitle, 160, 17, 2, ST77XX_WHITE);

  const std::uint16_t state_color =
      motion_state == MotionState::Stop && !armed ? kMutedBlue : kMetsOrange;
  draw_centered(motion_name(), 160, 82, 2, state_color);

  panel.drawRoundRect(35, 124, 250, 55, 7, kMutedBlue);
  draw_centered("MAXIMUM OUTPUT WINDOW", 160, 135, 1, kMutedBlue);
  char duration_label[16];
  snprintf(duration_label, sizeof(duration_label), "%lu MS",
           static_cast<unsigned long>(kJogDurationMs));
  draw_centered(duration_label, 160, 153, 2, ST77XX_WHITE);

  draw_centered("a=ARM  u=EXTEND  d=RETRACT", 160, 201, 1, kMutedBlue);
  draw_centered("x=STOP + DISARM", 160, 216, 1, kMutedBlue);
}

void publish_status() {
  Serial.printf(
      "APPLE_JOG:{\"type\":\"status\",\"firmwareVersion\":\"%s\","
      "\"armed\":%s,\"motion\":\"%s\",\"maxJogMs\":%lu}\n",
      kFirmwareVersion, armed ? "true" : "false", serial_motion_name(),
      static_cast<unsigned long>(kJogDurationMs));
}

void stop_motion() {
  digitalWrite(kMotorEnablePin, LOW);
  digitalWrite(kMotorIn1Pin, LOW);
  digitalWrite(kMotorIn2Pin, LOW);
  motion_state = MotionState::Stop;
  jog_ends_at_ms = 0;
  draw_state();
  publish_status();
}

void disarm() {
  armed = false;
  arm_expires_at_ms = 0;
  stop_motion();
  Serial.println("ACTUATOR_JOG=DISARMED");
}

void arm() {
  stop_motion();
  armed = true;
  arm_expires_at_ms = millis() + kArmWindowMs;
  draw_state();
  Serial.println("ACTUATOR_JOG=ARMED AUTO_DISARM_MS=60000");
  publish_status();
}

void start_jog(MotionState next_state) {
  if (!armed) {
    Serial.println("ACTUATOR_JOG=REJECTED REASON=DISARMED");
    publish_status();
    return;
  }
  if (motion_state != MotionState::Stop) {
    Serial.println("ACTUATOR_JOG=REJECTED REASON=BUSY");
    publish_status();
    return;
  }

  stop_motion();
  delay(kBreakBeforeReverseMs);
  digitalWrite(kMotorIn1Pin,
               next_state == MotionState::Extend ? HIGH : LOW);
  digitalWrite(kMotorIn2Pin,
               next_state == MotionState::Retract ? HIGH : LOW);
  digitalWrite(kMotorEnablePin, HIGH);
  motion_state = next_state;
  jog_ends_at_ms = millis() + kJogDurationMs;
  draw_state();
  publish_status();
}

void service_safety_timeouts(std::uint32_t now_ms) {
  if (jog_ends_at_ms != 0 &&
      static_cast<std::int32_t>(now_ms - jog_ends_at_ms) >= 0) {
    // One arm authorizes exactly one jog. Auto-stop also disarms so a held or
    // repeated serial key can never extend the output window.
    disarm();
    Serial.println("ACTUATOR_JOG=AUTO_STOP");
  }

  if (armed && static_cast<std::int32_t>(now_ms - arm_expires_at_ms) >= 0) {
    disarm();
    Serial.println("ACTUATOR_JOG=ARM_EXPIRED");
  }
}

}  // namespace

void setup() {
  // Set the output latches LOW before any peripheral or serial setup.
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
  disarm();
  Serial.printf(
      "APPLE_JOG:{\"type\":\"hello\",\"profile\":\"%s\","
      "\"firmwareVersion\":\"%s\",\"maxJogMs\":%lu,"
      "\"armWindowMs\":%lu}\n",
      kFirmwareProfile, kFirmwareVersion,
      static_cast<unsigned long>(kJogDurationMs),
      static_cast<unsigned long>(kArmWindowMs));
  Serial.println("ACTUATOR_JOG=READY COMMANDS=a:arm u:extend d:retract "
                 "x:stop_and_disarm ?:status");
}

void loop() {
  service_safety_timeouts(millis());

  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    if (command == 'x' || command == 'X') {
      disarm();
    } else if (command == 'a' || command == 'A') {
      arm();
    } else if (command == 'u' || command == 'U') {
      start_jog(MotionState::Extend);
    } else if (command == 'd' || command == 'D') {
      start_jog(MotionState::Retract);
    } else if (command == '?') {
      publish_status();
    }
  }
}
