#include "apple_live/audio/track_library.hpp"

#include "apple_live/audio/card.hpp"
#include "apple_live/audio/player.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/pins.hpp"
#include "apple_live/system/psram.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <SD.h>

#include <cstdint>
#include <cstdio>
#include <cstring>

namespace apple::live {

using apple::firmware::copy_text;

namespace {

constexpr char kAudioManifestPath[] = "/audio.json";

}  // namespace

TrackEntry* tracks = nullptr;  // kMaxTracks entries, allocated at boot
std::uint8_t track_count = 0;
// Goes up whenever the library, the player tracks, or the up-next lines
// change. Status carries the number; the page fetches the lists themselves
// only when it moves, so a full card is not sent every few seconds.
std::uint32_t audio_rev = 1;
PlayerTrack player_tracks[kMaxPlayerTracks];
std::uint8_t player_track_count = 0;
// Up next: what the owner lined up to play before the random pick takes
// over again. The rules live in lib/manager (next_tracks.hpp) so the native
// tests can walk them; the firmware only feeds it what it needs.
apple::firmware::NextTracks* next_tracks = nullptr;  // allocated at boot
// A queue changed while the card was busy with a celebration; write it once
// the card is free again.
bool manifest_save_wanted = false;

namespace {

// One of the songs this hitter has been given, chosen at random, or none.
// Matched on the exact name the game feed reports, which is the same name
// the roster gave the Manager, so a traded or released player simply stops
// matching and the pool takes over.
const char* track_for_player(const char* batter) {
  if (batter == nullptr || batter[0] == '\0') return nullptr;
  const char* picks[kMaxPlayerTracks];
  std::uint8_t count = 0;
  for (std::uint8_t i = 0; i < player_track_count; ++i) {
    if (strcasecmp(player_tracks[i].name, batter) == 0) picks[count++] = player_tracks[i].file;
  }
  if (count == 0) return nullptr;
  return picks[esp_random() % count];
}

// Whether a track is still one the owner wants for this kind of celebration.
bool in_pool(const char* file, bool win) {
  if (file == nullptr || file[0] == '\0') return false;
  for (std::uint8_t i = 0; i < track_count; ++i) {
    if (strcasecmp(tracks[i].file, file) != 0) continue;
    return win ? tracks[i].win : tracks[i].home_run;
  }
  return false;
}

// Applies the saved assignments over the catalogue the card scan produced.
// Anything the manifest does not mention keeps the guess made from its name.
void load_audio_manifest() {
  CardLock lock;
  player_track_count = 0;
  next_tracks->clear_all();
  note_audio_change();
  if (!audio_card_ready) return;
  File file = SD.open(kAudioManifestPath, FILE_READ);
  if (!file) return;
  JsonDocument doc(&json_allocator);
  const DeserializationError failed = deserializeJson(doc, file);
  file.close();
  if (failed) {
    publish_trace("AUDIO", "the track list on the card is unreadable");
    return;
  }
  for (JsonObjectConst node : doc["tracks"].as<JsonArrayConst>()) {
    TrackEntry* entry = find_track(node["file"] | "");
    if (entry == nullptr) continue;  // the file is gone; drop the entry
    const char* title = node["title"] | "";
    if (title[0] != '\0') copy_text(entry->title, sizeof(entry->title), title);
    entry->home_run = node["hr"] | false;
    entry->win = node["win"] | false;
  }
  for (JsonObjectConst node : doc["players"].as<JsonArrayConst>()) {
    if (player_track_count >= kMaxPlayerTracks) break;
    const char* file_name = node["file"] | "";
    const char* name = node["name"] | "";
    if (file_name[0] == '\0' || name[0] == '\0') continue;
    if (find_track(file_name) == nullptr) continue;  // assigned track deleted
    PlayerTrack& slot = player_tracks[player_track_count++];
    slot.id = node["id"] | 0;
    copy_text(slot.name, sizeof(slot.name), name);
    copy_text(slot.file, sizeof(slot.file), file_name);
  }
  next_tracks->read(doc["next"].as<JsonArrayConst>(), [](const char* file) { return find_track(file) != nullptr; });
}

}  // namespace

void allocate_track_library() {
  next_tracks = make_in_psram<apple::firmware::NextTracks>();
  tracks = make_array_in_psram<TrackEntry>(kMaxTracks);
}

void note_audio_change() { ++audio_rev; }

// Picks one of the tracks the owner put in a pool.
const char* random_track(bool win) {
  const char* picks[kMaxTracks];
  std::uint8_t count = 0;
  for (std::uint8_t i = 0; i < track_count; ++i) {
    if (win ? tracks[i].win : tracks[i].home_run) picks[count++] = tracks[i].file;
  }
  if (count == 0) return nullptr;
  return picks[esp_random() % count];
}

// Brings the next celebration's audio into memory. The home run slot follows
// whoever is at the plate: first anything queued for that hitter, then the
// queue for the next home run by anyone, then one of the hitter's own tracks,
// and only then a fresh pick from the pool. Never runs during a celebration,
// because reading the card needs the display's bus.
void refresh_resident_tracks() {
  resident_refresh_wanted = false;
  if (!audio_card_ready) return;
  // A pool pick only replaces another pool pick, so a track already held is
  // not fetched again.
  const char* wanted = next_tracks->head_for_batter(current_batter);
  if (wanted == nullptr) wanted = track_for_player(current_batter);
  if (wanted == nullptr && !in_pool(resident_home_run.name, false)) {
    wanted = random_track(false);
  }
  if (wanted != nullptr && strcmp(wanted, resident_home_run.name) != 0) {
    load_resident(resident_home_run, wanted);
  }
  // A win happens once a game, so the slot is filled when empty and left
  // alone, unless the owner queued something for it.
  const char* win = next_tracks->head(true, "");
  if (win == nullptr && !in_pool(resident_win.name, true)) win = random_track(true);
  if (win != nullptr && strcmp(win, resident_win.name) != 0) load_resident(resident_win, win);
}

TrackEntry* find_track(const char* file) {
  for (std::uint8_t i = 0; i < track_count; ++i) {
    if (strcasecmp(tracks[i].file, file) == 0) return &tracks[i];
  }
  return nullptr;
}

// Assignments live beside the audio on the card, so moving the card to another
// Apple carries the owner's choices with it.
void save_audio_manifest() {
  CardLock lock;
  note_audio_change();
  if (!audio_card_ready) return;
  JsonDocument doc(&json_allocator);
  doc["v"] = 1;
  doc["volume"] = settings.volume;
  JsonArray list = doc["tracks"].to<JsonArray>();
  for (std::uint8_t i = 0; i < track_count; ++i) {
    JsonObject node = list.add<JsonObject>();
    node["file"] = tracks[i].file;
    node["title"] = tracks[i].title;
    node["hr"] = tracks[i].home_run;
    node["win"] = tracks[i].win;
  }
  JsonArray players = doc["players"].to<JsonArray>();
  for (std::uint8_t i = 0; i < player_track_count; ++i) {
    JsonObject node = players.add<JsonObject>();
    node["id"] = player_tracks[i].id;
    node["name"] = player_tracks[i].name;
    node["file"] = player_tracks[i].file;
  }
  next_tracks->write(doc["next"].to<JsonArray>());
  File file = SD.open(kAudioManifestPath, FILE_WRITE);
  if (!file) {
    publish_trace("AUDIO", "could not write the track list");
    return;
  }
  serializeJson(doc, file);
  file.close();
}

// Reads the card's root, then lays the owner's assignments over the result.
void scan_tracks() {
  CardLock lock;
  track_count = 0;
  note_audio_change();
  if (!audio_card_ready || tracks == nullptr) return;
  File dir = SD.open("/");
  if (!dir) return;
  for (File entry = dir.openNextFile(); entry; entry = dir.openNextFile()) {
    const char* name = entry.name();
    const std::size_t len = std::strlen(name);
    const char* base = name[0] == '/' ? name + 1 : name;
    const bool wav = len > 4 && strcasecmp(name + len - 4, ".wav") == 0;
    const bool hidden = base[0] == '.' || base[0] == '_';
    if (wav && !hidden && track_count < kMaxTracks) {
      TrackEntry& slot = tracks[track_count++];
      std::snprintf(slot.file, sizeof(slot.file), "/%s", base);
      // Until the owner renames it, a track is called after its file.
      copy_text(slot.title, sizeof(slot.title), base);
      slot.bytes = entry.size();
      slot.added = static_cast<std::uint32_t>(entry.getLastWrite());
      // The tracks the Apple ships with are named for where they belong.
      slot.home_run = strncasecmp(base, "hr", 2) == 0;
      slot.win = strncasecmp(base, "win", 3) == 0;
    }
    entry.close();
  }
  dir.close();
  load_audio_manifest();
  std::uint8_t hr = 0, win = 0;
  for (std::uint8_t i = 0; i < track_count; ++i) {
    if (tracks[i].home_run) ++hr;
    if (tracks[i].win) ++win;
  }
  char detail[80];
  std::snprintf(detail, sizeof(detail), "%u tracks: %u home run, %u win, %u assigned",
                static_cast<unsigned>(track_count), static_cast<unsigned>(hr),
                static_cast<unsigned>(win), static_cast<unsigned>(player_track_count));
  publish_trace("AUDIO", detail);
  resident_refresh_wanted = true;
}

void mount_audio_card() {
  // A card that is still settling can fail SD.begin() or answer an empty root
  // on the first try, which would leave the Manager showing no tracks until a
  // manual rescan. Retry a few times so a slightly slow card mounts on its own.
  for (std::uint8_t attempt = 0; attempt < 3; ++attempt) {
    audio_card_ready = SD.begin(kSdChipSelectPin, sd_spi, kSdClockHz);
    if (audio_card_ready) {
      scan_tracks();
      if (track_count > 0) return;
    }
    SD.end();
    delay(150);
  }
  audio_card_ready = SD.begin(kSdChipSelectPin, sd_spi, kSdClockHz);
  if (!audio_card_ready) {
    publish_trace("AUDIO", "no card; celebrations are silent");
    return;
  }
  // Card is present but its root has no playable tracks; scan_tracks() has
  // already logged the zero count.
  scan_tracks();
}

}  // namespace apple::live
