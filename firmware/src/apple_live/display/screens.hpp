#pragma once

// What the panel shows outside a celebration: the waiting, game, final and
// setup cards, filled into the screen model from the Apple's state.

#include "apple/firmware/screens.hpp"
#include "apple/game_state/projector.hpp"
#include "apple/mlb_feed/schedule.hpp"

#include <cstdint>

namespace apple::live {

void show_waiting(const char* status, std::uint16_t accent = apple::firmware::kMetsOrange,
                  apple::firmware::WaitingIcon icon = apple::firmware::WaitingIcon::None);
void show_upcoming(const apple::mlb_feed::ScheduleGame& next);
// With a replay's requested score in place of the recorded one, when it has one.
void show_snapshot(const apple::game_state::GameSnapshot& snapshot);
void show_setup_screen();
void service_setup_screen();
void show_joining_screen();
void show_paused_screen();
void restore_default_screen();
void update_idle_note(bool force);
void service_backlight();

}  // namespace apple::live
