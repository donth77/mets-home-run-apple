#pragma once

// The microSD card that holds the celebration tracks, on its own SPI bus. A
// missing or unreadable card means the Apple celebrates silently; it is never
// a fault and never delays the lift.

#include <Arduino.h>
#include <SPI.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <cstdint>

namespace apple::live {

constexpr std::uint32_t kSdClockHz = 20'000'000;

extern SPIClass sd_spi;
// Every use of the card takes this lock; see CardLock.
extern SemaphoreHandle_t sd_lock;
struct CardLock {
  CardLock() { if (sd_lock) xSemaphoreTakeRecursive(sd_lock, portMAX_DELAY); }
  ~CardLock() { if (sd_lock) xSemaphoreGiveRecursive(sd_lock); }
};
extern bool audio_card_ready;

// Creates the card lock and starts the card's bus.
void begin_card_bus();

}  // namespace apple::live
