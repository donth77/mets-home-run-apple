// The Manager's time zone table: every id and alias resolves, ids are unique,
// and every POSIX rule is one the C library accepts with letter-only
// abbreviations (the display prints them after the game time).

#include "apple/firmware/time_zones.hpp"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <set>
#include <sstream>
#include <string>

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
  if (!ok) {
    ++failures;
    std::printf("FAIL: %s\n", what.c_str());
  }
}

bool letters_only(const char* s) {
  if (s == nullptr || s[0] == '\0') return false;
  for (const char* p = s; *p != '\0'; ++p) {
    if (!std::isalpha(static_cast<unsigned char>(*p))) return false;
  }
  return true;
}

// Formats a fixed UTC instant under `posix` and returns the zone abbreviation
// plus the local hour, so the rule can be checked against known answers.
std::string zone_abbreviation(const char* posix, time_t at, int* hour) {
  setenv("TZ", posix, 1);
  tzset();
  struct tm local;
  localtime_r(&at, &local);
  char buf[16];
  strftime(buf, sizeof(buf), "%Z", &local);
  if (hour != nullptr) *hour = local.tm_hour;
  return buf;
}

}  // namespace

int main() {
  using apple::firmware::find_time_zone;
  using apple::firmware::TimeZoneInfo;
  std::size_t count = 0;
  const TimeZoneInfo* zones = apple::firmware::time_zones(count);
  check(count >= 30, "table has the expected number of zones");

  std::set<std::string> ids;
  for (std::size_t i = 0; i < count; ++i) {
    const TimeZoneInfo& z = zones[i];
    check(ids.insert(z.id).second, std::string("duplicate id ") + z.id);
    check(find_time_zone(z.id) == &z, std::string("id resolves to itself: ") + z.id);
    check(std::strlen(z.id) < 40, std::string("id fits the settings buffer: ") + z.id);
    std::istringstream aliases(z.aliases);
    std::string alias;
    while (aliases >> alias) {
      check(find_time_zone(alias.c_str()) == &z, "alias " + alias + " resolves to " + z.id);
      check(ids.count(alias) == 0, "alias " + alias + " is also a primary id");
    }
  }

  // 2026-07-15T17:00:00Z: summer, so daylight rules are in force in the north.
  const time_t summer = 1784134800;
  // 2026-01-15T17:00:00Z: winter.
  const time_t winter = 1768496400;
  for (std::size_t i = 0; i < count; ++i) {
    const TimeZoneInfo& z = zones[i];
    int hour = -1;
    const std::string s = zone_abbreviation(z.posix, summer, &hour);
    const std::string w = zone_abbreviation(z.posix, winter, nullptr);
    check(letters_only(s.c_str()), std::string("summer abbreviation is letters for ") + z.id + ": " + s);
    check(letters_only(w.c_str()), std::string("winter abbreviation is letters for ") + z.id + ": " + w);
    check(hour >= 0 && hour < 24, std::string("local hour parses for ") + z.id);
  }

  // Known answers.
  int hour = -1;
  check(zone_abbreviation(find_time_zone("America/New_York")->posix, summer, &hour) == "EDT" && hour == 13,
        "New York: 17:00Z in July is 1 PM EDT");
  check(zone_abbreviation(find_time_zone("America/New_York")->posix, winter, &hour) == "EST" && hour == 12,
        "New York: 17:00Z in January is noon EST");
  check(zone_abbreviation(find_time_zone("America/Chicago")->posix, summer, &hour) == "CDT" && hour == 12,
        "Chicago: 17:00Z in July is noon CDT");
  check(zone_abbreviation(find_time_zone("America/Phoenix")->posix, summer, &hour) == "MST" && hour == 10,
        "Phoenix stays on MST in July");
  check(zone_abbreviation(find_time_zone("Australia/Sydney")->posix, winter, &hour) == "AEDT" && hour == 4,
        "Sydney: 17:00Z in January is 4 AM AEDT the next day");
  check(zone_abbreviation(find_time_zone("Europe/London")->posix, summer, &hour) == "BST" && hour == 18,
        "London: 17:00Z in July is 6 PM BST");

  // Aliases and unknowns.
  check(find_time_zone("America/Toronto") == find_time_zone("America/New_York"), "Toronto shares Eastern");
  check(find_time_zone("US/Pacific") == find_time_zone("America/Los_Angeles"), "US/Pacific shares Pacific");
  check(find_time_zone("Mars/Olympus_Mons") == nullptr, "unknown id is rejected");
  check(find_time_zone("") == nullptr, "empty id is rejected");
  check(find_time_zone(nullptr) == nullptr, "null id is rejected");
  check(find_time_zone("America/New") == nullptr, "a prefix of an id does not match");

  if (failures == 0) std::printf("time zone tests passed\n");
  return failures == 0 ? 0 : 1;
}
