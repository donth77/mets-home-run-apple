#pragma once

// Memory helpers: the celebration renderers and the scan-locked panel carry
// large frame buffers. Placing them in PSRAM leaves internal RAM for Wi-Fi
// and TLS.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>

#include <cstddef>
#include <cstdlib>
#include <new>

namespace apple::live {

template <typename T, typename... Args>
T* make_in_psram(Args&&... args) {
  void* memory = nullptr;
  if (psramFound()) memory = heap_caps_malloc(sizeof(T), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (memory == nullptr) memory = malloc(sizeof(T));
  return new (memory) T(static_cast<Args&&>(args)...);
}

// The array form of make_in_psram, for the catalogue and the trace ring: 28 KB
// of tables that no interrupt touches, and that a TLS handshake wants the
// internal RAM back from.
template <typename T>
T* make_array_in_psram(std::size_t count) {
  void* memory = psramFound() ? heap_caps_malloc(sizeof(T) * count, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) : nullptr;
  if (memory == nullptr) memory = malloc(sizeof(T) * count);
  if (memory == nullptr) return nullptr;
  T* slots = static_cast<T*>(memory);
  for (std::size_t i = 0; i < count; ++i) new (&slots[i]) T();
  return slots;
}

struct SpiRamAllocator final : ArduinoJson::Allocator {
  void* allocate(size_t size) override {
    void* memory = psramFound() ? heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) : nullptr;
    return memory != nullptr ? memory : malloc(size);
  }
  void deallocate(void* pointer) override { free(pointer); }
  void* reallocate(void* pointer, size_t size) override {
    if (psramFound()) return heap_caps_realloc(pointer, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    return realloc(pointer, size);
  }
};

// Every large JSON document is allocated through this.
extern SpiRamAllocator json_allocator;

}  // namespace apple::live
