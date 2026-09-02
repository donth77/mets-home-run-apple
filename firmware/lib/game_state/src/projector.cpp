#include "apple/game_state/projector.hpp"

#include <utility>

namespace apple::game_state {
namespace {

bool valid_optional_nonnegative(const std::optional<std::int32_t> &value) {
  return !value.has_value() || *value >= 0;
}

std::string_view validate(const CanonicalFrame &frame) {
  if (frame.game_pk <= 0)
    return "game_pk must be positive";
  if (frame.game_number < 1 || frame.game_number > 2)
    return "game_number must be 1 or 2";
  if (frame.away.id <= 0 || frame.home.id <= 0)
    return "team ids must be positive";
  if (frame.away.runs < 0 || frame.home.runs < 0)
    return "team runs cannot be negative";
  if (frame.inning < 0)
    return "inning cannot be negative";
  if (frame.display_outs < 0 || frame.display_outs > 3 ||
      frame.evidence_outs < 0 || frame.evidence_outs > 3)
    return "outs must be between 0 and 3";

  if (frame.at_bat.has_value()) {
    const auto &at_bat = *frame.at_bat;
    if (at_bat.balls < 0 || at_bat.balls > 3)
      return "balls must be between 0 and 3";
    if (at_bat.strikes < 0 || at_bat.strikes > 2)
      return "strikes must be between 0 and 2";
    if (!valid_optional_nonnegative(at_bat.pitch_count))
      return "pitch_count cannot be negative";
  }

  if (!valid_optional_nonnegative(frame.linescore.away_hits) ||
      !valid_optional_nonnegative(frame.linescore.home_hits) ||
      !valid_optional_nonnegative(frame.linescore.away_errors) ||
      !valid_optional_nonnegative(frame.linescore.home_errors))
    return "line score totals cannot be negative";
  for (const auto &inning : frame.linescore.innings) {
    if (inning.inning <= 0 || !valid_optional_nonnegative(inning.away) ||
        !valid_optional_nonnegative(inning.home))
      return "inning scores must be nonnegative and use a positive inning";
  }
  return {};
}

} // namespace

bool Projector::replace(const CanonicalFrame &frame) {
  const auto error = validate(frame);
  if (!error.empty()) {
    last_error_ = error;
    return false;
  }

  GameSnapshot next_snapshot;
  next_snapshot.game_pk = frame.game_pk;
  next_snapshot.game_number = frame.game_number;
  next_snapshot.phase = frame.phase;
  next_snapshot.label = frame.label;
  next_snapshot.away = frame.away;
  next_snapshot.home = frame.home;
  next_snapshot.inning = frame.inning;
  next_snapshot.half = frame.half;
  next_snapshot.outs = frame.display_outs;
  next_snapshot.review = frame.review;
  next_snapshot.last_event = frame.last_event;
  next_snapshot.scheduled_start = frame.scheduled_start;
  next_snapshot.venue = frame.venue;
  next_snapshot.at_bat = frame.at_bat;
  next_snapshot.linescore = frame.linescore;

  DecisionEvidence next_decision;
  next_decision.update_mode = frame.update_mode;
  next_decision.game_pk = frame.game_pk;
  next_decision.game_number = frame.game_number;
  next_decision.cursor = frame.cursor;
  next_decision.phase = frame.phase;
  next_decision.half = frame.half;
  next_decision.inning = frame.inning;
  next_decision.outs = frame.evidence_outs;
  next_decision.away_team_id = frame.away.id;
  next_decision.home_team_id = frame.home.id;
  next_decision.away_runs = frame.away.runs;
  next_decision.home_runs = frame.home.runs;
  next_decision.plays = frame.changed_plays;

  snapshot_ = std::move(next_snapshot);
  decision_evidence_ = std::move(next_decision);
  last_error_ = {};
  has_projection_ = true;
  return true;
}

} // namespace apple::game_state
