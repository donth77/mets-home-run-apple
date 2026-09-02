#include "apple/firmware/board_pins.hpp"

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <SPI.h>

#include <cstddef>
#include <cstdint>

namespace {

using apple::firmware::kDisplayChipSelectPin;
using apple::firmware::kDisplayDataCommandPin;
using apple::firmware::kDisplayResetPin;

constexpr std::uint8_t kMotorIn1Pin = D4;
constexpr std::uint8_t kMotorIn2Pin = D5;
constexpr std::uint8_t kMotorEnablePin = D6;
constexpr std::uint32_t kSelfTestIntentMs = 1'000;
constexpr std::uint32_t kSelfTestPauseMs = 350;
constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr std::uint32_t kBenchProtocolVersion = 1;
constexpr char kFirmwareVersion[] = "0.1.0";

constexpr std::uint16_t kMetsBlue = 0x016E;
constexpr std::uint16_t kMetsOrange = 0xFAC2;
constexpr std::uint16_t kDarkBlue = 0x0008;
constexpr std::uint16_t kMutedBlue = 0x5B2E;

enum class LogicState : std::uint8_t {
  Stop,
  Raise,
  Lower,
};

enum class SelfTestStage : std::uint8_t {
  Idle,
  Raise,
  Pause,
  Lower,
};

Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin,
                      kDisplayResetPin);
LogicState logic_state = LogicState::Stop;
std::uint32_t stop_at_ms = 0;
SelfTestStage self_test_stage = SelfTestStage::Idle;
std::uint32_t self_test_stage_ends_at_ms = 0;

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

const char* state_name(LogicState state) {
  switch (state) {
    case LogicState::Raise:
      return "RAISE INTENT";
    case LogicState::Lower:
      return "LOWER INTENT";
    case LogicState::Stop:
    default:
      return "STOP / DISARMED";
  }
}

void publish_hello() {
  Serial.printf(
      "APPLE_BENCH:{\"type\":\"hello\",\"protocolVersion\":%lu,"
      "\"profile\":\"motor_logic_test\",\"firmwareVersion\":\"%s\","
      "\"safetyMode\":\"USB_LOGIC_ONLY\"}\n",
      static_cast<unsigned long>(kBenchProtocolVersion), kFirmwareVersion);
}

void publish_state() {
  Serial.printf(
      "APPLE_BENCH:{\"type\":\"state\",\"state\":\"%s\",\"ena\":%u,"
      "\"in1\":%u,\"in2\":%u}\n",
      logic_state == LogicState::Raise
          ? "RAISE"
          : logic_state == LogicState::Lower ? "LOWER" : "STOP",
      logic_state == LogicState::Stop ? 0U : 1U,
      logic_state == LogicState::Raise ? 1U : 0U,
      logic_state == LogicState::Lower ? 1U : 0U);
}

void publish_self_test(const char* status) {
  Serial.printf(
      "APPLE_BENCH:{\"type\":\"test\",\"name\":\"motor_logic\","
      "\"status\":\"%s\"}\n",
      status);
}

void draw_state() {
  panel.fillScreen(kDarkBlue);
  panel.fillRect(0, 0, 320, 54, kMetsBlue);
  panel.fillRect(0, 50, 320, 4, kMetsOrange);
  draw_centered("MOTOR LOGIC TEST", 160, 17, 2, ST77XX_WHITE);

  const std::uint16_t state_color =
      logic_state == LogicState::Stop ? kMutedBlue : kMetsOrange;
  draw_centered(state_name(logic_state), 160, 79, 3, state_color);

  panel.drawRoundRect(30, 122, 260, 64, 7, kMutedBlue);
  constexpr std::int16_t kColumnCenters[] = {74, 160, 246};
  constexpr const char* kColumnLabels[] = {"ENA", "IN1", "IN2"};
  const unsigned values[] = {
      logic_state == LogicState::Stop ? 0U : 1U,
      logic_state == LogicState::Raise ? 1U : 0U,
      logic_state == LogicState::Lower ? 1U : 0U,
  };
  for (std::size_t index = 0; index < 3; ++index) {
    draw_centered(kColumnLabels[index], kColumnCenters[index], 132, 1,
                  kMutedBlue);
    char value[2] = {static_cast<char>('0' + values[index]), '\0'};
    draw_centered(value, kColumnCenters[index], 151, 3, ST77XX_WHITE);
  }

  draw_centered("USB ONLY - NO 12V - NO ACTUATOR", 160, 207, 1,
                kMutedBlue);
}

void stop_logic() {
  digitalWrite(kMotorEnablePin, LOW);
  digitalWrite(kMotorIn1Pin, LOW);
  digitalWrite(kMotorIn2Pin, LOW);
  logic_state = LogicState::Stop;
  stop_at_ms = 0;
  draw_state();
  Serial.println("LOGIC_STATE=STOP ENA=0 IN1=0 IN2=0");
  publish_state();
}

void set_logic_intent(LogicState next_state, std::uint32_t duration_ms) {
  stop_logic();
  delay(50);

  digitalWrite(kMotorIn1Pin,
               next_state == LogicState::Raise ? HIGH : LOW);
  digitalWrite(kMotorIn2Pin,
               next_state == LogicState::Lower ? HIGH : LOW);
  digitalWrite(kMotorEnablePin, HIGH);

  logic_state = next_state;
  stop_at_ms = millis() + duration_ms;
  draw_state();
  Serial.printf("LOGIC_STATE=%s ENA=1 IN1=%u IN2=%u AUTO_STOP_MS=%lu\n",
                next_state == LogicState::Raise ? "RAISE" : "LOWER",
                next_state == LogicState::Raise ? 1U : 0U,
                next_state == LogicState::Lower ? 1U : 0U,
                static_cast<unsigned long>(duration_ms));
  publish_state();
}

void cancel_self_test(const char* status) {
  if (self_test_stage == SelfTestStage::Idle) {
    return;
  }
  self_test_stage = SelfTestStage::Idle;
  self_test_stage_ends_at_ms = 0;
  publish_self_test(status);
}

void start_self_test() {
  cancel_self_test("CANCELLED");
  stop_logic();
  publish_self_test("STARTED");
  self_test_stage = SelfTestStage::Raise;
  set_logic_intent(LogicState::Raise, kSelfTestIntentMs);
  self_test_stage_ends_at_ms = millis() + kSelfTestIntentMs;
}

void service_self_test(std::uint32_t now_ms) {
  if (self_test_stage == SelfTestStage::Idle ||
      static_cast<std::int32_t>(now_ms - self_test_stage_ends_at_ms) < 0) {
    return;
  }

  switch (self_test_stage) {
    case SelfTestStage::Raise:
      stop_logic();
      self_test_stage = SelfTestStage::Pause;
      self_test_stage_ends_at_ms = millis() + kSelfTestPauseMs;
      break;
    case SelfTestStage::Pause:
      self_test_stage = SelfTestStage::Lower;
      set_logic_intent(LogicState::Lower, kSelfTestIntentMs);
      self_test_stage_ends_at_ms = millis() + kSelfTestIntentMs;
      break;
    case SelfTestStage::Lower:
      stop_logic();
      self_test_stage = SelfTestStage::Idle;
      self_test_stage_ends_at_ms = 0;
      publish_self_test("PASSED");
      break;
    case SelfTestStage::Idle:
    default:
      break;
  }
}

}  // namespace

void setup() {
  // Apply LOW output latches before initializing any other hardware.
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
  stop_logic();
  publish_hello();
  Serial.println(
      "MOTOR_LOGIC_TEST=READY COMMANDS=t:self_test x:stop ?:status");
  Serial.println("KEEP_12V_OUT1_OUT2_ACTUATOR=DISCONNECTED");
}

void loop() {
  const std::uint32_t now_ms = millis();
  service_self_test(now_ms);
  if (self_test_stage == SelfTestStage::Idle && stop_at_ms != 0 &&
      static_cast<std::int32_t>(now_ms - stop_at_ms) >= 0) {
    stop_logic();
    Serial.println("AUTO_STOP=PASS");
  }

  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    if (command == 'x' || command == 'X') {
      cancel_self_test("CANCELLED");
      stop_logic();
    } else if (command == 't' || command == 'T') {
      start_self_test();
    } else if (command == '?') {
      publish_hello();
      publish_state();
    }
  }

  delay(10);
}
