#pragma once

#include <Arduino.h>

#include <cstdint>

namespace apple::firmware {

// Motor outputs default LOW. Only dedicated, bounded commissioning firmware
// and the future production motion adapter may drive them high.
constexpr std::uint8_t kReservedMotorPinA = D4;
constexpr std::uint8_t kReservedMotorPinB = D5;
constexpr std::uint8_t kReservedMotorPinC = D6;

// Waveshare 2inch LCD Module (ST7789V, 240 x 320). The display test uses
// hardware SPI on D11 (MOSI) and D13 (SCK); this write-only display has no
// MISO connection. The future microSD adapter can share the SPI bus with its
// own chip-select pin.
constexpr std::uint8_t kDisplayChipSelectPin = D10;
constexpr std::uint8_t kDisplayDataCommandPin = D7;
constexpr std::uint8_t kDisplayResetPin = D8;
constexpr std::uint8_t kDisplayBacklightPin = D9;

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
