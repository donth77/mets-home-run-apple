#pragma once

#include "apple/game_state/types.hpp"

#include <string_view>

namespace apple::game_state {

/**
 * Owns the latest validated game frame and derives the presentation and
 * decision views from that single source.
 */
class Projector {
public:
  bool replace(const CanonicalFrame &frame);

  bool has_projection() const noexcept { return has_projection_; }
  std::string_view last_error() const noexcept { return last_error_; }
  const GameSnapshot &snapshot() const noexcept { return snapshot_; }
  const DecisionEvidence &decision_evidence() const noexcept {
    return decision_evidence_;
  }

private:
  GameSnapshot snapshot_;
  DecisionEvidence decision_evidence_;
  std::string_view last_error_;
  bool has_projection_{false};
};

} // namespace apple::game_state
