#pragma once

// Replays for the bench and for demos without Wi-Fi: the recorded Mets at
// Rays game, a recorded Mets win, and Apple Lab's hardware test scenarios.

#include "apple/game_state/projector.hpp"

#include <Arduino.h>

#include <cstddef>

namespace apple::firmware {
struct LabFixture;
}  // namespace apple::firmware

namespace apple::live {

// A score for the win replay's card, so a real game's ending can be played
// back: the recorded game supplies the plays, this supplies the picture.
struct ReplayScore {
  bool active{false};
  char away[5] = "";
  char home[5] = "";
  unsigned away_runs{0};
  unsigned home_runs{0};
  bool mets_home{false};
  char venue[40] = "";
  char away_name[32] = "";
  char home_name[32] = "";
};
extern ReplayScore replay_score;

extern bool replay_active;
extern std::size_t replay_step;
extern const apple::firmware::LabFixture* active_fixture;  // the Lab scenario running, if any
extern const char* fixture_state;
extern String fixture_id;

void start_replay(bool win = false);
// A win replay asked to show a real game's ending: the requested teams and score.
apple::game_state::GameSnapshot with_replay_score(const apple::game_state::GameSnapshot& snapshot);
String start_lab_fixture(const String& id);
String stop_lab_fixture();
void service_replay();

}  // namespace apple::live
