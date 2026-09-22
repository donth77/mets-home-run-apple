#include "apple_live/system/text.hpp"

#include <cctype>
#include <cstddef>

namespace apple::live {

void ascii_fold(const char* source, char* destination, std::size_t capacity) {
  std::size_t written = 0;
  const auto put = [&](char c) {
    if (written + 1 < capacity) destination[written++] = c;
  };
  for (const unsigned char* at = reinterpret_cast<const unsigned char*>(source); *at != '\0';) {
    if (*at < 0x80) {
      put(static_cast<char>(*at));
      ++at;
      continue;
    }
    if (at[0] == 0xE2 && at[1] == 0x80 && (at[2] == 0x93 || at[2] == 0x94)) {
      put('-');
      at += 3;
      continue;
    }
    if (at[0] == 0xC2 && at[1] == 0xB7) {
      put('-');
      at += 2;
      continue;
    }
    if (at[0] == 0xC3 && at[1] != '\0') {
      static constexpr char kFold[] = "AAAAAAACEEEEIIIIDNOOOOOxOUUUUYTsaaaaaaaceeeeiiiidnooooo/ouuuuyty";
      const unsigned index = at[1] - 0x80;
      put(index < sizeof(kFold) - 1 ? kFold[index] : '?');
      at += 2;
      continue;
    }
    // Any other multi-byte sequence: skip it whole.
    put('?');
    ++at;
    while ((*at & 0xC0) == 0x80) ++at;
  }
  if (capacity > 0) destination[written] = '\0';
}

void upper(char* text) {
  for (; *text != '\0'; ++text) *text = static_cast<char>(std::toupper(static_cast<unsigned char>(*text)));
}

void collapse_spaces(char* text) {
  char* out = text;
  bool previous_space = false;
  for (const char* in = text; *in != '\0'; ++in) {
    const bool space = *in == ' ';
    if (space && previous_space) continue;
    *out++ = *in;
    previous_space = space;
  }
  *out = '\0';
}

}  // namespace apple::live
