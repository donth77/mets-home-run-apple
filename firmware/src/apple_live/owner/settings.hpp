#pragma once

#include "apple/core/engine.hpp"

#include <cstdint>

namespace apple::live {

inline constexpr char kEasternTz[] = "EST5EDT,M3.2.0,M11.1.0";
constexpr std::uint16_t kRaisedSecondsMin = 5;
constexpr std::uint16_t kRaisedSecondsMax = 120;
constexpr std::uint8_t kBrightnessMin = 10;   // percent

// Owner settings, stored in flash and changed from the Manager page.
struct Settings {
  std::uint16_t raised_seconds{static_cast<std::uint16_t>(apple::core::kRaisedDwellMs / 1000)};
  bool motor{true};  // the Apple is built to move; the Manager switch can turn it off
  bool follow{true};
  bool sleep_display{false};
  bool require_code{false};  // ask for the setup key before changes from the home network
  char time_zone[40]{"America/New_York"};  // IANA id from the Manager table
  const char* posix_tz{kEasternTz};        // rule handed to the clock library
  bool tz_chosen{false};  // set once an owner or their setup device picked a zone
  std::uint8_t brightness{100};  // display backlight, percent
  // Applied to the stored copy of each track rather than at the output stage,
  // whose own gain control is lossy. See public/AUDIO_PLAN.md.
  std::uint8_t volume{80};       // celebration audio, percent
  // A win is the end of the game, so nothing follows that the Apple has to
  // react to: it can stay up and play the whole track. Off, a win behaves
  // like a home run and uses the raised time.
  bool win_full_track{true};
  bool auto_update{true};   // install a new release on its own, between games
  bool beta{false};         // developer: also take pre-releases
  char github_token[128]{""};  // developer: read-only token while the repository is private
};

extern Settings settings;

bool set_time_zone(const char* iana_id);
// Loads `settings` from flash.
void read_settings();
void save_settings();
// Forgets every stored setting and stores the defaults.
void reset_settings();

}  // namespace apple::live
