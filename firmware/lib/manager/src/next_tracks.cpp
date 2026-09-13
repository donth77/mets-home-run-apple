#include "apple/firmware/next_tracks.hpp"

#include <cctype>
#include <cstring>

namespace apple::firmware {

namespace {

constexpr std::uint8_t kNone = 0xFF;

bool same_text(const char* a, const char* b) noexcept {
  if (a == nullptr) a = "";
  if (b == nullptr) b = "";
  for (;; ++a, ++b) {
    const int ca = std::tolower(static_cast<unsigned char>(*a));
    const int cb = std::tolower(static_cast<unsigned char>(*b));
    if (ca != cb) return false;
    if (ca == '\0') return true;
  }
}

void copy_bounded(char* destination, std::size_t capacity, const char* source) noexcept {
  if (capacity == 0) return;
  if (source == nullptr) source = "";
  std::size_t i = 0;
  for (; i + 1 < capacity && source[i] != '\0'; ++i) destination[i] = source[i];
  destination[i] = '\0';
}

}  // namespace

bool NextTracks::matches(const NextTrack& entry, bool win, const char* player) noexcept {
  if (entry.win != win) return false;
  if (win) return true;
  return same_text(entry.player, player);
}

// The places in the store that belong to one line, in play order.
std::uint8_t NextTracks::line(bool win, const char* player, std::uint8_t* slots) const noexcept {
  std::uint8_t n = 0;
  for (std::uint8_t i = 0; i < count_; ++i) {
    if (matches(entries_[i], win, player)) slots[n++] = i;
  }
  return n;
}

const char* NextTracks::head(bool win, const char* player) const noexcept {
  for (std::uint8_t i = 0; i < count_; ++i) {
    if (matches(entries_[i], win, player)) return entries_[i].file;
  }
  return nullptr;
}

const char* NextTracks::head_for_batter(const char* batter) const noexcept {
  const char* own = batter != nullptr && batter[0] != '\0' ? head(false, batter) : nullptr;
  return own != nullptr ? own : head(false, "");
}

std::uint8_t NextTracks::line_count(bool win, const char* player) const noexcept {
  std::uint8_t slots[kMaxNextTracks];
  return line(win, player, slots);
}

void NextTracks::forget(std::uint8_t index) noexcept {
  if (index >= count_) return;
  for (std::uint8_t i = index; i + 1 < count_; ++i) entries_[i] = entries_[i + 1];
  --count_;
}

// Moves one entry within its line, shifting the others through the line's
// own places in the store. Other lines keep their places, so their order is
// untouched, and only one entry is copied aside.
void NextTracks::reorder(const std::uint8_t* slots, std::uint8_t n, std::uint8_t from, long to) noexcept {
  if (n == 0 || from >= n) return;
  const std::uint8_t target = to < 0 ? 0 : to >= n ? static_cast<std::uint8_t>(n - 1) : static_cast<std::uint8_t>(to);
  if (target == from) return;
  const NextTrack moved = entries_[slots[from]];
  if (target > from) {
    for (std::uint8_t k = from; k < target; ++k) entries_[slots[k]] = entries_[slots[k + 1]];
  } else {
    for (std::uint8_t k = from; k > target; --k) entries_[slots[k]] = entries_[slots[k - 1]];
  }
  entries_[slots[target]] = moved;
}

NextChange NextTracks::add(bool win, std::int32_t player_id, const char* player, const char* file,
                           long position) noexcept {
  if (file == nullptr || file[0] == '\0') return NextChange::NoTrack;
  if (win) player = "";
  std::uint8_t slots[kMaxNextTracks];
  const std::uint8_t n = line(win, player, slots);
  if (n >= kMaxNextPerLine) return NextChange::LineFull;
  if (count_ >= kMaxNextTracks) return NextChange::StoreFull;
  NextTrack& entry = entries_[count_];
  entry.win = win;
  entry.player_id = win ? 0 : player_id;
  copy_bounded(entry.player, sizeof(entry.player), player);
  copy_bounded(entry.file, sizeof(entry.file), file);
  ++count_;
  if (position >= 0 && n > 0) {
    slots[n] = static_cast<std::uint8_t>(count_ - 1);
    reorder(slots, static_cast<std::uint8_t>(n + 1), n, position);
  }
  return NextChange::Ok;
}

NextChange NextTracks::remove(bool win, const char* player, long index, const char* file) noexcept {
  if (win) player = "";
  std::uint8_t slots[kMaxNextTracks];
  const std::uint8_t n = line(win, player, slots);
  std::uint8_t from = kNone;
  if (index >= 0 && index < n && same_text(entries_[slots[index]].file, file)) {
    from = static_cast<std::uint8_t>(index);
  } else {
    for (std::uint8_t k = 0; k < n; ++k) {
      if (same_text(entries_[slots[k]].file, file)) { from = k; break; }
    }
  }
  if (from == kNone) return NextChange::NoTrack;
  forget(slots[from]);
  return NextChange::Ok;
}

NextChange NextTracks::move(bool win, const char* player, long index, const char* file, long to) noexcept {
  if (win) player = "";
  std::uint8_t slots[kMaxNextTracks];
  const std::uint8_t n = line(win, player, slots);
  std::uint8_t from = kNone;
  if (index >= 0 && index < n && same_text(entries_[slots[index]].file, file)) {
    from = static_cast<std::uint8_t>(index);
  } else {
    for (std::uint8_t k = 0; k < n; ++k) {
      if (same_text(entries_[slots[k]].file, file)) { from = k; break; }
    }
  }
  if (from == kNone) return NextChange::NoTrack;
  reorder(slots, n, from, to);
  return NextChange::Ok;
}

void NextTracks::clear(bool win, const char* player) noexcept {
  if (win) player = "";
  for (std::uint8_t i = 0; i < count_;) {
    if (matches(entries_[i], win, player)) forget(i);
    else ++i;
  }
}

bool NextTracks::consume(bool win, const char* player, const char* file) noexcept {
  if (file == nullptr || file[0] == '\0') return false;
  if (win) player = "";
  for (std::uint8_t i = 0; i < count_; ++i) {
    if (matches(entries_[i], win, player) && same_text(entries_[i].file, file)) {
      forget(i);
      return true;
    }
  }
  return false;
}

bool NextTracks::consume_home_run(const char* batter, const char* file) noexcept {
  if (batter != nullptr && batter[0] != '\0' && consume(false, batter, file)) return true;
  return consume(false, "", file);
}

void NextTracks::drop_file(const char* file) noexcept {
  if (file == nullptr || file[0] == '\0') return;
  for (std::uint8_t i = 0; i < count_;) {
    if (same_text(entries_[i].file, file)) forget(i);
    else ++i;
  }
}

void NextTracks::write(JsonArray out) const {
  for (std::uint8_t i = 0; i < count_; ++i) {
    JsonObject node = out.add<JsonObject>();
    node["win"] = entries_[i].win;
    node["id"] = entries_[i].player_id;
    node["name"] = entries_[i].player;
    node["file"] = entries_[i].file;
  }
}

void NextTracks::read(JsonArrayConst in, const std::function<bool(const char*)>& exists) {
  count_ = 0;
  for (JsonObjectConst node : in) {
    const char* file = node["file"] | "";
    const bool win = node["win"] | false;
    const char* name = win ? "" : (node["name"] | "");
    if (file[0] == '\0' || !exists(file)) continue;  // the queued track was deleted
    if (add(win, win ? 0 : (node["id"] | 0), name, file) != NextChange::Ok) continue;
  }
}

}  // namespace apple::firmware
