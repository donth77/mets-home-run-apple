#include "apple_live/system/trace.hpp"

#include "apple_live/system/clock.hpp"
#include "apple_live/system/psram.hpp"

#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <esp_system.h>

namespace apple::live {

using apple::firmware::copy_text;

namespace {

TraceEntry* trace_log = nullptr;  // kTraceLogSize entries, allocated at boot
std::uint32_t trace_seq = 0;

}  // namespace

void begin_trace_log() {
  trace_log = make_array_in_psram<TraceEntry>(kTraceLogSize);
}

void publish_trace(const char* code, const char* detail) {
  Serial.printf("APPLE_LIVE:{\"type\":\"trace\",\"code\":\"%s\",\"detail\":\"%s\"}\n", code, detail);
  if (trace_log == nullptr) return;  // before the ring is allocated, the serial line above is the record
  TraceEntry& entry = trace_log[trace_seq % kTraceLogSize];
  entry.seq = ++trace_seq;
  entry.at_epoch = clock_valid() ? wall_epoch() : 0;
  entry.at_ms = now32();
  copy_text(entry.code, sizeof(entry.code), code);
  copy_text(entry.detail, sizeof(entry.detail), detail);
}

const char* reset_reason_name() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "POWER_ON";
    case ESP_RST_EXT: return "EXTERNAL";
    case ESP_RST_SW: return "SOFTWARE";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INTERRUPT_WATCHDOG";
    case ESP_RST_TASK_WDT: return "TASK_WATCHDOG";
    case ESP_RST_WDT: return "WATCHDOG";
    case ESP_RST_DEEPSLEEP: return "DEEP_SLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "UNKNOWN";
  }
}

void fill_events(JsonDocument& doc) {
  doc["now"] = clock_valid() ? wall_epoch() : 0;
  doc["uptimeMs"] = now32();
  doc["resetReason"] = reset_reason_name();
  JsonArray events = doc["events"].to<JsonArray>();
  const std::uint32_t count = trace_seq < kTraceLogSize ? trace_seq : kTraceLogSize;
  for (std::uint32_t i = 0; i < count; ++i) {
    const TraceEntry& entry = trace_log[(trace_seq - count + i) % kTraceLogSize];
    JsonObject item = events.add<JsonObject>();
    item["seq"] = entry.seq;
    item["at"] = entry.at_epoch;
    item["ms"] = entry.at_ms;
    item["code"] = entry.code;
    item["detail"] = entry.detail;
  }
}

}  // namespace apple::live
