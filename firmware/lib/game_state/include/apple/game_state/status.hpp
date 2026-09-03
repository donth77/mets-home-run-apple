#pragma once

// Turns MLB's game status into the phase and label every Apple shows. The
// firmware's feed adapter and the browser adapter (through the WebAssembly
// build) both call this, so a delay is classified the same way everywhere.
//
// MLB reports a mid-game delay two ways. The status block usually says only
// "Delayed" with code IO, while the reason travels in a "Game Advisory" play
// event such as "Status Change - Delayed: Rain" on the current play. Before a
// game, "Delayed Start: Rain" (code PR) carries the reason in the status
// itself. Rain, inclement weather, lightning, and wet grounds all count as a
// rain delay; suspended, postponed, and cancelled games keep their own labels.

#include "apple/game_state/types.hpp"

#include <string>
#include <string_view>

namespace apple::game_state {

/// Raw values read from one live feed. Strings are MLB's own text.
struct StatusFacts {
  std::string_view abstract_state;  ///< gameData.status.abstractGameState
  std::string_view detailed_state;  ///< gameData.status.detailedState
  std::string_view status_code;     ///< gameData.status.statusCode
  std::string_view reason;          ///< gameData.status.reason (often absent)
  /// Description of the newest "Game Advisory" event on the current play,
  /// or empty. Adapters take the last event whose details.eventType is
  /// "game_advisory".
  std::string_view latest_advisory;
  bool review_pending{false};  ///< currentPlay.reviewDetails.inProgress
};

struct StatusClassification {
  Phase phase{Phase::Sleep};
  /// "LIVE", "FINAL", "PLAY UNDER REVIEW", "RAIN DELAY", else MLB's
  /// detailedState (for example "Suspended: Rain"), with a phase-name
  /// fallback when that is empty.
  std::string label;
  bool weather_delay{false};
};

/// The label used for every weather-caused delay.
constexpr char kRainDelayLabel[] = "RAIN DELAY";

Phase phase_for_status(const StatusFacts &facts);

/// True for a delay (not a suspension or postponement) that MLB attributes
/// to rain, inclement weather, lightning, or wet grounds.
bool weather_delay(const StatusFacts &facts);

StatusClassification classify_status(const StatusFacts &facts);

/// True when `text` contains `word` as a whole word, case-insensitively.
bool contains_word(std::string_view text, std::string_view word);

} // namespace apple::game_state
