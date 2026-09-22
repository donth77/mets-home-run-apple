#pragma once

// The most recent real celebration, kept in flash for the Manager's status.

#include <cstdint>

namespace apple::live {

// What the Apple's lift actually did the last time it celebrated for real.
// RUNNING while the sequence is under way; ROSE only once it reached the top
// and came home; STOPPED, FAULT or INTERRUPTED when it did not; SCREEN_ONLY
// when the motor was off.
struct LastCelebration {
  char kind[8] = "";      // "HR" or "WIN"
  char subject[40] = "";  // batter, or the final score
  std::int64_t at{0};     // epoch seconds
  bool moved{false};      // the lift completed: reached the top and came home
  char outcome[14] = "";
  char track[40] = "";    // the title of the track that played, or empty
};

extern LastCelebration last_celebration;
extern bool last_celebration_tracking;  // the running record is this celebration's
extern bool last_celebration_raised;    // and it has reached the top

void save_last_celebration();
void settle_last_celebration(const char* outcome);
// Reads the record back at boot. One still RUNNING was cut short by a restart.
void load_celebration_history();

}  // namespace apple::live
