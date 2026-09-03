#pragma once

#include <cstddef>

namespace apple::firmware {

namespace player_name_detail {

constexpr bool is_space(unsigned char value) {
  return value == ' ' || value == '\t' || value == '\n' || value == '\r' ||
         value == '\f' || value == '\v';
}

constexpr bool is_digit(unsigned char value) {
  return value >= '0' && value <= '9';
}

inline std::size_t utf8_code_point_length(const char* begin, const char* end) {
  const auto lead = static_cast<unsigned char>(*begin);
  std::size_t length = 1;
  if (lead >= 0xC2 && lead <= 0xDF) {
    length = 2;
  } else if (lead >= 0xE0 && lead <= 0xEF) {
    length = 3;
  } else if (lead >= 0xF0 && lead <= 0xF4) {
    length = 4;
  }
  return begin + length <= end ? length : 1;
}

}  // namespace player_name_detail

/// Copies a display-sized baseball name: "Francisco Lindor" -> "F. Lindor".
/// The source and destination must not overlap.
inline void copy_compact_player_name(char* destination, std::size_t capacity,
                                     const char* source) {
  if (capacity == 0) return;
  destination[0] = '\0';
  if (source == nullptr) return;

  const char* begin = source;
  while (*begin != '\0' && player_name_detail::is_space(*begin)) ++begin;
  const char* end = begin;
  while (*end != '\0') ++end;
  while (end > begin && player_name_detail::is_space(*(end - 1))) --end;
  if (begin == end) return;

  const char* first_end = begin;
  while (first_end < end && !player_name_detail::is_space(*first_end)) {
    ++first_end;
  }
  const char* surname = first_end;
  while (surname < end && player_name_detail::is_space(*surname)) ++surname;

  std::size_t written = 0;
  const auto append = [&](char value) {
    if (written + 1 < capacity) destination[written++] = value;
  };

  if (surname == end) {
    for (const char* at = begin; at < end; ++at) append(*at);
    destination[written] = '\0';
    return;
  }

  const std::size_t initial_length =
      player_name_detail::utf8_code_point_length(begin, first_end);
  for (std::size_t index = 0; index < initial_length; ++index) {
    append(begin[index]);
  }
  append('.');
  append(' ');

  bool previous_space = false;
  for (const char* at = surname; at < end; ++at) {
    const bool space = player_name_detail::is_space(*at);
    if (space && previous_space) continue;
    append(space ? ' ' : *at);
    previous_space = space;
  }
  destination[written] = '\0';
}

/// Copies only the hits and at-bats in a readable form:
/// "0–1 · HR" or "0-1" -> "0 FOR 1".
inline void copy_compact_batter_line(char* destination, std::size_t capacity,
                                     const char* source) {
  if (capacity == 0) return;
  destination[0] = '\0';
  if (source == nullptr) return;

  const char* hits = source;
  while (*hits != '\0' && !player_name_detail::is_digit(*hits)) ++hits;
  const char* hits_end = hits;
  while (*hits_end != '\0' && player_name_detail::is_digit(*hits_end)) {
    ++hits_end;
  }
  const char* at_bats = hits_end;
  while (*at_bats != '\0' && !player_name_detail::is_digit(*at_bats)) {
    ++at_bats;
  }
  const char* at_bats_end = at_bats;
  while (*at_bats_end != '\0' && player_name_detail::is_digit(*at_bats_end)) {
    ++at_bats_end;
  }

  std::size_t written = 0;
  const auto append = [&](char value) {
    if (written + 1 < capacity) destination[written++] = value;
  };
  if (hits == hits_end || at_bats == at_bats_end) {
    for (const char* at = source; *at != '\0'; ++at) append(*at);
    destination[written] = '\0';
    return;
  }

  for (const char* at = hits; at < hits_end; ++at) append(*at);
  append(' ');
  append('F');
  append('O');
  append('R');
  append(' ');
  for (const char* at = at_bats; at < at_bats_end; ++at) append(*at);
  destination[written] = '\0';
}

}  // namespace apple::firmware
