#pragma once

// The pins the autonomous Apple uses besides the display, whose pins live in
// include/apple/firmware/board_pins.hpp with the rest of the board.

#include <Arduino.h>

#include <cstdint>

namespace apple::live {

// L298N motor driver.
constexpr std::uint8_t kMotorIn1Pin = D4;
constexpr std::uint8_t kMotorIn2Pin = D5;
constexpr std::uint8_t kMotorEnablePin = D6;
// Owner reset button to ground (internal pull-up). Hold clears Wi-Fi and
// settings; a short press shows the address and the code.
constexpr std::uint8_t kResetButtonPin = D3;

// Celebration audio. The card has its own SPI bus on the second host, not
// the display's. Sharing the display's clock line put a second load and a
// splice stub on it, and that line is what interferes with the amplifier;
// with the card taken off it, a 100 ohm series resistor at the Nano end of
// D13 is enough for clean audio at the display's full 32 MHz. Measured on the
// bench 2026-09-04. See public/AUDIO_PLAN.md.
constexpr std::uint8_t kSdChipSelectPin = A0;
constexpr std::uint8_t kSdClockPin = A5;
constexpr std::uint8_t kSdMisoPin = A6;   // the card's DO
constexpr std::uint8_t kSdMosiPin = A7;   // the card's DI
constexpr std::uint8_t kI2sBitClockPin = A1;
constexpr std::uint8_t kI2sWordSelectPin = A2;
constexpr std::uint8_t kI2sDataPin = A3;

}  // namespace apple::live
