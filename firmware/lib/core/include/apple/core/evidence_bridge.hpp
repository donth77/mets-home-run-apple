#pragma once

// Converts the game-state layer's decision evidence into the decision core's
// input envelope. Header-only so the core library itself stays independent of
// the game-state library; the application that links both includes this.

#include "apple/core/types.hpp"
#include "apple/game_state/types.hpp"

namespace apple::core {

inline UpdateMode to_core(game_state::UpdateMode mode) noexcept {
  return mode == game_state::UpdateMode::Bootstrap ? UpdateMode::Bootstrap
                                                   : UpdateMode::Incremental;
}

inline Phase to_core(game_state::Phase phase) noexcept {
  switch (phase) {
    case game_state::Phase::Live:
      return Phase::Live;
    case game_state::Phase::Review:
      return Phase::Review;
    case game_state::Phase::Delayed:
      return Phase::Delayed;
    case game_state::Phase::Final:
      return Phase::Final;
    case game_state::Phase::Sleep:
      return Phase::Sleep;
    case game_state::Phase::Pregame:
    default:
      return Phase::Pregame;
  }
}

inline Half to_core(game_state::Half half) noexcept {
  switch (half) {
    case game_state::Half::Bottom:
      return Half::Bottom;
    case game_state::Half::Middle:
      return Half::Middle;
    case game_state::Half::End:
      return Half::End;
    case game_state::Half::Top:
    default:
      return Half::Top;
  }
}

inline ReviewState to_core(game_state::ReviewState review) noexcept {
  switch (review) {
    case game_state::ReviewState::Pending:
      return ReviewState::Pending;
    case game_state::ReviewState::Confirmed:
      return ReviewState::Confirmed;
    case game_state::ReviewState::Overturned:
      return ReviewState::Overturned;
    case game_state::ReviewState::None:
    default:
      return ReviewState::None;
  }
}

inline PlayKind to_core(game_state::PlayKind kind) noexcept {
  switch (kind) {
    case game_state::PlayKind::HomeRun:
      return PlayKind::HomeRun;
    case game_state::PlayKind::GrandSlam:
      return PlayKind::GrandSlam;
    case game_state::PlayKind::Other:
    default:
      return PlayKind::Other;
  }
}

inline PlayEvidence to_core(const game_state::PlayEvidence& play) {
  PlayEvidence out;
  out.event_key = play.event_key;
  out.at_bat_index = play.at_bat_index;
  out.batting_team_id = play.batting_team_id;
  out.batter_name = play.batter_name;
  out.kind = to_core(play.kind);
  out.complete = play.complete;
  out.review = to_core(play.review);
  return out;
}

inline InputEnvelope to_input_envelope(
    const game_state::DecisionEvidence& evidence) {
  InputEnvelope input;
  input.schema_version = evidence.schema_version;
  input.update_mode = to_core(evidence.update_mode);
  input.game_pk = evidence.game_pk;
  input.game_number = evidence.game_number;
  input.cursor = evidence.cursor;
  input.phase = to_core(evidence.phase);
  input.half = to_core(evidence.half);
  input.inning = evidence.inning;
  input.outs = evidence.outs;
  input.away_team_id = evidence.away_team_id;
  input.home_team_id = evidence.home_team_id;
  input.away_runs = evidence.away_runs;
  input.home_runs = evidence.home_runs;
  input.plays.reserve(evidence.plays.size());
  for (const auto& play : evidence.plays) input.plays.push_back(to_core(play));
  return input;
}

}  // namespace apple::core
