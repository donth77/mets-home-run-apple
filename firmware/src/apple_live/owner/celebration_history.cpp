#include "apple_live/owner/celebration_history.hpp"

#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <Preferences.h>

#include <cstring>

namespace apple::live {

using apple::firmware::copy_text;

namespace {

// The most recent real celebration, kept in flash for the Manager's status.
Preferences history_store;

}  // namespace

LastCelebration last_celebration;
bool last_celebration_tracking = false;  // the running record is this celebration's
bool last_celebration_raised = false;    // and it has reached the top

void save_last_celebration() {
  history_store.putString("kind", last_celebration.kind);
  history_store.putString("subject", last_celebration.subject);
  history_store.putLong64("at", last_celebration.at);
  history_store.putBool("moved", last_celebration.moved);
  history_store.putString("outcome", last_celebration.outcome);
  history_store.putString("track", last_celebration.track);
}

void settle_last_celebration(const char* outcome) {
  if (!last_celebration_tracking) return;
  last_celebration_tracking = false;
  last_celebration.moved = std::strcmp(outcome, "ROSE") == 0;
  copy_text(last_celebration.outcome, sizeof(last_celebration.outcome), outcome);
  save_last_celebration();
}

void load_celebration_history() {
  history_store.begin("history", false);
  history_store.getString("kind", "").toCharArray(last_celebration.kind, sizeof(last_celebration.kind));
  history_store.getString("subject", "").toCharArray(last_celebration.subject, sizeof(last_celebration.subject));
  last_celebration.at = history_store.getLong64("at", 0);
  last_celebration.moved = history_store.getBool("moved", false);
  history_store.getString("outcome", "").toCharArray(last_celebration.outcome, sizeof(last_celebration.outcome));
  history_store.getString("track", "").toCharArray(last_celebration.track, sizeof(last_celebration.track));
  if (last_celebration.at != 0) {
    if (last_celebration.outcome[0] == '\0') {
      // Recorded by firmware that only noted whether the motor was on.
      copy_text(last_celebration.outcome, sizeof(last_celebration.outcome),
                last_celebration.moved ? "ROSE" : "SCREEN_ONLY");
    } else if (std::strcmp(last_celebration.outcome, "RUNNING") == 0) {
      // Power was lost or the Apple restarted before the lift finished.
      last_celebration.moved = false;
      copy_text(last_celebration.outcome, sizeof(last_celebration.outcome), "INTERRUPTED");
      save_last_celebration();
    }
  }
}

}  // namespace apple::live
