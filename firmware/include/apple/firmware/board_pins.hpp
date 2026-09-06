#pragma once

#include <Arduino.h>

#include <cstdint>

namespace apple::firmware {

// Motor outputs default LOW. Only dedicated, bounded commissioning firmware
// and the future production motion adapter may drive them high.
constexpr std::uint8_t kReservedMotorPinA = D4;
constexpr std::uint8_t kReservedMotorPinB = D5;
constexpr std::uint8_t kReservedMotorPinC = D6;

// Waveshare 2inch LCD Module (ST7789V, 240 x 320), on hardware SPI: D11
// (MOSI) and D13 (SCK); this write-only display has no MISO connection.
//
// Nothing else may share this bus. The microSD card once did, on its own chip
// select, and the second load plus the splice stub on the 32 MHz clock line
// was what made celebration audio break up: that line is the aggressor the
// amplifier hears. The card now runs on the chip's second SPI host, on A5
// (CLK), A6 (DO) and A7 (DI) with A0 as chip select. Found on the bench
// 2026-09-04, after a long detour; see public/AUDIO_PLAN.md.
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
