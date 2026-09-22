#pragma once

// Which game the Apple follows: the Mets schedule, read often around a game
// and hourly otherwise; the choice of game; the hold on a final before moving
// to the next one; and pausing and resuming from the Manager.

#include "apple/mlb_feed/schedule.hpp"

#include <cstdint>
#include <optional>
#include <vector>

namespace apple::live {

constexpr std::int64_t kPregameLeadSeconds = 60 * 60;

extern std::vector<apple::mlb_feed::ScheduleGame> schedule;
extern std::optional<apple::mlb_feed::ScheduleGame> game;  // the game being followed
extern std::uint32_t next_schedule_ms;

// Schedule lookup health, for the status.
extern std::uint32_t schedule_ok;
extern std::uint32_t schedule_failed;
extern std::uint32_t last_schedule_ms;
extern std::uint32_t last_schedule_ok_ms;
extern std::uint32_t schedule_refresh_ms;
extern char last_schedule_error[64];

extern bool final_seen;
extern bool final_has_game_two;

void reset_final_tracking();
std::optional<apple::mlb_feed::ScheduleGame> doubleheader_game_two();
void mark_final_card_visible();
void pause_following();
void resume_following();
void service_network();

}  // namespace apple::live
