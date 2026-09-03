#include "apple/mlb_feed/schedule.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>

namespace apple::mlb_feed {
namespace {

using ArduinoJson::JsonArrayConst;
using ArduinoJson::JsonObjectConst;
using ArduinoJson::JsonVariantConst;

constexpr char kScheduleFields[] =
    "dates,date,games,gamePk,gameNumber,gameDate,status,abstractGameState,"
    "detailedState,teams,away,home,team,id,abbreviation,name,venue";

constexpr char kScheduleFilter[] = R"({
  "dates": [{"date": true,
    "games": [{
      "gamePk": true, "gameNumber": true, "gameDate": true,
      "status": {"abstractGameState": true, "detailedState": true},
      "venue": {"name": true},
      "teams": {
        "away": {"team": {"id": true, "abbreviation": true, "name": true}},
        "home": {"team": {"id": true, "abbreviation": true, "name": true}}
      }
    }]
  }]
})";

std::string_view text(JsonVariantConst value, std::string_view fallback = {}) {
  const char *raw = value.as<const char *>();
  return raw != nullptr ? std::string_view(raw) : fallback;
}

long integer(JsonVariantConst value, long fallback = 0) {
  if (value.is<long>())
    return value.as<long>();
  if (value.is<double>())
    return static_cast<long>(value.as<double>());
  return fallback;
}

std::string lower(std::string_view value) {
  std::string out(value);
  for (char &c : out)
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return out;
}

bool contains(std::string_view haystack, std::string_view needle) {
  return haystack.find(needle) != std::string_view::npos;
}

ScheduleTeam schedule_team(JsonVariantConst value) {
  JsonVariantConst team = value["team"];
  ScheduleTeam out;
  out.id = static_cast<std::int32_t>(integer(team["id"]));
  out.abbreviation = std::string(text(team["abbreviation"], "\xE2\x80\x94"));
  out.name = std::string(text(team["name"], "Unknown team"));
  return out;
}

bool digits(std::string_view value, std::size_t begin, std::size_t count) {
  if (begin + count > value.size())
    return false;
  for (std::size_t index = begin; index < begin + count; ++index) {
    if (!std::isdigit(static_cast<unsigned char>(value[index])))
      return false;
  }
  return true;
}

long number(std::string_view value, std::size_t begin, std::size_t count) {
  long out = 0;
  for (std::size_t index = begin; index < begin + count; ++index)
    out = out * 10 + (value[index] - '0');
  return out;
}

// Howard Hinnant's days-from-civil algorithm.
std::int64_t days_from_civil(long year, long month, long day) {
  year -= month <= 2 ? 1 : 0;
  const std::int64_t era = (year >= 0 ? year : year - 399) / 400;
  const std::int64_t yoe = year - era * 400;
  const std::int64_t doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const std::int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

} // namespace

const char *schedule_fields() { return kScheduleFields; }

const char *schedule_filter_json() { return kScheduleFilter; }

bool ScheduleGame::live() const { return lower(abstract_state) == "live"; }

bool ScheduleGame::finished() const { return lower(abstract_state) == "final"; }

bool ScheduleGame::followable() const {
  const std::string detailed = lower(detailed_state);
  for (const char *word : {"postponed", "cancelled", "canceled", "suspended"}) {
    if (contains(detailed, word))
      return false;
  }
  return true;
}

std::vector<ScheduleGame> parse_schedule(JsonVariantConst payload) {
  std::vector<ScheduleGame> games;
  for (JsonVariantConst date : payload["dates"].as<JsonArrayConst>()) {
    const std::string official_date(text(date["date"]));
    for (JsonVariantConst candidate : date["games"].as<JsonArrayConst>()) {
      if (!candidate.is<JsonObjectConst>())
        continue;
      const long game_pk = integer(candidate["gamePk"]);
      const long game_number = integer(candidate["gameNumber"], 1);
      JsonVariantConst teams = candidate["teams"];
      if (game_pk <= 0 || (game_number != 1 && game_number != 2) ||
          !teams.is<JsonObjectConst>())
        continue;
      ScheduleGame game;
      game.game_pk = game_pk;
      game.game_number = static_cast<std::int32_t>(game_number);
      game.official_date = official_date;
      game.game_date = std::string(text(candidate["gameDate"]));
      game.abstract_state = std::string(text(candidate["status"]["abstractGameState"], "Preview"));
      game.detailed_state = std::string(text(candidate["status"]["detailedState"], "Scheduled"));
      game.venue = std::string(text(candidate["venue"]["name"]));
      game.away = schedule_team(teams["away"]);
      game.home = schedule_team(teams["home"]);
      games.push_back(std::move(game));
    }
  }
  return games;
}

std::optional<std::int64_t> parse_iso8601_utc(std::string_view value) {
  // 2026-09-02T22:40:00Z, optionally with fractional seconds.
  if (value.size() < 20 || !digits(value, 0, 4) || value[4] != '-' || !digits(value, 5, 2) ||
      value[7] != '-' || !digits(value, 8, 2) || value[10] != 'T' || !digits(value, 11, 2) ||
      value[13] != ':' || !digits(value, 14, 2) || value[16] != ':' || !digits(value, 17, 2))
    return std::nullopt;
  std::size_t cursor = 19;
  if (cursor < value.size() && value[cursor] == '.') {
    ++cursor;
    while (cursor < value.size() && std::isdigit(static_cast<unsigned char>(value[cursor])))
      ++cursor;
  }
  if (cursor >= value.size() || value[cursor] != 'Z' || cursor + 1 != value.size())
    return std::nullopt;
  const long year = number(value, 0, 4);
  const long month = number(value, 5, 2);
  const long day = number(value, 8, 2);
  const long hour = number(value, 11, 2);
  const long minute = number(value, 14, 2);
  const long second = number(value, 17, 2);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60)
    return std::nullopt;
  return days_from_civil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second;
}

std::optional<ScheduleGame> choose_game(const std::vector<ScheduleGame> &games,
                                        std::int64_t now_epoch) {
  const ScheduleGame *live = nullptr;
  const ScheduleGame *next = nullptr;
  std::int64_t next_start = 0;
  for (const ScheduleGame &game : games) {
    if (!game.followable())
      continue;
    if (game.live()) {
      if (live == nullptr)
        live = &game;
      continue;
    }
    if (game.finished())
      continue;
    const std::optional<std::int64_t> start = parse_iso8601_utc(game.game_date);
    if (!start)
      continue;
    // A game whose first pitch passed hours ago without going live is stale
    // schedule data; keep looking for one that can still start.
    if (*start + 6 * 3600 < now_epoch)
      continue;
    if (next == nullptr || *start < next_start ||
        (*start == next_start && game.game_number < next->game_number)) {
      next = &game;
      next_start = *start;
    }
  }
  if (live != nullptr)
    return *live;
  if (next != nullptr)
    return *next;
  return std::nullopt;
}

std::optional<ScheduleGame>
choose_doubleheader_game_two(const std::vector<ScheduleGame> &games,
                             const ScheduleGame &game_one) {
  if (game_one.game_number != 1)
    return std::nullopt;
  const std::optional<std::int64_t> game_one_start =
      parse_iso8601_utc(game_one.game_date);
  if (!game_one_start)
    return std::nullopt;

  const ScheduleGame *next = nullptr;
  std::int64_t next_start = 0;
  for (const ScheduleGame &candidate : games) {
    if (candidate.game_pk == game_one.game_pk || candidate.game_number != 2 ||
        candidate.finished() || !candidate.followable())
      continue;
    const bool same_matchup =
        (candidate.away.id == game_one.away.id &&
         candidate.home.id == game_one.home.id) ||
        (candidate.away.id == game_one.home.id &&
         candidate.home.id == game_one.away.id);
    if (!same_matchup)
      continue;
    if (!game_one.official_date.empty() && !candidate.official_date.empty() &&
        game_one.official_date != candidate.official_date)
      continue;
    const std::optional<std::int64_t> start =
        parse_iso8601_utc(candidate.game_date);
    if (!start)
      continue;
    const std::int64_t separation = *start - *game_one_start;
    if (separation < 0 || separation > 18 * 3600)
      continue;
    if (next == nullptr || *start < next_start) {
      next = &candidate;
      next_start = *start;
    }
  }
  return next == nullptr ? std::nullopt
                         : std::optional<ScheduleGame>(*next);
}

bool should_poll(const ScheduleGame &game, std::int64_t now_epoch, std::int64_t lead_seconds) {
  if (game.live())
    return true;
  if (game.finished())
    return false;
  const std::optional<std::int64_t> start = parse_iso8601_utc(game.game_date);
  if (!start)
    return false;
  return *start - lead_seconds <= now_epoch;
}

} // namespace apple::mlb_feed
