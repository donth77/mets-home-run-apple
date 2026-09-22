#pragma once

// The followed game's live feed: polled over HTTPS, then taken, fetched or
// replayed, through the tracker, the game-state projector and the engine.

#include "apple/game_state/projector.hpp"
#include "apple/mlb_feed/feed.hpp"

#include <ArduinoJson.h>

#include <cstdint>

namespace apple::live {

extern apple::game_state::Projector projector;
extern apple::mlb_feed::FeedTracker tracker;
extern std::uint32_t next_poll_ms;

// Live feed health, for the status.
extern std::uint32_t poll_failure_streak;  // consecutive failed live-feed fetches
extern std::uint32_t polls_ok;
extern std::uint32_t polls_failed;
extern std::uint32_t last_poll_duration_ms;
extern std::uint32_t last_poll_bytes;
extern char last_error[64];

void set_error(const char* code);
const char* phase_name(apple::game_state::Phase phase);
// Feed intake shared by the network path and the replay.
void accept_feed(ArduinoJson::JsonVariantConst feed, std::int32_t game_number, const char* source);
void poll_feed();

}  // namespace apple::live
