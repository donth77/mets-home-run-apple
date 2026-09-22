#pragma once

// Milliseconds since boot from the ESP timer, and the wall clock once NTP has
// set it.

#include <esp_timer.h>

#include <cstdint>
#include <ctime>

namespace apple::live {

inline std::uint64_t now_ms() { return static_cast<std::uint64_t>(esp_timer_get_time() / 1000); }
inline std::uint32_t now32() { return static_cast<std::uint32_t>(now_ms()); }
inline bool due(std::uint32_t at_ms) { return static_cast<std::int32_t>(now32() - at_ms) >= 0; }

inline std::int64_t wall_epoch() { return static_cast<std::int64_t>(time(nullptr)); }
inline bool clock_valid() { return wall_epoch() > 1'700'000'000; }

}  // namespace apple::live
