#include "apple/mlb_feed/feed.hpp"

#include "apple/game_state/status.hpp"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <optional>
#include <utility>
#include <vector>

namespace apple::mlb_feed {
namespace {

using ArduinoJson::JsonArrayConst;
using ArduinoJson::JsonObjectConst;
using ArduinoJson::JsonVariantConst;
using game_state::AtBatState;
using game_state::CanonicalFrame;
using game_state::Half;
using game_state::InningScore;
using game_state::Phase;
using game_state::PlayEvidence;
using game_state::PlayKind;
using game_state::ReviewState;
using game_state::TeamScore;
using game_state::UpdateMode;

// Every key name the extractor reads, at any depth. MLB applies the list at
// every level, so a name such as "id" also keeps ids the extractor ignores;
// the ArduinoJson filter below drops those before they cost memory.
constexpr char kLiveFeedFields[] =
    "gamePk,metaData,timeStamp,wait,gameData,status,abstractGameState,"
    "detailedState,statusCode,reason,teams,away,home,id,abbreviation,teamName,"
    "name,datetime,dateTime,venue,liveData,plays,allPlays,currentPlay,about,"
    "atBatIndex,halfInning,inning,isComplete,result,eventType,rbi,description,"
    "matchup,batter,pitcher,fullName,playEvents,playId,details,reviewDetails,"
    "inProgress,isOverturned,count,balls,strikes,linescore,currentInning,"
    "inningState,inningHalf,outs,innings,num,runs,hits,errors,offense,defense,"
    "first,second,third,boxscore,players,stats,batting,pitching,atBats,"
    "homeRuns,numberOfPitches";

constexpr char kLiveFeedFilter[] = R"({
  "gamePk": true,
  "metaData": {"timeStamp": true, "wait": true},
  "gameData": {
    "status": {"abstractGameState": true, "detailedState": true, "statusCode": true, "reason": true},
    "teams": {
      "away": {"id": true, "abbreviation": true, "teamName": true, "name": true},
      "home": {"id": true, "abbreviation": true, "teamName": true, "name": true}
    },
    "datetime": {"dateTime": true},
    "venue": {"name": true}
  },
  "liveData": {
    "plays": {
      "allPlays": [{
        "about": {"atBatIndex": true, "halfInning": true, "inning": true, "isComplete": true},
        "result": {"eventType": true, "rbi": true},
        "matchup": {"batter": {"fullName": true}},
        "playEvents": [{"playId": true}],
        "reviewDetails": {"inProgress": true, "isOverturned": true}
      }],
      "currentPlay": {
        "about": {"atBatIndex": true, "halfInning": true, "inning": true, "isComplete": true},
        "result": {"eventType": true, "rbi": true, "description": true},
        "matchup": {"batter": {"id": true, "fullName": true}, "pitcher": {"id": true, "fullName": true}},
        "playEvents": [{"playId": true, "details": {"description": true, "eventType": true}}],
        "reviewDetails": {"inProgress": true, "isOverturned": true},
        "count": {"balls": true, "strikes": true}
      }
    },
    "linescore": {
      "currentInning": true, "inningState": true, "inningHalf": true, "outs": true,
      "innings": [{"num": true, "away": {"runs": true}, "home": {"runs": true}}],
      "teams": {
        "away": {"runs": true, "hits": true, "errors": true},
        "home": {"runs": true, "hits": true, "errors": true}
      },
      "offense": {
        "batter": {"id": true, "fullName": true},
        "first": {"id": true}, "second": {"id": true}, "third": {"id": true}
      },
      "defense": {"pitcher": {"id": true, "fullName": true}}
    },
    "boxscore": {"teams": {
      "away": {"players": {"*": {"stats": {
        "batting": {"hits": true, "atBats": true, "homeRuns": true},
        "pitching": {"numberOfPitches": true}
      }}}},
      "home": {"players": {"*": {"stats": {
        "batting": {"hits": true, "atBats": true, "homeRuns": true},
        "pitching": {"numberOfPitches": true}
      }}}}
    }}
  }
})";

std::string_view text(JsonVariantConst value, std::string_view fallback = {}) {
  const char *raw = value.as<const char *>();
  return raw != nullptr ? std::string_view(raw) : fallback;
}

bool is_object(JsonVariantConst value) { return value.is<JsonObjectConst>(); }

long integer(JsonVariantConst value, long fallback = 0) {
  if (value.is<long>())
    return value.as<long>();
  if (value.is<double>())
    return static_cast<long>(value.as<double>());
  return fallback;
}

std::optional<std::int32_t> optional_integer(JsonVariantConst value) {
  if (value.is<long>() || value.is<double>())
    return static_cast<std::int32_t>(integer(value));
  return std::nullopt;
}

bool truthy(JsonVariantConst value) { return value.is<bool>() && value.as<bool>(); }

long clamp_integer(long value, long low, long high) {
  return std::min(std::max(value, low), high);
}

std::string lower(std::string_view value) {
  std::string out(value);
  for (char &c : out)
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return out;
}


std::string trim(std::string_view value) {
  std::size_t begin = 0;
  std::size_t end = value.size();
  while (begin < end && std::isspace(static_cast<unsigned char>(value[begin])))
    ++begin;
  while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1])))
    --end;
  return std::string(value.substr(begin, end - begin));
}

bool valid_timecode(std::string_view value) {
  if (value.size() != 15 || value[8] != '_')
    return false;
  for (std::size_t index = 0; index < value.size(); ++index) {
    if (index == 8)
      continue;
    if (!std::isdigit(static_cast<unsigned char>(value[index])))
      return false;
  }
  return true;
}

ReviewState review_state(JsonVariantConst play) {
  JsonVariantConst details = play["reviewDetails"];
  if (!is_object(details))
    return ReviewState::None;
  if (truthy(details["inProgress"]))
    return ReviewState::Pending;
  if (truthy(details["isOverturned"]))
    return ReviewState::Overturned;
  return ReviewState::Confirmed;
}

Half half_from_text(std::string_view value) {
  const std::string normalized = lower(value);
  if (normalized == "bottom")
    return Half::Bottom;
  if (normalized == "middle")
    return Half::Middle;
  if (normalized == "end")
    return Half::End;
  return Half::Top;
}

// The newest "Game Advisory" event on the current play; MLB puts the
// reason for a mid-game delay there ("Status Change - Delayed: Rain").
std::string latest_game_advisory(JsonVariantConst play) {
  std::string latest;
  for (JsonVariantConst event : play["playEvents"].as<JsonArrayConst>()) {
    JsonVariantConst details = event["details"];
    const std::string description = trim(text(details["description"]));
    if (description.empty())
      continue;
    const bool advisory = text(details["eventType"]) == "game_advisory" ||
                          description.compare(0, 13, "Status Change") == 0;
    if (advisory)
      latest = description;
  }
  return latest;
}

game_state::StatusFacts status_facts(JsonVariantConst feed, ReviewState current_review,
                                     const std::string &advisory) {
  JsonVariantConst status = feed["gameData"]["status"];
  game_state::StatusFacts facts;
  facts.abstract_state = text(status["abstractGameState"]);
  facts.detailed_state = text(status["detailedState"]);
  facts.status_code = text(status["statusCode"]);
  facts.reason = text(status["reason"]);
  facts.latest_advisory = advisory;
  facts.review_pending = current_review == ReviewState::Pending;
  return facts;
}

std::string play_event_key(JsonVariantConst play, std::int64_t game_pk) {
  // The browser adapter takes the last object in playEvents and reads its
  // playId; a missing id falls back to the at-bat index.
  JsonVariantConst last_event;
  for (JsonVariantConst event : play["playEvents"].as<JsonArrayConst>()) {
    if (is_object(event))
      last_event = event;
  }
  const std::string_view play_id = text(last_event["playId"]);
  char buffer[80];
  if (!play_id.empty()) {
    std::snprintf(buffer, sizeof(buffer), "%lld:%.*s", static_cast<long long>(game_pk),
                  static_cast<int>(std::min<std::size_t>(play_id.size(), 60)), play_id.data());
  } else {
    std::snprintf(buffer, sizeof(buffer), "%lld:atbat-%ld", static_cast<long long>(game_pk),
                  integer(play["about"]["atBatIndex"], -1));
  }
  return buffer;
}

std::optional<PlayEvidence> normalize_play(JsonVariantConst play, std::int64_t game_pk,
                                           std::int32_t away_team_id,
                                           std::int32_t home_team_id) {
  if (!is_object(play))
    return std::nullopt;
  JsonVariantConst about = play["about"];
  JsonVariantConst result = play["result"];
  const std::string half = lower(text(about["halfInning"]));
  const std::int32_t batting_team_id = half == "bottom" ? home_team_id : away_team_id;
  const long at_bat_index = integer(about["atBatIndex"], -1);
  if (at_bat_index < 0 || batting_team_id <= 0)
    return std::nullopt;
  const std::string_view event_type = text(result["eventType"]);
  PlayEvidence evidence;
  evidence.event_key = play_event_key(play, game_pk);
  evidence.at_bat_index = static_cast<std::int32_t>(at_bat_index);
  evidence.batting_team_id = batting_team_id;
  evidence.batter_name = std::string(text(play["matchup"]["batter"]["fullName"]));
  evidence.kind = event_type == "home_run"
                      ? (integer(result["rbi"]) == 4 ? PlayKind::GrandSlam : PlayKind::HomeRun)
                      : PlayKind::Other;
  evidence.complete = truthy(about["isComplete"]);
  evidence.review = review_state(play);
  return evidence;
}

const char *kind_name(PlayKind kind) {
  switch (kind) {
  case PlayKind::HomeRun:
    return "HOME_RUN";
  case PlayKind::GrandSlam:
    return "GRAND_SLAM";
  case PlayKind::Other:
  default:
    return "OTHER";
  }
}

const char *review_name(ReviewState review) {
  switch (review) {
  case ReviewState::Pending:
    return "PENDING";
  case ReviewState::Confirmed:
    return "CONFIRMED";
  case ReviewState::Overturned:
    return "OVERTURNED";
  case ReviewState::None:
  default:
    return "NONE";
  }
}

std::string play_fingerprint(const PlayEvidence &play) {
  std::string out = kind_name(play.kind);
  out += play.complete ? "|1|" : "|0|";
  out += review_name(play.review);
  out += '|';
  out += std::to_string(play.batting_team_id);
  out += '|';
  out += play.batter_name;
  return out;
}

TeamScore normalized_team(JsonVariantConst team, JsonVariantConst score) {
  TeamScore out;
  out.id = static_cast<std::int32_t>(integer(team["id"]));
  out.abbreviation = std::string(text(team["abbreviation"], "\xE2\x80\x94"));
  const std::string_view team_name = text(team["teamName"]);
  out.name = std::string(team_name.empty() ? text(team["name"], "Unknown") : team_name);
  out.runs = static_cast<std::int32_t>(integer(score["runs"]));
  return out;
}

JsonVariantConst player_game_stats(JsonVariantConst live_data, const char *side,
                                   long player_id, const char *group) {
  if (side == nullptr || player_id <= 0)
    return JsonVariantConst();
  char key[24];
  std::snprintf(key, sizeof(key), "ID%ld", player_id);
  return live_data["boxscore"]["teams"][side]["players"][key]["stats"][group];
}

std::optional<std::string> batter_game_line(JsonVariantConst stats) {
  const std::optional<std::int32_t> hits = optional_integer(stats["hits"]);
  const std::optional<std::int32_t> at_bats = optional_integer(stats["atBats"]);
  if (!hits || !at_bats)
    return std::nullopt;
  const std::int32_t home_runs = optional_integer(stats["homeRuns"]).value_or(0);
  // "1–3 · 2 HR" with an en dash and a middle dot, as the browser shows it.
  std::string line = std::to_string(*hits) + "\xE2\x80\x93" + std::to_string(*at_bats);
  if (home_runs > 1)
    line += " \xC2\xB7 " + std::to_string(home_runs) + " HR";
  else if (home_runs == 1)
    line += " \xC2\xB7 HR";
  return line;
}

std::string inning_ordinal(long inning) {
  static constexpr const char *kWords[] = {"",      "first", "second",  "third",  "fourth",
                                           "fifth", "sixth", "seventh", "eighth", "ninth"};
  if (inning >= 1 && inning <= 9)
    return kWords[inning];
  const long remainder = inning % 100;
  const char *suffix = "th";
  if (!(remainder >= 11 && remainder <= 13)) {
    if (inning % 10 == 1)
      suffix = "st";
    else if (inning % 10 == 2)
      suffix = "nd";
    else if (inning % 10 == 3)
      suffix = "rd";
  }
  return std::to_string(inning) + suffix;
}

std::string latest_play_event_description(JsonVariantConst play) {
  std::string latest;
  for (JsonVariantConst event : play["playEvents"].as<JsonArrayConst>()) {
    const std::string description = trim(text(event["details"]["description"]));
    if (!description.empty())
      latest = description;
  }
  return latest;
}

std::string live_activity_description(JsonArrayConst all_plays, JsonVariantConst current_play,
                                      Half half, long inning, Phase phase,
                                      JsonVariantConst status) {
  const std::string result_description = trim(text(current_play["result"]["description"]));
  const bool complete = truthy(current_play["about"]["isComplete"]);
  const std::string latest_event = latest_play_event_description(current_play);
  const char *current_half = half == Half::Top ? "top" : half == Half::Bottom ? "bottom" : "";
  bool has_play_in_current_half = false;
  if (current_half[0] != '\0') {
    for (JsonVariantConst play : all_plays) {
      JsonVariantConst about = play["about"];
      if (integer(about["inning"], -1) == inning &&
          lower(text(about["halfInning"])) == current_half) {
        has_play_in_current_half = true;
        break;
      }
    }
  }
  if (phase == Phase::Live && current_half[0] != '\0' && !has_play_in_current_half) {
    return std::string(half == Half::Top ? "Top " : "Bottom ") + inning_ordinal(inning) + " begins";
  }
  if (complete && !result_description.empty())
    return result_description;
  if (!latest_event.empty())
    return latest_event;
  if (!result_description.empty())
    return result_description;
  return std::string(text(status["detailedState"], "Waiting for game data"));
}

void mix(std::uint64_t &hash, std::string_view value) {
  for (unsigned char c : value) {
    hash ^= c;
    hash *= 1099511628211ULL;
  }
  hash ^= 0xFF;
  hash *= 1099511628211ULL;
}

void mix(std::uint64_t &hash, long value) { mix(hash, std::string_view(std::to_string(value))); }

void mix_optional(std::uint64_t &hash, const std::optional<std::string> &value) {
  mix(hash, value ? std::string_view(*value) : std::string_view("<none>"));
}

void mix_optional(std::uint64_t &hash, const std::optional<std::int32_t> &value) {
  mix(hash, value ? std::string_view(std::to_string(*value)) : std::string_view("<none>"));
}

} // namespace

const char *live_feed_fields() { return kLiveFeedFields; }

const char *live_feed_filter_json() { return kLiveFeedFilter; }

std::string_view feed_cursor(JsonVariantConst feed) {
  const std::string_view cursor = text(feed["metaData"]["timeStamp"]);
  return valid_timecode(cursor) ? cursor : std::string_view{};
}

std::uint32_t wait_milliseconds(JsonVariantConst feed) {
  JsonVariantConst wait = feed["metaData"]["wait"];
  double seconds = 10.0;
  if (wait.is<double>() || wait.is<long>())
    seconds = wait.as<double>();
  const long ms = static_cast<long>(seconds * 1000.0);
  return static_cast<std::uint32_t>(clamp_integer(ms, kMinimumPollWaitMs, kMaximumPollWaitMs));
}

std::string_view extract_frame(JsonVariantConst feed, std::int32_t game_number, UpdateMode mode,
                               PlayFingerprints &fingerprints, Extraction &out) {
  if (!is_object(feed))
    return "INVALID_FEED_SHAPE";
  const long game_pk = integer(feed["gamePk"]);
  JsonVariantConst game_data = feed["gameData"];
  JsonVariantConst live_data = feed["liveData"];
  JsonVariantConst teams = game_data["teams"];
  JsonVariantConst linescore = live_data["linescore"];
  JsonVariantConst line_teams = linescore["teams"];
  const TeamScore away = normalized_team(teams["away"], line_teams["away"]);
  const TeamScore home = normalized_team(teams["home"], line_teams["home"]);
  if (game_pk <= 0 || away.id <= 0 || home.id <= 0)
    return "INVALID_FEED_SHAPE";
  const std::string_view cursor = feed_cursor(feed);
  if (cursor.empty())
    return "INVALID_CURSOR";

  JsonVariantConst plays_node = live_data["plays"];
  JsonArrayConst all_plays = plays_node["allPlays"].as<JsonArrayConst>();
  JsonVariantConst current_play = plays_node["currentPlay"];
  bool current_included = !is_object(current_play);
  if (!current_included) {
    const long current_index = integer(current_play["about"]["atBatIndex"], -1);
    for (JsonVariantConst play : all_plays) {
      if (integer(play["about"]["atBatIndex"], -2) == current_index) {
        current_included = true;
        break;
      }
    }
  }

  std::vector<PlayEvidence> changed_plays;
  std::size_t play_count = 0;
  const auto consider = [&](JsonVariantConst play) {
    std::optional<PlayEvidence> normalized = normalize_play(play, game_pk, away.id, home.id);
    if (!normalized)
      return;
    ++play_count;
    const std::string fingerprint = play_fingerprint(*normalized);
    auto found = fingerprints.find(normalized->event_key);
    const bool changed = mode == UpdateMode::Bootstrap || found == fingerprints.end() ||
                         found->second != fingerprint;
    if (found == fingerprints.end())
      fingerprints.emplace(normalized->event_key, fingerprint);
    else
      found->second = fingerprint;
    if (changed)
      changed_plays.push_back(std::move(*normalized));
  };
  for (JsonVariantConst play : all_plays)
    consider(play);
  if (!current_included)
    consider(current_play);

  JsonVariantConst current_about = current_play["about"];
  const long inning = clamp_integer(
      integer(linescore["currentInning"], integer(current_about["inning"], 0)), 0, 99);
  const std::string inning_state = lower(text(linescore["inningState"]));
  const ReviewState current_review = review_state(current_play);
  const std::string advisory = latest_game_advisory(current_play);
  const game_state::StatusClassification classification =
      game_state::classify_status(status_facts(feed, current_review, advisory));
  const Phase feed_phase = classification.phase;
  // A completed, decisive half in the ninth or later is terminal even during
  // the brief interval before MLB changes its separate status field to Final.
  const bool inferred_final =
      feed_phase == Phase::Live && inning >= 9 &&
      ((inning_state == "middle" && home.runs > away.runs) ||
       (inning_state == "end" && home.runs != away.runs));
  const Phase phase = inferred_final ? Phase::Final : feed_phase;
  const Half feed_half =
      inning_state == "middle" || inning_state == "end"
          ? half_from_text(inning_state)
          : half_from_text(text(linescore["inningHalf"], text(current_about["halfInning"], "top")));
  // Middle follows the top half; End follows the bottom half. Phase, rather
  // than the half label, determines whether the game itself is final.
  const Half half = phase == Phase::Final ? Half::End : feed_half;
  const long feed_outs = clamp_integer(integer(linescore["outs"]), 0, 3);
  JsonVariantConst current_count = current_play["count"];
  JsonVariantConst current_matchup = current_play["matchup"];
  JsonVariantConst current_batter = current_matchup["batter"];
  JsonVariantConst current_pitcher = current_matchup["pitcher"];
  JsonVariantConst offense = linescore["offense"];
  JsonVariantConst defense = linescore["defense"];
  JsonVariantConst offense_batter = offense["batter"];
  JsonVariantConst defense_pitcher = defense["pitcher"];
  const long current_batter_id = integer(current_batter["id"], -1);
  const long offense_batter_id = integer(offense_batter["id"], -1);
  const long current_pitcher_id = integer(current_pitcher["id"], -1);
  const long defense_pitcher_id = integer(defense_pitcher["id"], -1);
  const bool play_matches_inning =
      (half == Half::Top || half == Half::Bottom) && integer(current_about["inning"], -1) == inning &&
      half_from_text(text(current_about["halfInning"])) == half;
  const bool situation_is_active =
      (phase == Phase::Live || phase == Phase::Review || phase == Phase::Delayed) &&
      play_matches_inning;
  const bool plate_appearance_complete = truthy(current_about["isComplete"]);
  const bool batter_advanced =
      offense_batter_id > 0 && current_batter_id > 0 && offense_batter_id != current_batter_id;
  JsonVariantConst batter =
      offense_batter_id > 0 && (current_batter_id <= 0 || plate_appearance_complete || batter_advanced)
          ? offense_batter
          : current_batter;
  JsonVariantConst pitcher =
      defense_pitcher_id > 0 && (current_pitcher_id <= 0 || defense_pitcher_id != current_pitcher_id)
          ? defense_pitcher
          : current_pitcher;
  const bool count_is_current = situation_is_active && !plate_appearance_complete && !batter_advanced;
  const long outs = situation_is_active ? feed_outs : 0;
  const char *batting_side = half == Half::Top ? "away" : half == Half::Bottom ? "home" : nullptr;
  const char *pitching_side = half == Half::Top ? "home" : half == Half::Bottom ? "away" : nullptr;
  JsonVariantConst batting_stats =
      player_game_stats(live_data, batting_side, integer(batter["id"], -1), "batting");
  JsonVariantConst pitching_stats =
      player_game_stats(live_data, pitching_side, integer(pitcher["id"], -1), "pitching");
  JsonVariantConst status = game_data["status"];

  CanonicalFrame &frame = out.frame;
  frame = CanonicalFrame{};
  frame.game_pk = game_pk;
  frame.game_number = game_number;
  frame.cursor = std::string(cursor);
  frame.update_mode = mode;
  frame.phase = phase;
  // An inferred final (decisive ninth before MLB flips its status) keeps the
  // final label; every other phase carries the shared classification.
  frame.label = phase == Phase::Final ? "FINAL" : classification.label;
  frame.away = away;
  frame.home = home;
  frame.inning = static_cast<std::int32_t>(inning);
  frame.half = half;
  frame.display_outs = static_cast<std::int32_t>(outs);
  frame.evidence_outs = static_cast<std::int32_t>(feed_outs);
  frame.review = current_review;
  frame.last_event =
      live_activity_description(all_plays, current_play, half, inning, phase, status);
  const std::string_view scheduled_start = text(game_data["datetime"]["dateTime"]);
  if (!scheduled_start.empty())
    frame.scheduled_start = std::string(scheduled_start);
  const std::string_view venue = text(game_data["venue"]["name"]);
  if (!venue.empty())
    frame.venue = std::string(venue);

  if (situation_is_active) {
    AtBatState at_bat;
    at_bat.balls = count_is_current
                       ? static_cast<std::int32_t>(clamp_integer(integer(current_count["balls"]), 0, 3))
                       : 0;
    at_bat.strikes =
        count_is_current
            ? static_cast<std::int32_t>(clamp_integer(integer(current_count["strikes"]), 0, 2))
            : 0;
    at_bat.bases.first = is_object(offense["first"]);
    at_bat.bases.second = is_object(offense["second"]);
    at_bat.bases.third = is_object(offense["third"]);
    const std::string_view batter_name = text(batter["fullName"]);
    if (!batter_name.empty())
      at_bat.batter = std::string(batter_name);
    at_bat.batter_line = batter_game_line(batting_stats);
    const std::string_view pitcher_name = text(pitcher["fullName"]);
    if (!pitcher_name.empty())
      at_bat.pitcher = std::string(pitcher_name);
    at_bat.pitch_count = optional_integer(pitching_stats["numberOfPitches"]);
    frame.at_bat = std::move(at_bat);
  }

  for (JsonVariantConst candidate : linescore["innings"].as<JsonArrayConst>()) {
    if (!is_object(candidate))
      continue;
    InningScore score;
    score.inning = static_cast<std::int32_t>(integer(candidate["num"]));
    const bool home_half_has_not_started =
        score.inning == inning &&
        (half == Half::Top || (half == Half::Middle && inning_state == "middle"));
    if (is_object(candidate["away"]))
      score.away = static_cast<std::int32_t>(integer(candidate["away"]["runs"]));
    if (!home_half_has_not_started && is_object(candidate["home"]))
      score.home = static_cast<std::int32_t>(integer(candidate["home"]["runs"]));
    frame.linescore.innings.push_back(score);
  }
  frame.linescore.away_hits = static_cast<std::int32_t>(integer(line_teams["away"]["hits"]));
  frame.linescore.home_hits = static_cast<std::int32_t>(integer(line_teams["home"]["hits"]));
  frame.linescore.away_errors = static_cast<std::int32_t>(integer(line_teams["away"]["errors"]));
  frame.linescore.home_errors = static_cast<std::int32_t>(integer(line_teams["home"]["errors"]));
  frame.changed_plays = std::move(changed_plays);

  out.wait_ms = wait_milliseconds(feed);
  out.play_count = play_count;
  return {};
}

std::uint64_t state_fingerprint(const CanonicalFrame &frame, const PlayFingerprints &fingerprints) {
  std::uint64_t hash = 1469598103934665603ULL;
  mix(hash, static_cast<long>(frame.game_pk));
  mix(hash, static_cast<long>(frame.game_number));
  mix(hash, static_cast<long>(frame.phase));
  mix(hash, frame.label);
  for (const TeamScore *team : {&frame.away, &frame.home}) {
    mix(hash, static_cast<long>(team->id));
    mix(hash, team->abbreviation);
    mix(hash, team->name);
    mix(hash, static_cast<long>(team->runs));
  }
  mix(hash, static_cast<long>(frame.inning));
  mix(hash, static_cast<long>(frame.half));
  mix(hash, static_cast<long>(frame.display_outs));
  mix(hash, static_cast<long>(frame.review));
  mix(hash, frame.last_event);
  mix_optional(hash, frame.scheduled_start);
  mix_optional(hash, frame.venue);
  if (frame.at_bat) {
    const AtBatState &at_bat = *frame.at_bat;
    mix(hash, static_cast<long>(at_bat.balls));
    mix(hash, static_cast<long>(at_bat.strikes));
    mix(hash, static_cast<long>((at_bat.bases.first ? 1 : 0) | (at_bat.bases.second ? 2 : 0) |
                                (at_bat.bases.third ? 4 : 0)));
    mix_optional(hash, at_bat.batter);
    mix_optional(hash, at_bat.batter_line);
    mix_optional(hash, at_bat.pitcher);
    mix_optional(hash, at_bat.pitch_count);
  } else {
    mix(hash, std::string_view("<no-at-bat>"));
  }
  for (const InningScore &inning : frame.linescore.innings) {
    mix(hash, static_cast<long>(inning.inning));
    mix_optional(hash, inning.away);
    mix_optional(hash, inning.home);
  }
  mix_optional(hash, frame.linescore.away_hits);
  mix_optional(hash, frame.linescore.home_hits);
  mix_optional(hash, frame.linescore.away_errors);
  mix_optional(hash, frame.linescore.home_errors);
  for (const auto &[key, fingerprint] : fingerprints) {
    mix(hash, key);
    mix(hash, fingerprint);
  }
  return hash;
}

FeedTracker::Outcome FeedTracker::accept(JsonVariantConst feed, std::int32_t game_number,
                                         Extraction &out, std::string_view &error) {
  error = {};
  const std::string_view upstream = feed_cursor(feed);
  if (upstream.empty()) {
    error = "INVALID_CURSOR";
    return Outcome::Invalid;
  }
  if (!bootstrapped_) {
    PlayFingerprints fingerprints;
    error = extract_frame(feed, game_number, UpdateMode::Bootstrap, fingerprints, out);
    if (!error.empty())
      return Outcome::Invalid;
    fingerprints_ = std::move(fingerprints);
    upstream_cursor_ = std::string(upstream);
    delivery_cursor_ = upstream_cursor_;
    same_cursor_revision_ = 0;
    state_fingerprint_ = state_fingerprint(out.frame, fingerprints_);
    bootstrapped_ = true;
    return Outcome::Frame;
  }
  if (upstream < upstream_cursor_)
    return Outcome::Regressed;

  PlayFingerprints fingerprints = fingerprints_;
  error = extract_frame(feed, game_number, UpdateMode::Incremental, fingerprints, out);
  if (!error.empty())
    return Outcome::Invalid;
  const std::uint64_t fingerprint = state_fingerprint(out.frame, fingerprints);
  if (upstream == upstream_cursor_ && fingerprint == state_fingerprint_) {
    fingerprints_ = std::move(fingerprints);
    return Outcome::NoChange;
  }
  if (upstream == upstream_cursor_) {
    ++same_cursor_revision_;
    char suffix[16];
    std::snprintf(suffix, sizeof(suffix), "~%06lu",
                  static_cast<unsigned long>(same_cursor_revision_));
    delivery_cursor_ = std::string(upstream) + suffix;
  } else {
    same_cursor_revision_ = 0;
    upstream_cursor_ = std::string(upstream);
    delivery_cursor_ = upstream_cursor_;
  }
  out.frame.cursor = delivery_cursor_;
  fingerprints_ = std::move(fingerprints);
  state_fingerprint_ = fingerprint;
  return Outcome::Frame;
}

void FeedTracker::reset() {
  fingerprints_.clear();
  upstream_cursor_.clear();
  delivery_cursor_.clear();
  same_cursor_revision_ = 0;
  state_fingerprint_ = 0;
  bootstrapped_ = false;
}

} // namespace apple::mlb_feed
