#include "apple_live/display/celebration.hpp"

#include "apple_live/audio/card.hpp"
#include "apple_live/audio/player.hpp"
#include "apple_live/audio/track_library.hpp"
#include "apple_live/audio/wav.hpp"
#include "apple_live/display/display.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/live_feed.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/owner/celebration_history.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/text.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/firmware/board_pins.hpp"
#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <SD.h>

#include <cstdint>
#include <cstdio>

namespace apple::live {

using apple::core::SequenceState;
using apple::firmware::copy_text;
using apple::firmware::kDisplayWidth;
using apple::game_state::GameSnapshot;

bool celebration_active = false;

namespace {

bool celebration_is_win = false;
std::uint32_t celebration_started_ms = 0;
std::uint32_t celebration_last_key = 0xFFFFFFFFU;

// A celebration on screen can never outlive the engine's own bounds.
std::uint32_t celebration_display_max_ms() {
  const std::uint64_t dwell = engine ? engine->raised_dwell_ms()
                                     : static_cast<std::uint64_t>(settings.raised_seconds) * 1000;
  return static_cast<std::uint32_t>(apple::core::kCelebrationLeadInMs + 2 * apple::core::kMotionDeadlineMs +
                                    dwell + 5'000);
}

}  // namespace

void end_celebration(const char* reason) {
  if (!celebration_active) return;
  celebration_active = false;
  if (audio_request_stream && engine) {
    engine->set_raised_dwell_ms(static_cast<std::uint64_t>(settings.raised_seconds) * 1000);
  }
  stop_audio();
  resident_refresh_wanted = true;
  scan_lock->leave();
  wake_panel();
  next_panel_refresh_ms = now32() + kPanelRefreshMs;
  mark_final_card_visible();
  request_redraw();
  Serial.printf("APPLE_LIVE:{\"type\":\"celebration\",\"status\":\"ENDED\",\"reason\":\"%s\"}\n", reason);
  char detail[sizeof(TraceEntry::detail)];
  std::snprintf(detail, sizeof(detail), "ended: %s", reason);
  publish_trace("CELEBRATION", detail);
}

void begin_celebration(const apple::core::CoreEvent& event) {
  end_celebration("REPLACED");
  const GameSnapshot& snapshot = projector.snapshot();
  celebration_is_win = event.celebration == apple::core::CelebrationKind::MetsWin;
  if (celebration_is_win && replay_active && replay_score.active) {
    mets_win_loop->begin(replay_score.away, replay_score.away_runs, replay_score.home, replay_score.home_runs,
                         replay_score.mets_home, esp_random());
  } else if (celebration_is_win) {
    char away[5];
    char home[5];
    ascii_fold(snapshot.away.abbreviation.c_str(), away, sizeof(away));
    ascii_fold(snapshot.home.abbreviation.c_str(), home, sizeof(home));
    mets_win_loop->begin(away, static_cast<unsigned>(snapshot.away.runs), home,
                         static_cast<unsigned>(snapshot.home.runs),
                         snapshot.home.id == apple::mlb_feed::kMetsTeamId, esp_random());
  } else {
    char name[apple::display::HomeRunLoop::kMaxNameLength + 1];
    ascii_fold(event.subject.c_str(), name, sizeof(name));
    home_run_loop->begin(event.celebration == apple::core::CelebrationKind::GrandSlam
                             ? apple::display::Headline::GrandSlam
                             : apple::display::Headline::HomeRun,
                         name, esp_random());
  }
  celebration_active = true;
  celebration_started_ms = now32();
  audio_request_stream = false;
  if (celebration_is_win && settings.win_full_track && audio_card_ready && !active_fixture) {
    // The game is over, so stay up for the whole track: stream it off the
    // card and stretch the raised dwell to match, less the lift itself.
    const char* file = next_tracks->head(true, "");
    if (file == nullptr) file = random_track(true);
    TrackEntry* entry = file != nullptr ? find_track(file) : nullptr;
    if (entry != nullptr && entry->bytes > 44) {
      // Where the samples begin has to be exact: the streamed copy is scaled
      // for volume from that byte on, and scaling a chunk header instead
      // hands the decoder garbage sizes to hop through until the file ends.
      std::uint32_t at = 44, length = 0;
      bool found = false;
      {
        CardLock lock;
        File probe = SD.open(entry->file, FILE_READ);
        if (probe) {
          found = find_wav_data_in_file(probe, at, length);
          probe.close();
        }
      }
      if (!found) at = 44;
      const std::uint32_t track_ms = static_cast<std::uint32_t>((static_cast<std::uint64_t>(entry->bytes - at) * 1000ULL) / 44100ULL);
      std::uint32_t dwell = track_ms > kWinExtendAllowanceMs ? track_ms - kWinExtendAllowanceMs : 0;
      const std::uint32_t floor = static_cast<std::uint32_t>(settings.raised_seconds) * 1000;
      if (dwell < floor) dwell = floor;
      if (dwell > kWinMaxDwellMs) dwell = kWinMaxDwellMs;
      copy_text(win_stream_file, sizeof(win_stream_file), entry->file);
      win_stream_data_at = at;
      audio_request_stream = true;
      if (engine) engine->set_raised_dwell_ms(dwell);
      char detail[96];
      std::snprintf(detail, sizeof(detail), "win: whole track %s, %lu s, up for %lu s", entry->file,
                    static_cast<unsigned long>(track_ms / 1000), static_cast<unsigned long>(dwell / 1000));
      publish_trace("AUDIO", detail);
    }
  }
  // The resident home run slot already follows whoever is batting, so a hitter
  // with their own track has it loaded. Fall back to the pool otherwise.
  start_celebration_audio(celebration_is_win);
  // A queued track that just started has had its turn. The card is busy for
  // the whole celebration, so the shorter list is written afterwards.
  const char* played_file = celebration_is_win ? (audio_request_stream ? win_stream_file : resident_win.name)
                                               : resident_home_run.name;
  // Replays and Lab scenarios may play a queued track as a preview, but only
  // a real celebration uses up the owner's choice.
  if (audio_task_should_play && !replay_active) {
    const bool consumed = celebration_is_win
                              ? next_tracks->consume(true, "", played_file)
                              : next_tracks->consume_home_run(current_batter, played_file) ||
                                    next_tracks->consume_home_run(event.subject.c_str(), played_file);
    if (consumed) {
      note_audio_change();
      manifest_save_wanted = true;
      resident_refresh_wanted = true;
    }
  }
  const TrackEntry* played = audio_task_should_play ? find_track(played_file) : nullptr;
  celebration_last_key = 0xFFFFFFFFU;
  wake_panel();
  scan_lock->enter(1);
  {
    char detail[sizeof(TraceEntry::detail)];
    std::snprintf(detail, sizeof(detail), "%s: %s%s", celebration_is_win ? "win" : "home run", event.subject.c_str(),
                  audio_request_stream ? " (streaming the whole track)" : "");
    publish_trace("CELEBRATION", detail);
  }
  if (!replay_active && clock_valid()) {
    // Remember it for the Manager's status; replays are not history.
    copy_text(last_celebration.kind, sizeof(last_celebration.kind), celebration_is_win ? "WIN" : "HR");
    if (celebration_is_win) {
      char score[40];
      std::snprintf(score, sizeof(score), "%s %u, %s %u", snapshot.away.abbreviation.c_str(),
                    static_cast<unsigned>(snapshot.away.runs), snapshot.home.abbreviation.c_str(),
                    static_cast<unsigned>(snapshot.home.runs));
      ascii_fold(score, last_celebration.subject, sizeof(last_celebration.subject));
    } else {
      ascii_fold(event.subject.c_str(), last_celebration.subject, sizeof(last_celebration.subject));
    }
    // A previous celebration still being tracked was cut short by this one.
    settle_last_celebration(last_celebration_raised ? "ROSE" : "STOPPED");
    last_celebration.at = wall_epoch();
    last_celebration.moved = false;
    copy_text(last_celebration.track, sizeof(last_celebration.track), played != nullptr ? played->title : "");
    copy_text(last_celebration.outcome, sizeof(last_celebration.outcome), settings.motor ? "RUNNING" : "SCREEN_ONLY");
    last_celebration_tracking = settings.motor;
    last_celebration_raised = false;
    save_last_celebration();
  }
  Serial.printf("APPLE_LIVE:{\"type\":\"celebration\",\"status\":\"STARTED\",\"kind\":\"%s\","
                "\"subject\":\"%s\",\"eventKey\":\"%s\"}\n",
                celebration_is_win ? "METS_WIN"
                : event.celebration == apple::core::CelebrationKind::GrandSlam ? "GRAND_SLAM"
                                                                               : "HOME_RUN",
                event.subject.c_str(), event.event_key.c_str());
}

void service_celebration() {
  if (!celebration_active) return;
  const std::uint32_t elapsed_ms = now32() - celebration_started_ms;
  const SequenceState state = engine ? engine->sequence_state() : SequenceState::Idle;
  // The picture stays up through the raise and the dwell; it comes down with
  // the Apple, or at once on a fault, and never past the engine's bounds.
  if (state == SequenceState::Idle || state == SequenceState::Retracting ||
      state == SequenceState::Fault || elapsed_ms >= celebration_display_max_ms()) {
    end_celebration(state == SequenceState::Fault ? "FAULT" : "SEQUENCE");
    return;
  }
  const std::uint32_t key = celebration_is_win ? mets_win_loop->render_key(elapsed_ms)
                                               : home_run_loop->render_key(elapsed_ms);
  if (key == celebration_last_key) return;
  celebration_last_key = key;
  const apple::display::DirtyRect dirty =
      celebration_is_win
          ? mets_win_loop->render(elapsed_ms, display.getBuffer(), apple::display::default_mets_win_colors())
          : home_run_loop->render(elapsed_ms, display.getBuffer(), apple::display::default_colors());
  scan_lock->push(display.getBuffer(), kDisplayWidth, dirty);
}

}  // namespace apple::live
