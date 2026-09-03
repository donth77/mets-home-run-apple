#pragma once

#include <cstdint>
#include <cstring>

namespace apple::firmware {

constexpr std::uint16_t rgb565(std::uint8_t red, std::uint8_t green,
                               std::uint8_t blue) {
  return static_cast<std::uint16_t>(((red & 0xF8U) << 8U) |
                                    ((green & 0xFCU) << 3U) |
                                    (blue >> 3U));
}

struct TeamDisplayColor {
  const char* abbreviation;
  std::uint16_t color;
};

// These are display accents, not an exhaustive brand palette. Bright secondary
// colors replace very dark primaries that disappear against the Mets-blue
// scoreboard header. Numeric scores stay white so color never implies a lead.
inline constexpr TeamDisplayColor kTeamDisplayColors[] = {
    {"ATH", rgb565(0xF3, 0xC4, 0x3A)},
    {"ATL", rgb565(0xF2, 0x3D, 0x5A)},
    {"AZ", rgb565(0xE2, 0x3A, 0x4E)},
    {"BAL", rgb565(0xFF, 0x6A, 0x00)},
    {"BOS", rgb565(0xE8, 0x4A, 0x5F)},
    {"CHC", rgb565(0xE2, 0x3D, 0x4F)},
    {"CIN", rgb565(0xEF, 0x33, 0x40)},
    {"CLE", rgb565(0xF0, 0x44, 0x50)},
    {"COL", rgb565(0xB6, 0xA4, 0xDE)},
    {"CWS", rgb565(0xC4, 0xCE, 0xD4)},
    {"DET", rgb565(0xFA, 0x46, 0x16)},
    {"HOU", rgb565(0xF4, 0x7D, 0x30)},
    {"KC", rgb565(0x7A, 0xB2, 0xDD)},
    {"LAA", rgb565(0xF0, 0x44, 0x54)},
    {"LAD", rgb565(0x63, 0xA8, 0xE6)},
    {"MIA", rgb565(0x00, 0xB9, 0xE4)},
    {"MIL", rgb565(0xFF, 0xC5, 0x2F)},
    {"MIN", rgb565(0xE8, 0x4A, 0x6A)},
    {"NYM", rgb565(0xFF, 0x59, 0x10)},
    {"NYY", rgb565(0xC4, 0xCE, 0xD4)},
    {"PHI", rgb565(0xF4, 0x3D, 0x49)},
    {"PIT", rgb565(0xFD, 0xB8, 0x27)},
    {"SD", rgb565(0xFF, 0xC4, 0x25)},
    {"SEA", rgb565(0x2E, 0xC4, 0xB6)},
    {"SF", rgb565(0xFD, 0x5A, 0x1E)},
    {"STL", rgb565(0xF0, 0x44, 0x58)},
    {"TB", rgb565(0x8F, 0xBC, 0xE6)},
    {"TEX", rgb565(0xEF, 0x33, 0x40)},
    {"TOR", rgb565(0x3D, 0x8D, 0xE3)},
    {"WSH", rgb565(0xE1, 0x3D, 0x52)},
    // Older recordings and fixtures can still contain these abbreviations.
    {"ARI", rgb565(0xE2, 0x3A, 0x4E)},
    {"OAK", rgb565(0xF3, 0xC4, 0x3A)},
};

inline std::uint16_t team_abbreviation_color(const char* abbreviation) {
  if (abbreviation == nullptr) {
    return 0xFFFFU;
  }
  for (const TeamDisplayColor& team : kTeamDisplayColors) {
    if (std::strcmp(abbreviation, team.abbreviation) == 0) {
      return team.color;
    }
  }
  return 0xFFFFU;
}

}  // namespace apple::firmware
