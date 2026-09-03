#pragma once

// Portable MLB live-feed adapter. It turns one MLB Stats API live feed (already
// parsed by ArduinoJson) into the canonical frame that the shared game-state
// projector accepts, mirroring the browser adapter in packages/mlb-live-feed.
// It never talks to the network, a clock, or hardware.

#include "apple/game_state/types.hpp"

#include <ArduinoJson.h>

#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <string_view>

namespace apple::mlb_feed {

constexpr std::int32_t kMetsTeamId = 121;
constexpr std::uint32_t kMinimumPollWaitMs = 10'000;
constexpr std::uint32_t kMaximumPollWaitMs = 60'000;

/// Value for the live feed's `fields=` query. MLB trims the response to these
/// key names at every depth, which cuts a live feed from roughly 750 KB to
/// about 100 KB before it reaches the device.
const char *live_feed_fields();

/// ArduinoJson filter document, as JSON text, that keeps only what
/// `extract_frame` reads. It bounds parser memory even if the server ignores
/// the `fields=` query.
const char *live_feed_filter_json();

/// Suggested nesting limit for the live feed with the filter above.
constexpr std::uint8_t kLiveFeedNestingLimit = 16;

/// event key -> "kind|complete|review|team|batter", carried between updates
/// so an incremental frame lists only the plays that changed.
using PlayFingerprints = std::map<std::string, std::string>;

struct Extraction {
  game_state::CanonicalFrame frame;
  std::uint32_t wait_ms{kMinimumPollWaitMs};
  std::size_t play_count{0};
};

/// The feed's `metaData.timeStamp`, or an empty view when it is missing or
/// malformed. Cursors compare lexicographically because MLB formats them as
/// `YYYYMMDD_HHMMSS`.
std::string_view feed_cursor(ArduinoJson::JsonVariantConst feed);

/// `metaData.wait` in milliseconds, clamped to the polling window.
std::uint32_t wait_milliseconds(ArduinoJson::JsonVariantConst feed);

/// Normalizes one feed into a canonical frame. Returns an empty view on
/// success and an error code otherwise. `fingerprints` is updated in place
/// with the plays seen in this feed.
std::string_view extract_frame(ArduinoJson::JsonVariantConst feed,
                               std::int32_t game_number,
                               game_state::UpdateMode mode,
                               PlayFingerprints &fingerprints, Extraction &out);

/// Stable hash over the presentation facts and the play fingerprints, used to
/// detect feeds whose timestamp advanced without any visible change.
std::uint64_t state_fingerprint(const game_state::CanonicalFrame &frame,
                                const PlayFingerprints &fingerprints);

/**
 * Sequences feeds for one game: the first accepted feed is a bootstrap, later
 * ones are incremental, cursors never move backward, and a feed whose
 * timestamp repeats but whose state changed gets a revision suffix so the
 * decision core still sees a strictly increasing cursor.
 */
class FeedTracker {
public:
  enum class Outcome : std::uint8_t {
    Frame,     ///< `out` holds a new frame to project
    NoChange,  ///< the feed matched the previous state
    Regressed, ///< the feed was older than the last accepted one
    Invalid,   ///< the feed could not be normalized; see `error`
  };

  Outcome accept(ArduinoJson::JsonVariantConst feed, std::int32_t game_number,
                 Extraction &out, std::string_view &error);

  void reset();
  bool bootstrapped() const noexcept { return bootstrapped_; }
  const std::string &cursor() const noexcept { return delivery_cursor_; }
  std::size_t tracked_plays() const noexcept { return fingerprints_.size(); }

private:
  PlayFingerprints fingerprints_;
  std::string upstream_cursor_;
  std::string delivery_cursor_;
  std::uint32_t same_cursor_revision_{0};
  std::uint64_t state_fingerprint_{0};
  bool bootstrapped_{false};
};

} // namespace apple::mlb_feed
