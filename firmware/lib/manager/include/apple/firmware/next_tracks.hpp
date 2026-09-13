#pragma once

#include <ArduinoJson.h>

#include <cstddef>
#include <cstdint>
#include <functional>

namespace apple::firmware {

// Up next: tracks the owner lined up to play before the random pick takes
// over again. One line for the next Mets win, one for the next home run by
// anyone, and one per player, kept together in one small store. A queued
// track plays once and leaves its line. The store is portable so its rules
// run in the native tests; the Apple keeps it on the card beside the other
// assignments, so a song queued for a walk-off survives its own restarts.
constexpr std::uint8_t kMaxNextTracks = 100;
constexpr std::uint8_t kMaxNextPerLine = 20;

struct NextTrack {
  bool win = false;
  std::int32_t player_id = 0;
  char player[40] = "";  // empty: the next home run by anyone
  char file[32] = "";
};

enum class NextChange : std::uint8_t { Ok, NoTrack, LineFull, StoreFull };

class NextTracks {
 public:
  std::uint8_t size() const noexcept { return count_; }
  const NextTrack& at(std::uint8_t index) const noexcept { return entries_[index]; }
  void clear_all() noexcept { count_ = 0; }

  // The first track queued for this kind of celebration, or nullptr. `player`
  // is the batter's name as the game feed reports it, matched without regard
  // to case; empty or nullptr means the line for anyone. Ignored for wins.
  const char* head(bool win, const char* player) const noexcept;
  // What a home run by this batter plays first: his own line, then anyone's.
  const char* head_for_batter(const char* batter) const noexcept;
  std::uint8_t line_count(bool win, const char* player) const noexcept;

  // `position` counts from the front of the line; below zero means the end.
  // LineFull when that line holds kMaxNextPerLine, StoreFull when the whole
  // store holds kMaxNextTracks.
  NextChange add(bool win, std::int32_t player_id, const char* player, const char* file,
                 long position = -1) noexcept;
  // `index` names the entry's place in its line. Below zero, or a place that
  // does not hold `file`, falls back to the first entry with that file.
  NextChange remove(bool win, const char* player, long index, const char* file) noexcept;
  // `to` is clamped to the line; below zero means the front.
  NextChange move(bool win, const char* player, long index, const char* file, long to) noexcept;
  void clear(bool win, const char* player) noexcept;
  // The track that just started playing has had its turn: drops the first
  // entry with that file from the line. False when nothing was queued for it.
  bool consume(bool win, const char* player, const char* file) noexcept;
  // A home run by this batter: his own line first, then anyone's.
  bool consume_home_run(const char* batter, const char* file) noexcept;
  // A track deleted from the card leaves every line.
  void drop_file(const char* file) noexcept;

  void write(JsonArray out) const;
  // Replaces the store. Entries whose file `exists` rejects are skipped, as
  // are any past the caps; a manifest from before up-next simply has none.
  void read(JsonArrayConst in, const std::function<bool(const char*)>& exists);

 private:
  static bool matches(const NextTrack& entry, bool win, const char* player) noexcept;
  std::uint8_t line(bool win, const char* player, std::uint8_t* slots) const noexcept;
  void forget(std::uint8_t index) noexcept;
  void reorder(const std::uint8_t* slots, std::uint8_t n, std::uint8_t from, long to) noexcept;

  NextTrack entries_[kMaxNextTracks];
  std::uint8_t count_ = 0;
};

}  // namespace apple::firmware
