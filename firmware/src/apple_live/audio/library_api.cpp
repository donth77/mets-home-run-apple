#include "apple_live/audio/library_api.hpp"

#include "apple_live/audio/card.hpp"
#include "apple_live/audio/player.hpp"
#include "apple_live/audio/track_library.hpp"
#include "apple_live/audio/wav.hpp"
#include "apple_live/display/celebration.hpp"
#include "apple_live/display/display.hpp"
#include "apple_live/system/psram.hpp"

#include "apple/firmware/next_tracks.hpp"
#include "apple/firmware/screens.hpp"

#include <ArduinoJson.h>
#include <esp_task_wdt.h>

#include <cstdint>
#include <cstring>

namespace apple::live {

using apple::firmware::ScreenState;
using apple::firmware::copy_text;

namespace {

// A win plays its whole track and holds the Apple up for as long as seven
// minutes (kWinMaxDwellMs), so a track may be that long: 7 min at 22,050 Hz
// mono is 18.5 MB. The Manager page keeps at most that much of an upload.
constexpr std::uint32_t kMaxTrackBytes = 18UL * 1024 * 1024;

File audio_upload_file;
char audio_upload_path[32] = "";
std::uint32_t audio_upload_bytes = 0;

// Keeps a name safe to write to the card's root: letters, digits, dash,
// underscore and dot only, always ending in .wav, never hidden.
bool safe_track_name(const String& raw, char* out, std::size_t size) {
  const char* dot = std::strrchr(raw.c_str(), '.');
  if (dot == nullptr || strcasecmp(dot, ".wav") != 0) return false;
  std::size_t written = 0;
  out[written++] = '/';
  for (std::size_t i = 0; raw[i] != '\0' && written + 1 < size; ++i) {
    const char c = raw[i];
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.';
    if (ok) out[written++] = c;
  }
  out[written] = '\0';
  // "/" alone, or a name that would hide the file from the scan.
  return written > 5 && out[1] != '.' && out[1] != '_';
}

// A WAV the Apple can play: RIFF/WAVE, uncompressed, mono, 16-bit, 22,050 Hz.
// The Manager page produces exactly this, so a failure here means something
// else sent the file.
String check_wav_header(const char* path) {
  CardLock lock;
  File file = SD.open(path, FILE_READ);
  if (!file) return "WRITE_FAILED";
  std::uint8_t head[44];
  const std::size_t read = file.read(head, sizeof(head));
  file.close();
  if (read < sizeof(head)) return "NOT_WAV";
  if (std::memcmp(head, "RIFF", 4) != 0 || std::memcmp(head + 8, "WAVE", 4) != 0) return "NOT_WAV";
  // Find the format chunk rather than assuming where it sits; encoders put
  // their own chunks in a WAV and the offsets move.
  std::uint32_t offset = 12;
  while (offset + 8 <= sizeof(head)) {
    const std::uint8_t* header = head + offset;
    const std::uint32_t size = static_cast<std::uint32_t>(header[4]) |
                               (static_cast<std::uint32_t>(header[5]) << 8) |
                               (static_cast<std::uint32_t>(header[6]) << 16) |
                               (static_cast<std::uint32_t>(header[7]) << 24);
    if (std::memcmp(header, "fmt ", 4) == 0) {
      if (offset + 8 + 16 > sizeof(head)) return "NOT_WAV";
      auto u16 = [header](int at) {
        return static_cast<std::uint16_t>(header[8 + at] | (header[9 + at] << 8));
      };
      auto u32 = [header](int at) {
        return static_cast<std::uint32_t>(header[8 + at] | (header[9 + at] << 8) |
                                          (header[10 + at] << 16) | (header[11 + at] << 24));
      };
      if (u16(0) != 1) return "NOT_PCM";
      if (u16(2) != 1) return "NOT_MONO";
      if (u32(4) != 22050) return "WRONG_RATE";
      if (u16(14) != 16) return "NOT_16_BIT";
      return String();
    }
    offset += 8 + size + (size & 1);
  }
  return "NOT_WAV";
}

bool same_player(const PlayerTrack& slot, long id, const char* name) {
  if (id != 0 && slot.id == id) return true;
  return name != nullptr && name[0] != '\0' && strcasecmp(slot.name, name) == 0;
}

// The entry pairing this player with this song, if it exists.
PlayerTrack* find_player_song(long id, const char* name, const char* file) {
  for (std::uint8_t i = 0; i < player_track_count; ++i) {
    if (same_player(player_tracks[i], id, name) && strcasecmp(player_tracks[i].file, file) == 0) {
      return &player_tracks[i];
    }
  }
  return nullptr;
}

void forget_player(PlayerTrack* slot) {
  const std::uint8_t index = static_cast<std::uint8_t>(slot - player_tracks);
  for (std::uint8_t i = index; i + 1 < player_track_count; ++i) {
    player_tracks[i] = player_tracks[i + 1];
  }
  --player_track_count;
}

// Up next edits touch only memory, so they are allowed during a game and
// even mid-celebration, when the owner most wants them; the card is written
// once it is free. The page names an entry by its place in its line, with the
// file as a check, because the same track can sit in a line twice.
String change_next(const apple::firmware::AudioChange& change) {
  using apple::firmware::NextChange;
  const bool win = change.win == 1;
  const char* player = win ? "" : change.text.c_str();
  if (change.action == "clear") {
    next_tracks->clear(win, player);
    return String();
  }
  TrackEntry* entry = find_track(change.file.c_str());
  if (entry == nullptr) return "NO_TRACK";
  NextChange result = NextChange::NoTrack;
  if (change.action == "unqueue") {
    result = next_tracks->remove(win, player, change.index, entry->file);
  } else if (change.action == "move") {
    result = next_tracks->move(win, player, change.index, entry->file, change.position);
  } else {
    // "Play next" from the library asks for the front of the line; a plain
    // add joins the end.
    result = next_tracks->add(win, static_cast<std::int32_t>(change.number), player, entry->file, change.position);
  }
  if (result == NextChange::LineFull) return "LINE_FULL";
  if (result == NextChange::StoreFull) return "QUEUE_FULL";
  if (result == NextChange::NoTrack) return "NO_TRACK";
  return String();
}

}  // namespace

// A track arriving from the Manager. The page has already converted it to the
// one format the Apple plays, so this only has to refuse the obvious.
String begin_audio_upload(const String& filename) {
  if (!audio_card_ready) return "NO_CARD";
  if (celebration_active) return "CELEBRATING";
  if (track_count >= kMaxTracks) return "LIBRARY_FULL";
  if (!safe_track_name(filename, audio_upload_path, sizeof(audio_upload_path))) {
    return "BAD_NAME";
  }
  stop_audio();
  audio_upload_bytes = 0;
  audio_upload_file = SD.open(audio_upload_path, FILE_WRITE);
  if (!audio_upload_file) return "WRITE_FAILED";
  return String();
}

bool write_audio_upload(const std::uint8_t* data, std::size_t length) {
  if (!audio_upload_file) return false;
  CardLock lock;
  if (audio_upload_bytes + length > kMaxTrackBytes) return false;
  esp_task_wdt_reset();
  const std::size_t written = audio_upload_file.write(data, length);
  audio_upload_bytes += written;
  return written == length;
}

String end_audio_upload(bool keep) {
  if (!audio_upload_file) return keep ? String("WRITE_FAILED") : String();
  audio_upload_file.close();
  if (!keep || audio_upload_bytes == 0) {
    SD.remove(audio_upload_path);
    return String();
  }
  const String bad = check_wav_header(audio_upload_path);
  if (bad.length() > 0) {
    SD.remove(audio_upload_path);
    return bad;
  }
  // A new track joins the home run pool, which is what an owner uploading one
  // almost always wants. They can move it afterwards.
  scan_tracks();
  TrackEntry* entry = find_track(audio_upload_path);
  if (entry != nullptr) {
    entry->home_run = true;
    save_audio_manifest();
  }
  return String();
}

// Opens a track for the Manager page to play in the browser. The card shares
// nothing with the display any more, but the web server is synchronous, so a
// 4 MB stream holds the main loop for several seconds. Never during a game or
// a celebration.
String open_audio_file(const String& name, File& out) {
  if (!audio_card_ready) return "NO_CARD";
  CardLock lock;
  if (celebration_active) return "CELEBRATING";
  if (model.state == ScreenState::Game) return "GAME_IN_PROGRESS";
  TrackEntry* entry = find_track(name.c_str());
  if (entry == nullptr) return "NO_TRACK";
  out = SD.open(entry->file, FILE_READ);
  if (!out) return "NO_TRACK";
  return String();
}

String change_audio(const apple::firmware::AudioChange& change) {
  if (!audio_card_ready) return "NO_CARD";
  const String& action = change.action;
  if (action == "queue" || action == "unqueue" || action == "move" || action == "clear") {
    const String failed = change_next(change);
    if (failed.length() != 0) return failed;
    note_audio_change();
    resident_refresh_wanted = true;
    if (celebration_active) manifest_save_wanted = true;
    else save_audio_manifest();
    return String();
  }
  if (celebration_active) return "CELEBRATING";

  if (action == "test") {
    TrackEntry* entry = find_track(change.file.c_str());
    if (entry == nullptr) return "NO_TRACK";
    load_resident(resident_home_run, entry->file);
    start_celebration_audio(false);
    // The next celebration reloads whatever it should have been playing.
    resident_refresh_wanted = true;
    return String();
  }
  if (action == "stream") {
    // The whole track off the card, the way a win plays it: same reader,
    // same buffering, same volume scaling. For finding card trouble.
    TrackEntry* entry = find_track(change.file.c_str());
    if (entry == nullptr) return "NO_TRACK";
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
    stop_audio();
    copy_text(win_stream_file, sizeof(win_stream_file), entry->file);
    win_stream_data_at = at;
    audio_request_stream = true;
    start_celebration_audio(true);
    return String();
  }
  if (action == "stop") {
    stop_audio();
    return String();
  }
  if (action == "delete") {
    TrackEntry* entry = find_track(change.file.c_str());
    if (entry == nullptr) return "NO_TRACK";
    stop_audio();
    if (!SD.remove(entry->file)) return "WRITE_FAILED";
    resident_home_run.name[0] = '\0';
    resident_win.name[0] = '\0';
    scan_tracks();
    save_audio_manifest();
    return String();
  }
  if (action == "rename") {
    TrackEntry* entry = find_track(change.file.c_str());
    if (entry == nullptr) return "NO_TRACK";
    if (change.text.length() == 0) return "BAD_NAME";
    copy_text(entry->title, sizeof(entry->title), change.text.c_str());
    save_audio_manifest();
    return String();
  }
  if (action == "pool") {
    TrackEntry* entry = find_track(change.file.c_str());
    if (entry == nullptr) return "NO_TRACK";
    if (change.home_run >= 0) entry->home_run = change.home_run == 1;
    if (change.win >= 0) entry->win = change.win == 1;
    resident_refresh_wanted = true;
    save_audio_manifest();
    return String();
  }
  if (action == "assign") {
    // Adds this song to the player's pool. Already there is not an error.
    TrackEntry* entry = find_track(change.file.c_str());
    if (entry == nullptr) return "NO_TRACK";
    if (change.text.length() == 0) return "NO_PLAYER";
    if (find_player_song(change.number, change.text.c_str(), entry->file) != nullptr) return String();
    if (player_track_count >= kMaxPlayerTracks) return "PLAYERS_FULL";
    PlayerTrack& slot = player_tracks[player_track_count++];
    slot.id = static_cast<std::int32_t>(change.number);
    copy_text(slot.name, sizeof(slot.name), change.text.c_str());
    copy_text(slot.file, sizeof(slot.file), entry->file);
    resident_refresh_wanted = true;
    save_audio_manifest();
    return String();
  }
  if (action == "unassign") {
    // With a file, removes that one song from the player's pool. Without one,
    // removes the player entirely.
    bool removed = false;
    for (std::uint8_t i = 0; i < player_track_count;) {
      const bool player = same_player(player_tracks[i], change.number, change.text.c_str());
      const bool song = change.file.length() == 0 ||
                        strcasecmp(player_tracks[i].file, change.file.c_str()) == 0;
      if (player && song) {
        forget_player(&player_tracks[i]);
        removed = true;
      } else {
        ++i;
      }
    }
    if (!removed) return "NO_PLAYER";
    // Taking a player off the list takes his queue with him.
    if (change.file.length() == 0) next_tracks->clear(false, change.text.c_str());
    resident_refresh_wanted = true;
    save_audio_manifest();
    return String();
  }
  return "BAD_ACTION";
}

// The track library, the player tracks, and the up-next lines, written one
// entry at a time so a full card never needs a large document in memory.
void write_audio_library(Print& out) {
  JsonDocument item(&json_allocator);
  auto emit = [&](std::uint8_t index) {
    if (index != 0) out.print(',');
    serializeJson(item, out);
    item.clear();
  };
  out.print("{\"rev\":");
  out.print(audio_rev);
  out.print(",\"tracks\":[");
  for (std::uint8_t i = 0; i < track_count; ++i) {
    item["file"] = tracks[i].file;
    item["title"] = tracks[i].title;
    item["bytes"] = tracks[i].bytes;
    item["added"] = tracks[i].added;
    item["hr"] = tracks[i].home_run;
    item["win"] = tracks[i].win;
    emit(i);
  }
  out.print("],\"players\":[");
  for (std::uint8_t i = 0; i < player_track_count; ++i) {
    item["id"] = player_tracks[i].id;
    item["name"] = player_tracks[i].name;
    item["file"] = player_tracks[i].file;
    emit(i);
  }
  out.print("],\"next\":[");
  for (std::uint8_t i = 0; i < next_tracks->size(); ++i) {
    const apple::firmware::NextTrack& entry = next_tracks->at(i);
    item["win"] = entry.win;
    item["id"] = entry.player_id;
    item["name"] = entry.player;
    item["file"] = entry.file;
    emit(i);
  }
  out.print("]}");
}

}  // namespace apple::live
