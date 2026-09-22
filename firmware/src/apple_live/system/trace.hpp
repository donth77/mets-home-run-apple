#pragma once

// The last traces, kept for the Lab and the Manager: what the Apple did while
// nobody was watching, starting with why it booted. Entries logged before the
// clock synced carry no epoch; readers place them from the uptime instead.

#include <ArduinoJson.h>

#include <cstddef>
#include <cstdint>

namespace apple::live {

struct TraceEntry {
  std::uint32_t seq;
  std::int64_t at_epoch;
  std::uint32_t at_ms;
  char code[20];
  char detail[80];
};
constexpr std::size_t kTraceLogSize = 96;

// Allocates the ring. Until then a trace only reaches the serial line.
void begin_trace_log();
// One trace, to the serial line and the ring.
void publish_trace(const char* code, const char* detail);
// Why the chip last reset, as an upper-case name.
const char* reset_reason_name();
// The ring, oldest first, for the Manager's events endpoint.
void fill_events(JsonDocument& doc);

}  // namespace apple::live
