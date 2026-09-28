#include "apple/mlb_feed/season.hpp"

#include "apple/mlb_feed/feed.hpp"

#include <string_view>

namespace apple::mlb_feed {
namespace {

using ArduinoJson::JsonArrayConst;
using ArduinoJson::JsonVariantConst;

constexpr char kTeamStandingFields[] =
    "teams,id,record,clinched,eliminationNumber,wildCardEliminationNumber";

constexpr char kTeamStandingFilter[] = R"({
  "teams": [{"id": true,
    "record": {"clinched": true, "eliminationNumber": true, "wildCardEliminationNumber": true}}]
})";

bool eliminated_mark(JsonVariantConst value) {
  const char *raw = value.as<const char *>();
  return raw != nullptr && std::string_view(raw) == "E";
}

}  // namespace

const char *team_standing_fields() { return kTeamStandingFields; }

const char *team_standing_filter_json() { return kTeamStandingFilter; }

std::optional<TeamStanding> parse_team_standing(JsonVariantConst payload) {
  for (JsonVariantConst team : payload["teams"].as<JsonArrayConst>()) {
    if (team["id"].as<long>() != kMetsTeamId)
      continue;
    JsonVariantConst record = team["record"];
    if (!record["clinched"].is<bool>())
      return std::nullopt;
    TeamStanding standing;
    standing.clinched = record["clinched"].as<bool>();
    standing.eliminated = !standing.clinched && eliminated_mark(record["eliminationNumber"]) &&
                          eliminated_mark(record["wildCardEliminationNumber"]);
    return standing;
  }
  return std::nullopt;
}

bool postseason_run_over(const std::vector<ScheduleGame> &games) {
  const ScheduleGame *last = nullptr;
  std::int64_t last_start = 0;
  for (const ScheduleGame &game : games) {
    if (!game.postseason() || !game.finished())
      continue;
    const std::optional<std::int64_t> start = parse_iso8601_utc(game.game_date);
    if (!start)
      continue;
    if (last == nullptr || *start > last_start) {
      last = &game;
      last_start = *start;
    }
  }
  if (last == nullptr || !last->series_status.present || !last->series_status.is_over)
    return false;
  if (last->series_status.losing_team_id == kMetsTeamId)
    return true;
  return last->game_type == "W" && last->series_status.winning_team_id == kMetsTeamId;
}

bool season_facts_needed(int month) { return month == 9 || month == 10; }

IdleCard idle_card(int month, const std::optional<TeamStanding> &standing,
                   std::optional<bool> postseason_over) {
  if (month == 11 || month == 12 || month == 1 || month == 2)
    return IdleCard::Offseason;
  if (season_facts_needed(month) && standing) {
    if (standing->eliminated)
      return IdleCard::Offseason;
    if (standing->clinched)
      return postseason_over.value_or(false) ? IdleCard::Offseason : IdleCard::NextGameTbd;
  }
  return IdleCard::NoGameThisWeek;
}

int next_season_year(int year, int month) { return month >= 3 ? year + 1 : year; }

std::uint32_t idle_schedule_refresh_ms(IdleCard card) {
  constexpr std::uint32_t kHourMs = 60UL * 60 * 1000;
  return card == IdleCard::Offseason ? 6 * kHourMs : kHourMs;
}

}  // namespace apple::mlb_feed
