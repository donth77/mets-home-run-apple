#pragma once

#include <Arduino.h>

#include <cstdint>

namespace apple::firmware {

// These are reserved for the future motor adapter. The diagnostic firmware
// never drives them high and has no movement command path.
constexpr std::uint8_t kReservedMotorPinA = D4;
constexpr std::uint8_t kReservedMotorPinB = D5;
constexpr std::uint8_t kReservedMotorPinC = D6;

inline void disarm_motion_outputs() noexcept {
  // Set each output latch before changing its direction to avoid a startup
  // pulse while the pin transitions from high impedance to output.
  digitalWrite(kReservedMotorPinA, LOW);
  digitalWrite(kReservedMotorPinB, LOW);
  digitalWrite(kReservedMotorPinC, LOW);
  pinMode(kReservedMotorPinA, OUTPUT);
  pinMode(kReservedMotorPinB, OUTPUT);
  pinMode(kReservedMotorPinC, OUTPUT);
}

}  // namespace apple::firmware
