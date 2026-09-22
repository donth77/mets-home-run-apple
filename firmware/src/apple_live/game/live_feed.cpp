#include "apple_live/game/live_feed.hpp"

#include "apple_live/audio/player.hpp"
#include "apple_live/display/celebration.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/https.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/psram.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/core/evidence_bridge.hpp"
#include "apple/firmware/screens.hpp"

#include <Arduino.h>

#include <cstdint>
#include <cstdio>
#include <string_view>

namespace apple::live {

using apple::firmware::copy_text;
using apple::game_state::GameSnapshot;
using apple::game_state::Half;
using apple::game_state::Phase;
using apple::mlb_feed::Extraction;
using apple::mlb_feed::FeedTracker;

namespace {

constexpr std::uint32_t kPollRetryMs = 30 * 1000;
constexpr std::uint32_t kPollRetryMaxMs = 5 * 60 * 1000;
// A failed fetch during live play is usually a truncated download on weak
// Wi-Fi, and the next pitch may be a home run: try again almost at once and
// never wait long. The slow backoff above is for games that are not on.
constexpr std::uint32_t kLivePollRetryMs = 5 * 1000;
constexpr std::uint32_t kLivePollRetryMaxMs = 30 * 1000;
constexpr std::uint32_t kPregamePollMs = 60 * 1000;
constexpr std::uint32_t kFinalPollMs = 60 * 1000;

}  // namespace

apple::game_state::Projector projector;
FeedTracker tracker;
std::uint32_t next_poll_ms = 0;
std::uint32_t poll_failure_streak = 0;  // consecutive failed live-feed fetches
std::uint32_t polls_ok = 0;
std::uint32_t polls_failed = 0;
std::uint32_t last_poll_duration_ms = 0;
std::uint32_t last_poll_bytes = 0;
char last_error[64] = "";

namespace {

std::uint32_t regressed_in_a_row = 0;
constexpr std::uint32_t kRegressionsBeforeResync = 5;

const char* half_name(Half half) {
  switch (half) {
    case Half::Bottom:
      return "BOTTOM";
    case Half::Middle:
      return "MIDDLE";
    case Half::End:
      return "END";
    case Half::Top:
    default:
      return "TOP";
  }
}

}  // namespace

void set_error(const char* code) {
  copy_text(last_error, sizeof(last_error), code);
  publish_trace("ERROR", code);
}

const char* phase_name(Phase phase) {
  switch (phase) {
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
    case Phase::Pregame:
    default:
      return "PREGAME";
  }
}

void accept_feed(ArduinoJson::JsonVariantConst feed, std::int32_t game_number, const char* source) {
  Extraction extraction;
  std::string_view error;
  const FeedTracker::Outcome outcome = tracker.accept(feed, game_number, extraction, error);
  switch (outcome) {
    case FeedTracker::Outcome::Invalid: {
      char detail[64];
      std::snprintf(detail, sizeof(detail), "%.*s", static_cast<int>(error.size()), error.data());
      set_error(detail);
      return;
    }
    case FeedTracker::Outcome::Regressed:
      // A few stale copies from MLB's cache are normal; a run of them means
      // our cursor is ahead of what MLB now serves, so start over. The flash
      // ledger keeps a re-bootstrap from repeating any celebration.
      if (++regressed_in_a_row >= kRegressionsBeforeResync) {
        regressed_in_a_row = 0;
        tracker.reset();
        publish_trace("FEED_RESYNC", source);
      } else {
        publish_trace("FEED_REGRESSED", source);
      }
      return;
    case FeedTracker::Outcome::NoChange:
      regressed_in_a_row = 0;
      return;
    case FeedTracker::Outcome::Frame:
      regressed_in_a_row = 0;
      break;
  }
  if (!projector.replace(extraction.frame)) {
    char detail[64];
    std::snprintf(detail, sizeof(detail), "PROJECTOR %.*s",
                  static_cast<int>(projector.last_error().size()), projector.last_error().data());
    set_error(detail);
    return;
  }
  const GameSnapshot& snapshot = projector.snapshot();
  Serial.printf("APPLE_LIVE:{\"type\":\"frame\",\"source\":\"%s\",\"cursor\":\"%s\",\"phase\":\"%s\","
                "\"label\":\"%s\",\"away\":\"%s\",\"awayRuns\":%ld,\"home\":\"%s\",\"homeRuns\":%ld,"
                "\"inning\":%ld,\"half\":\"%s\",\"changedPlays\":%lu,\"plays\":%lu,\"waitMs\":%lu}\n",
                source, extraction.frame.cursor.c_str(), phase_name(snapshot.phase),
                snapshot.label.c_str(), snapshot.away.abbreviation.c_str(),
                static_cast<long>(snapshot.away.runs), snapshot.home.abbreviation.c_str(),
                static_cast<long>(snapshot.home.runs), static_cast<long>(snapshot.inning),
                half_name(snapshot.half), static_cast<unsigned long>(extraction.frame.changed_plays.size()),
                static_cast<unsigned long>(extraction.play_count),
                static_cast<unsigned long>(extraction.wait_ms));
  note_batter(snapshot);
  const std::uint64_t now = now_ms();
  if (engine) handle_output(engine->ingest(apple::core::to_input_envelope(projector.decision_evidence()), now), now);
  show_snapshot(snapshot);
  if (snapshot.phase == Phase::Final && !final_seen) {
    final_seen = true;
    final_has_game_two = doubleheader_game_two().has_value();
    if (!celebration_active) mark_final_card_visible();
  }
  next_poll_ms = now32() + (snapshot.phase == Phase::Final    ? kFinalPollMs
                            : snapshot.phase == Phase::Pregame ? kPregamePollMs
                                                               : extraction.wait_ms);
}

void poll_feed() {
  if (!game) return;
  if (!apple::mlb_feed::should_poll(*game, wall_epoch(), kPregameLeadSeconds)) {
    next_poll_ms = now32() + kPregamePollMs;
    return;
  }
  String url = String(kMlbOrigin) + "/api/v1.1/game/" + String(static_cast<long long>(game->game_pk)) +
               "/feed/live?fields=" + apple::mlb_feed::live_feed_fields();
  JsonDocument doc(&json_allocator);
  FetchStats stats;
  const std::uint32_t poll_started = now32();
  if (!fetch_json(url, doc, apple::mlb_feed::live_feed_filter_json(), stats)) {
    ++polls_failed;
    ++poll_failure_streak;
    copy_text(last_error, sizeof(last_error), stats.error);
    const bool live = game->live();
    const std::uint32_t cap = live ? kLivePollRetryMaxMs : kPollRetryMaxMs;
    std::uint32_t wait = live ? kLivePollRetryMs : kPollRetryMs;
    for (std::uint32_t i = 1; i < poll_failure_streak && wait < cap; ++i) wait *= 2;
    if (wait > cap) wait = cap;
    char detail[160];
    std::snprintf(detail, sizeof(detail), "live feed: %s after %lu ms (%lu in a row); retry in %lu s", stats.error,
                  static_cast<unsigned long>(now32() - poll_started), static_cast<unsigned long>(poll_failure_streak),
                  static_cast<unsigned long>(wait / 1000));
    publish_trace("FEED", detail);
    next_poll_ms = now32() + wait;
    return;
  }
  ++polls_ok;
  poll_failure_streak = 0;
  last_poll_duration_ms = stats.elapsed_ms;
  last_poll_bytes = stats.bytes;
  last_error[0] = '\0';
  next_poll_ms = now32() + apple::mlb_feed::kMinimumPollWaitMs;
  accept_feed(doc.as<JsonVariantConst>(), game->game_number, "mlb");
}

}  // namespace apple::live
