#pragma once

// Portable MLB schedule adapter: parses the Mets schedule response and picks
// the game the device should follow.

#include <ArduinoJson.h>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace apple::mlb_feed {

/// Value for the schedule's `fields=` query.
const char *schedule_fields();

/// ArduinoJson filter document for the schedule response.
const char *schedule_filter_json();

struct ScheduleTeam {
  std::int32_t id{0};
  std::string abbreviation;
  std::string name;
};

struct ScheduleGame {
  std::int64_t game_pk{0};
  std::int32_t game_number{1};
  std::string official_date; ///< MLB schedule date, e.g. 2026-09-02
  std::string game_date; ///< ISO-8601 UTC, e.g. 2026-09-02T22:40:00Z
  std::string abstract_state;
  std::string detailed_state;
  std::string venue;
  ScheduleTeam away;
  ScheduleTeam home;

  bool live() const;
  bool finished() const;
  /// Postponed, cancelled, or suspended games are not followed.
  bool followable() const;
};

std::vector<ScheduleGame> parse_schedule(ArduinoJson::JsonVariantConst payload);

/// Seconds since the Unix epoch for an ISO-8601 UTC timestamp, or nullopt.
std::optional<std::int64_t> parse_iso8601_utc(std::string_view value);

/// The game to follow now: a live game first, otherwise the next game that
/// has not finished. Returns nullopt when nothing in the list qualifies.
std::optional<ScheduleGame>
choose_game(const std::vector<ScheduleGame> &games, std::int64_t now_epoch);

/// The scheduled second game paired with `game_one`, when both games involve
/// the same clubs and their scheduled starts are within 18 hours.
std::optional<ScheduleGame>
choose_doubleheader_game_two(const std::vector<ScheduleGame> &games,
                             const ScheduleGame &game_one);

/// True when the chosen game deserves live-feed polling: it is live, or its
/// first pitch is within `lead_seconds`, or it has already started.
bool should_poll(const ScheduleGame &game, std::int64_t now_epoch,
                 std::int64_t lead_seconds);

} // namespace apple::mlb_feed
