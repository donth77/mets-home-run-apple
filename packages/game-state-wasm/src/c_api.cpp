#include "apple/game_state/projector.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <utility>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define APPLE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define APPLE_EXPORT
#endif

namespace {

using apple::game_state::AtBatState;
using apple::game_state::CanonicalFrame;
using apple::game_state::GameLinescore;
using apple::game_state::GameSnapshot;
using apple::game_state::Half;
using apple::game_state::Phase;
using apple::game_state::PlayEvidence;
using apple::game_state::PlayKind;
using apple::game_state::Projector;
using apple::game_state::ReviewState;
using apple::game_state::UpdateMode;

struct StateHandle {
  Projector projector;
  CanonicalFrame pending;
  std::string snapshot_json;
  std::string decision_json;
  std::string last_error;
  bool pending_ready{false};
};

StateHandle *as_handle(void *raw) { return static_cast<StateHandle *>(raw); }

const StateHandle *as_handle(const void *raw) {
  return static_cast<const StateHandle *>(raw);
}

std::string string_or_empty(const char *value) {
  return value == nullptr ? std::string{} : std::string(value);
}

template <typename Enum>
bool enum_in_range(int value, int maximum, Enum &target) {
  if (value < 0 || value > maximum)
    return false;
  target = static_cast<Enum>(value);
  return true;
}

std::optional<std::string> optional_string(int present, const char *value) {
  if (present == 0)
    return std::nullopt;
  return string_or_empty(value);
}

std::optional<std::int32_t> optional_int(int present, int value) {
  if (present == 0)
    return std::nullopt;
  return value;
}

void append_quoted(std::string &output, const std::string &value) {
  static constexpr char kHex[] = "0123456789abcdef";
  output.push_back('"');
  for (const auto byte : value) {
    const auto character = static_cast<unsigned char>(byte);
    switch (character) {
    case '"':
      output += "\\\"";
      break;
    case '\\':
      output += "\\\\";
      break;
    case '\b':
      output += "\\b";
      break;
    case '\f':
      output += "\\f";
      break;
    case '\n':
      output += "\\n";
      break;
    case '\r':
      output += "\\r";
      break;
    case '\t':
      output += "\\t";
      break;
    default:
      if (character < 0x20) {
        output += "\\u00";
        output.push_back(kHex[(character >> 4U) & 0x0fU]);
        output.push_back(kHex[character & 0x0fU]);
      } else {
        output.push_back(static_cast<char>(character));
      }
      break;
    }
  }
  output.push_back('"');
}

void append_int(std::string &output, std::int64_t value) {
  output += std::to_string(value);
}

const char *update_mode_name(UpdateMode value) {
  return value == UpdateMode::Bootstrap ? "BOOTSTRAP" : "INCREMENTAL";
}

const char *phase_name(Phase value) {
  switch (value) {
  case Phase::Pregame:
    return "PREGAME";
  case Phase::Live:
    return "LIVE";
  case Phase::Review:
    return "REVIEW";
  case Phase::Delayed:
    return "DELAYED";
  case Phase::Final:
    return "FINAL";
  case Phase::Sleep:
    return "SLEEP";
  }
  return "PREGAME";
}

const char *half_name(Half value) {
  switch (value) {
  case Half::Top:
    return "TOP";
  case Half::Bottom:
    return "BOTTOM";
  case Half::Middle:
    return "MIDDLE";
  case Half::End:
    return "END";
  }
  return "TOP";
}

const char *review_name(ReviewState value) {
  switch (value) {
  case ReviewState::None:
    return "NONE";
  case ReviewState::Pending:
    return "PENDING";
  case ReviewState::Confirmed:
    return "CONFIRMED";
  case ReviewState::Overturned:
    return "OVERTURNED";
  }
  return "NONE";
}

const char *play_kind_name(PlayKind value) {
  switch (value) {
  case PlayKind::Other:
    return "OTHER";
  case PlayKind::HomeRun:
    return "HOME_RUN";
  case PlayKind::GrandSlam:
    return "GRAND_SLAM";
  }
  return "OTHER";
}

void append_team(std::string &output,
                 const apple::game_state::TeamScore &team) {
  output += "{\"id\":";
  append_int(output, team.id);
  output += ",\"abbreviation\":";
  append_quoted(output, team.abbreviation);
  output += ",\"name\":";
  append_quoted(output, team.name);
  output += ",\"runs\":";
  append_int(output, team.runs);
  output.push_back('}');
}

void append_at_bat(std::string &output, const AtBatState &at_bat) {
  output += "{\"balls\":";
  append_int(output, at_bat.balls);
  output += ",\"strikes\":";
  append_int(output, at_bat.strikes);
  output += ",\"bases\":{\"first\":";
  output += at_bat.bases.first ? "true" : "false";
  output += ",\"second\":";
  output += at_bat.bases.second ? "true" : "false";
  output += ",\"third\":";
  output += at_bat.bases.third ? "true" : "false";
  output.push_back('}');
  if (at_bat.batter.has_value()) {
    output += ",\"batter\":";
    append_quoted(output, *at_bat.batter);
  }
  if (at_bat.batter_line.has_value()) {
    output += ",\"batterLine\":";
    append_quoted(output, *at_bat.batter_line);
  }
  if (at_bat.pitcher.has_value()) {
    output += ",\"pitcher\":";
    append_quoted(output, *at_bat.pitcher);
  }
  if (at_bat.pitch_count.has_value()) {
    output += ",\"pitchCount\":";
    append_int(output, *at_bat.pitch_count);
  }
  output.push_back('}');
}

void append_optional_total(std::string &output, const char *name,
                           const std::optional<std::int32_t> &value) {
  if (!value.has_value())
    return;
  output += ",\"";
  output += name;
  output += "\":";
  append_int(output, *value);
}

void append_linescore(std::string &output, const GameLinescore &linescore) {
  output += "{\"innings\":[";
  bool first = true;
  for (const auto &inning : linescore.innings) {
    if (!first)
      output.push_back(',');
    first = false;
    output += "{\"inning\":";
    append_int(output, inning.inning);
    output += ",\"away\":";
    if (inning.away.has_value())
      append_int(output, *inning.away);
    else
      output += "null";
    output += ",\"home\":";
    if (inning.home.has_value())
      append_int(output, *inning.home);
    else
      output += "null";
    output.push_back('}');
  }
  output.push_back(']');
  append_optional_total(output, "awayHits", linescore.away_hits);
  append_optional_total(output, "homeHits", linescore.home_hits);
  append_optional_total(output, "awayErrors", linescore.away_errors);
  append_optional_total(output, "homeErrors", linescore.home_errors);
  output.push_back('}');
}

std::string serialize_snapshot(const GameSnapshot &snapshot) {
  std::string output;
  output.reserve(768);
  output += "{\"schemaVersion\":";
  append_int(output, snapshot.schema_version);
  output += ",\"gamePk\":";
  append_int(output, snapshot.game_pk);
  output += ",\"gameNumber\":";
  append_int(output, snapshot.game_number);
  output += ",\"phase\":";
  append_quoted(output, phase_name(snapshot.phase));
  output += ",\"label\":";
  append_quoted(output, snapshot.label);
  output += ",\"away\":";
  append_team(output, snapshot.away);
  output += ",\"home\":";
  append_team(output, snapshot.home);
  output += ",\"inning\":";
  append_int(output, snapshot.inning);
  output += ",\"half\":";
  append_quoted(output, half_name(snapshot.half));
  output += ",\"outs\":";
  append_int(output, snapshot.outs);
  output += ",\"review\":";
  append_quoted(output, review_name(snapshot.review));
  output += ",\"lastEvent\":";
  append_quoted(output, snapshot.last_event);
  if (snapshot.scheduled_start.has_value()) {
    output += ",\"scheduledStart\":";
    append_quoted(output, *snapshot.scheduled_start);
  }
  if (snapshot.venue.has_value()) {
    output += ",\"venue\":";
    append_quoted(output, *snapshot.venue);
  }
  if (snapshot.at_bat.has_value()) {
    output += ",\"atBat\":";
    append_at_bat(output, *snapshot.at_bat);
  }
  output += ",\"linescore\":";
  append_linescore(output, snapshot.linescore);
  output.push_back('}');
  return output;
}

std::string serialize_decision(
    const apple::game_state::DecisionEvidence &decision) {
  std::string output;
  output.reserve(512);
  output += "{\"schemaVersion\":";
  append_int(output, decision.schema_version);
  output += ",\"updateMode\":";
  append_quoted(output, update_mode_name(decision.update_mode));
  output += ",\"gamePk\":";
  append_int(output, decision.game_pk);
  output += ",\"gameNumber\":";
  append_int(output, decision.game_number);
  output += ",\"cursor\":";
  append_quoted(output, decision.cursor);
  output += ",\"phase\":";
  append_quoted(output, phase_name(decision.phase));
  output += ",\"half\":";
  append_quoted(output, half_name(decision.half));
  output += ",\"inning\":";
  append_int(output, decision.inning);
  output += ",\"outs\":";
  append_int(output, decision.outs);
  output += ",\"awayTeamId\":";
  append_int(output, decision.away_team_id);
  output += ",\"homeTeamId\":";
  append_int(output, decision.home_team_id);
  output += ",\"awayRuns\":";
  append_int(output, decision.away_runs);
  output += ",\"homeRuns\":";
  append_int(output, decision.home_runs);
  output += ",\"plays\":[";
  bool first = true;
  for (const auto &play : decision.plays) {
    if (!first)
      output.push_back(',');
    first = false;
    output += "{\"eventKey\":";
    append_quoted(output, play.event_key);
    output += ",\"atBatIndex\":";
    append_int(output, play.at_bat_index);
    output += ",\"battingTeamId\":";
    append_int(output, play.batting_team_id);
    output += ",\"batterName\":";
    append_quoted(output, play.batter_name);
    output += ",\"kind\":";
    append_quoted(output, play_kind_name(play.kind));
    output += ",\"complete\":";
    output += play.complete ? "true" : "false";
    output += ",\"review\":";
    append_quoted(output, review_name(play.review));
    output.push_back('}');
  }
  output += "]}";
  return output;
}

} // namespace

extern "C" {

APPLE_EXPORT void *apple_game_state_create() { return new StateHandle(); }

APPLE_EXPORT void apple_game_state_destroy(void *raw) { delete as_handle(raw); }

APPLE_EXPORT int apple_game_state_begin_frame(
    void *raw, int game_pk, int game_number, const char *cursor,
    int update_mode, int phase, const char *label, int away_team_id,
    const char *away_abbreviation, const char *away_name, int away_runs,
    int home_team_id, const char *home_abbreviation, const char *home_name,
    int home_runs, int inning, int half, int display_outs, int evidence_outs,
    int review, const char *last_event) {
  auto *handle = as_handle(raw);
  if (handle == nullptr)
    return 0;

  CanonicalFrame frame;
  frame.game_pk = game_pk;
  frame.game_number = game_number;
  frame.cursor = string_or_empty(cursor);
  frame.label = string_or_empty(label);
  frame.away = {away_team_id, string_or_empty(away_abbreviation),
                string_or_empty(away_name), away_runs};
  frame.home = {home_team_id, string_or_empty(home_abbreviation),
                string_or_empty(home_name), home_runs};
  frame.inning = inning;
  frame.display_outs = display_outs;
  frame.evidence_outs = evidence_outs;
  frame.last_event = string_or_empty(last_event);
  if (!enum_in_range(update_mode, 1, frame.update_mode) ||
      !enum_in_range(phase, 5, frame.phase) ||
      !enum_in_range(half, 3, frame.half) ||
      !enum_in_range(review, 3, frame.review)) {
    handle->pending_ready = false;
    handle->last_error = "invalid frame enum";
    return 0;
  }
  handle->pending = std::move(frame);
  handle->pending_ready = true;
  handle->last_error.clear();
  return 1;
}

APPLE_EXPORT int apple_game_state_set_context(
    void *raw, int has_scheduled_start, const char *scheduled_start,
    int has_venue, const char *venue) {
  auto *handle = as_handle(raw);
  if (handle == nullptr || !handle->pending_ready)
    return 0;
  handle->pending.scheduled_start =
      optional_string(has_scheduled_start, scheduled_start);
  handle->pending.venue = optional_string(has_venue, venue);
  return 1;
}

APPLE_EXPORT int apple_game_state_set_at_bat(
    void *raw, int balls, int strikes, int first, int second, int third,
    int has_batter, const char *batter, int has_batter_line,
    const char *batter_line, int has_pitcher, const char *pitcher,
    int has_pitch_count, int pitch_count) {
  auto *handle = as_handle(raw);
  if (handle == nullptr || !handle->pending_ready)
    return 0;
  AtBatState at_bat;
  at_bat.balls = balls;
  at_bat.strikes = strikes;
  at_bat.bases = {first != 0, second != 0, third != 0};
  at_bat.batter = optional_string(has_batter, batter);
  at_bat.batter_line = optional_string(has_batter_line, batter_line);
  at_bat.pitcher = optional_string(has_pitcher, pitcher);
  at_bat.pitch_count = optional_int(has_pitch_count, pitch_count);
  handle->pending.at_bat = std::move(at_bat);
  return 1;
}

APPLE_EXPORT int apple_game_state_set_linescore_totals(
    void *raw, int has_away_hits, int away_hits, int has_home_hits,
    int home_hits, int has_away_errors, int away_errors, int has_home_errors,
    int home_errors) {
  auto *handle = as_handle(raw);
  if (handle == nullptr || !handle->pending_ready)
    return 0;
  handle->pending.linescore.away_hits =
      optional_int(has_away_hits, away_hits);
  handle->pending.linescore.home_hits =
      optional_int(has_home_hits, home_hits);
  handle->pending.linescore.away_errors =
      optional_int(has_away_errors, away_errors);
  handle->pending.linescore.home_errors =
      optional_int(has_home_errors, home_errors);
  return 1;
}

APPLE_EXPORT int apple_game_state_add_inning(void *raw, int inning,
                                              int has_away, int away,
                                              int has_home, int home) {
  auto *handle = as_handle(raw);
  if (handle == nullptr || !handle->pending_ready)
    return 0;
  handle->pending.linescore.innings.push_back(
      {inning, optional_int(has_away, away), optional_int(has_home, home)});
  return 1;
}

APPLE_EXPORT int apple_game_state_add_play(
    void *raw, const char *event_key, int at_bat_index, int batting_team_id,
    const char *batter_name, int kind, int complete, int review) {
  auto *handle = as_handle(raw);
  if (handle == nullptr || !handle->pending_ready)
    return 0;
  PlayEvidence play;
  play.event_key = string_or_empty(event_key);
  play.at_bat_index = at_bat_index;
  play.batting_team_id = batting_team_id;
  play.batter_name = string_or_empty(batter_name);
  play.complete = complete != 0;
  if (!enum_in_range(kind, 2, play.kind) ||
      !enum_in_range(review, 3, play.review))
    return 0;
  handle->pending.changed_plays.push_back(std::move(play));
  return 1;
}

APPLE_EXPORT int apple_game_state_commit(void *raw) {
  auto *handle = as_handle(raw);
  if (handle == nullptr || !handle->pending_ready)
    return 0;
  handle->pending_ready = false;
  if (!handle->projector.replace(handle->pending)) {
    handle->last_error = std::string(handle->projector.last_error());
    return 0;
  }
  handle->snapshot_json = serialize_snapshot(handle->projector.snapshot());
  handle->decision_json =
      serialize_decision(handle->projector.decision_evidence());
  handle->last_error.clear();
  return 1;
}

APPLE_EXPORT const char *apple_game_state_last_error(const void *raw) {
  const auto *handle = as_handle(raw);
  return handle == nullptr ? "invalid game-state handle"
                           : handle->last_error.c_str();
}

APPLE_EXPORT const char *apple_game_state_snapshot_json(const void *raw) {
  const auto *handle = as_handle(raw);
  return handle == nullptr ? "" : handle->snapshot_json.c_str();
}

APPLE_EXPORT const char *apple_game_state_decision_json(const void *raw) {
  const auto *handle = as_handle(raw);
  return handle == nullptr ? "" : handle->decision_json.c_str();
}

} // extern "C"
