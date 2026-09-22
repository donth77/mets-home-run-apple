#pragma once

// Celebration audio.
//
// Tracks live on the card as mono 16-bit 22.05 kHz PCM WAV, already filtered
// and level-set by whoever put them there. The output runs at unity gain
// always: the library applies gain with integer maths and discards resolution
// at every lower setting, which is inaudible on a tone and obvious on music.
// Files named hr*.wav play for home runs, win*.wav for Mets wins.
//
// Playback runs in its own task on the other core from the display; the main
// loop only asks for a track, loads the next ones into memory while the Apple
// is idle, and tidies up afterwards.

#include "apple/game_state/projector.hpp"

#include <cstdint>

namespace apple::live {

constexpr std::uint32_t kWinExtendAllowanceMs = 7'000;   // the lift, before the dwell starts
constexpr std::uint32_t kWinMaxDwellMs = 7UL * 60 * 1000;  // however long the track, stop here

// One track from each list is kept in PSRAM so a celebration can start
// instantly and never touch the SPI bus, which the tear-free display holds in
// a hard-timed loop while it draws. Refreshed while the Apple is idle.
struct ResidentTrack {
  std::uint8_t* data{nullptr};
  std::uint32_t bytes{0};
  char name[32] = "";
};
extern ResidentTrack resident_home_run;
extern ResidentTrack resident_win;
extern bool resident_refresh_wanted;  // reload the resident copies once the Apple is idle

extern char audio_playing[40];    // the track playing now, or empty
extern char current_batter[40];   // whoever is at the plate; empty between batters
extern volatile bool audio_task_should_play;
// A win with the whole-track setting streams this file off the card.
extern volatile bool audio_request_stream;
extern char win_stream_file[32];
extern std::uint32_t win_stream_data_at;

// Creates the I2S output. Nothing plays until start_audio_task().
void begin_audio_output();
void start_audio_task();
// The least stack the audio task has had free since it started, in bytes.
std::uint32_t audio_task_stack_free();
void stop_audio();
void load_resident(ResidentTrack& slot, const char* path);
void start_celebration_audio(bool is_win);
void service_audio();
void note_batter(const apple::game_state::GameSnapshot& snapshot);

}  // namespace apple::live
