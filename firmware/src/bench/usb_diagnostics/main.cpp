#include "apple/firmware/board_pins.hpp"
#include "apple/firmware/diagnostics.hpp"

#include <Arduino.h>

#include <cstdint>

namespace {

constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;

}  // namespace

void setup() {
  // This must remain the first hardware action in diagnostic firmware.
  apple::firmware::disarm_motion_outputs();

  Serial.begin(115200);
  const std::uint32_t serial_wait_started_ms = millis();
  while (!Serial && millis() - serial_wait_started_ms < kSerialWaitTimeoutMs) {
    delay(10);
  }

  apple::firmware::run_boot_diagnostics();
}

void loop() {
  apple::firmware::disarm_motion_outputs();
  apple::firmware::service_diagnostics(millis());
  delay(10);
}
