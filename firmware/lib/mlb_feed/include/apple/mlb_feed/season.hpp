#pragma once

// What the Apple shows when no Mets game is within the week: the facts that
// say whether the Mets' season is over, and the decision itself.

#include "apple/mlb_feed/schedule.hpp"

#include <ArduinoJson.h>

#include <cstdint>
#include <optional>
#include <vector>

namespace apple::mlb_feed {

/// The Mets' place in the postseason race, from
/// /api/v1/teams/121?season=YYYY&hydrate=standings.
struct TeamStanding {
  bool clinched{false};    ///< a postseason berth is theirs
  bool eliminated{false};  ///< out of both the division and wild-card races
};

/// Value for the team-standing request's `fields=` query.
const char *team_standing_fields();

/// ArduinoJson filter document for the team-standing response.
const char *team_standing_filter_json();

/// The Mets' standing, or nullopt when the response does not carry one.
std::optional<TeamStanding> parse_team_standing(ArduinoJson::JsonVariantConst payload);

/// True once the Mets' postseason is over: the last series they finished
/// ended in a loss, or it was the World Series. `games` is their postseason
/// schedule for the season, asked for with `hydrate=seriesStatus`.
bool postseason_run_over(const std::vector<ScheduleGame> &games);

enum class IdleCard : std::uint8_t {
  NoGameThisWeek,  ///< inside the season, nothing scheduled within the week
  NextGameTbd,     ///< still in the postseason, the next round not yet listed
  Offseason,       ///< the Mets' season is over
};

/// Whether the standing (and, once clinched, the postseason run) decides the
/// idle card this month. Only around the end of the season: September and
/// October. `month` is 1..12.
bool season_facts_needed(int month);

/// The card for a week with nothing to follow. November through February
/// has no Mets games unless spring training has come within the week, so it
/// is the offseason. In September and October the season is over once the
/// Mets are out of the race or out of the postseason. `postseason_over` is
/// only consulted after a clinch.
IdleCard idle_card(int month, const std::optional<TeamStanding> &standing,
                   std::optional<bool> postseason_over);

/// The season the offseason card looks ahead to: the next one from March on,
/// the coming one in January and February.
int next_season_year(int year, int month);

}  // namespace apple::mlb_feed
