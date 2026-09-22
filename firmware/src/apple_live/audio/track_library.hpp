#pragma once

// The tracks on the card, the pools the owner put them in, the tracks chosen
// for particular hitters, and the up-next lines. Assignments live in
// /audio.json beside the files, so moving the card carries them along.

#include "apple/firmware/next_tracks.hpp"

#include <cstdint>

namespace apple::live {

constexpr std::uint8_t kMaxTracks = 200;       // about 80 bytes each; the page paginates and searches
constexpr std::uint8_t kMaxPlayerTracks = 32;

// What is on the card, and what the owner has asked each track to be used
// for. Assignments live in /audio.json beside the files; a track the manifest
// does not mention falls back to its name, so the six tracks the Apple ships
// with work before the owner ever opens the Manager.
struct TrackEntry {
  char file[32] = "";   // "/hr1.wav", the name on the card
  char title[40] = "";  // what the owner calls it
  std::uint32_t bytes = 0;
  std::uint32_t added = 0;  // the card's file time, epoch seconds, so the page can sort by newest
  bool home_run = false;
  bool win = false;
};
extern TrackEntry* tracks;  // kMaxTracks entries, allocated at boot
extern std::uint8_t track_count;
// Goes up whenever the library, the player tracks or the up-next lines change.
extern std::uint32_t audio_rev;

// A track chosen for one particular hitter, played instead of the general
// pool when they go deep.
struct PlayerTrack {
  std::int32_t id = 0;
  char name[40] = "";
  char file[32] = "";
};
extern PlayerTrack player_tracks[kMaxPlayerTracks];
extern std::uint8_t player_track_count;

extern apple::firmware::NextTracks* next_tracks;  // allocated at boot
// A line changed while the card was busy; write the manifest once it is free.
extern bool manifest_save_wanted;

// Puts the up-next lines and the catalogue in PSRAM.
void allocate_track_library();
void note_audio_change();
const char* random_track(bool win);
void refresh_resident_tracks();
TrackEntry* find_track(const char* file);
void save_audio_manifest();
void scan_tracks();
void mount_audio_card();

}  // namespace apple::live
