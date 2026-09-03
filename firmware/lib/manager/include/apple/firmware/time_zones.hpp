#pragma once

#include <cstddef>

namespace apple::firmware {

/// One owner-selectable time zone. The Apple's clock library takes POSIX
/// rules, not IANA names, so each entry pairs the IANA id a browser reports
/// with the rule the firmware applies. `aliases` lists other IANA ids that
/// share the same clock, space separated.
struct TimeZoneInfo {
  const char* id;       ///< primary IANA id, e.g. "America/Chicago"
  const char* label;    ///< shown in the Manager, e.g. "Central (Chicago)"
  const char* posix;    ///< rule for setenv("TZ"), e.g. "CST6CDT,M3.2.0,M11.1.0"
  const char* aliases;  ///< other IANA ids that map here, or ""
};

/// The default when nothing is chosen: the Mets play in New York.
constexpr char kDefaultTimeZoneId[] = "America/New_York";

/// Every selectable zone, in Manager display order.
const TimeZoneInfo* time_zones(std::size_t& count);

/// Finds a zone by primary id or alias; nullptr when unknown.
const TimeZoneInfo* find_time_zone(const char* iana_id);

}  // namespace apple::firmware
