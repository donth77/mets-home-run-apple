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

/// Where a postseason series stands after a game. Present only when the
/// schedule was asked for `hydrate=seriesStatus`.
struct ScheduleSeriesStatus {
  bool present{false};
  bool is_over{false};
  std::int32_t winning_team_id{0};
  std::int32_t losing_team_id{0};
};

struct ScheduleGame {
  std::int64_t game_pk{0};
  std::int32_t game_number{1};
  std::string official_date; ///< MLB schedule date, e.g. 2026-09-02
  std::string game_date; ///< ISO-8601 UTC, e.g. 2026-09-02T22:40:00Z
  std::string abstract_state;
  std::string detailed_state;
  std::string venue;
  /// MLB's gameType: R regular season, S spring training, E exhibition,
  /// F Wild Card, D Division Series, L League Championship, W World Series.
  std::string game_type{"R"};
  std::string series_description; ///< e.g. "NL Division Series"
  std::int32_t series_game_number{0};
  /// MLB lists a start time before it is set, at 3:33 AM Eastern.
  bool start_time_tbd{false};
  ScheduleSeriesStatus series_status;
  ScheduleTeam away;
  ScheduleTeam home;

  bool live() const;
  bool finished() const;
  /// Postponed, cancelled, or suspended games are not followed.
  bool followable() const;
  /// Spring training and exhibition games.
  bool spring() const;
  bool postseason() const;
};

std::vector<ScheduleGame> parse_schedule(ArduinoJson::JsonVariantConst payload);

/// What kind of game this is when it is not the regular season, in capitals
/// for the panel: SPRING TRAINING, EXHIBITION, WILD CARD GAME 2, NLDS GAME 3,
/// NLCS GAME 5, WORLD SERIES GAME 7. Empty for a regular season game.
std::string game_label(const ScheduleGame &game);

/// True for the away half of a split-squad day: two spring games on the same
/// date against different clubs, where the Apple follows the one at home.
bool yields_to_home_split_squad(const ScheduleGame &game,
                                const std::vector<ScheduleGame> &games);

/// Seconds since the Unix epoch for an ISO-8601 UTC timestamp, or nullopt.
std::optional<std::int64_t> parse_iso8601_utc(std::string_view value);

/// The game to follow now: a live game first, otherwise the next game that
/// has not finished. The away half of a split-squad day is never chosen.
/// Returns nullopt when nothing in the list qualifies.
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
