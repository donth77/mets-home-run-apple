#include "apple/core/types.hpp"
#include "apple/display/home_run_loop.hpp"
#include "apple/display/mets_win_loop.hpp"
#include "apple/firmware/board_pins.hpp"
#include "apple/firmware/scan_lock.hpp"
#include "apple/firmware/team_colors.hpp"

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <SPI.h>
#include <esp_system.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace {

using apple::firmware::kDisplayBacklightPin;
using apple::firmware::kDisplayChipSelectPin;
using apple::firmware::kDisplayDataCommandPin;
using apple::firmware::kDisplayResetPin;
using apple::firmware::team_abbreviation_color;

constexpr std::int16_t kDisplayWidth = 320;
constexpr std::int16_t kDisplayHeight = 240;
constexpr std::int16_t kLiveBasesCenterX = 95;
constexpr std::int16_t kLiveCountCenterX = 225;
constexpr std::size_t kSerialLineCapacity = 512;
constexpr std::size_t kExpectedGameFieldCount = 18;
constexpr std::size_t kEventCharactersPerLine = 51;
constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr std::uint32_t kRainFrameDurationMs = 150;
constexpr std::uint8_t kRainFrameCount = 6;
constexpr std::uint8_t kRainOffsets[] = {0, 13, 5, 19, 9, 2, 16};
// A celebration is shown for the core's lead-in plus the raised dwell, then the
// scoreboard returns. Motion stays disarmed in this prototype target.
constexpr std::uint32_t kCelebrationDisplayMs = static_cast<std::uint32_t>(
    apple::core::kCelebrationLeadInMs + apple::core::kRaisedDwellMs);

constexpr std::uint16_t kMetsBlue = 0x016E;
constexpr std::uint16_t kMetsOrange = 0xFAC2;
constexpr std::uint16_t kDarkBlue = 0x0008;
constexpr std::uint16_t kPanelBlue = 0x08D3;
constexpr std::uint16_t kMutedBlue = 0x5B2E;
constexpr std::uint16_t kGold = 0xFEA0;
constexpr std::uint16_t kLiveGreen = 0x35E8;
constexpr std::uint16_t kDelayYellow = 0xF628;
constexpr std::uint16_t kRainBlue = 0x75DD;

enum class ScreenState : std::uint8_t {
  Waiting = 0,
  Game,
  Upcoming,
  Offseason,
  GenericDelay,
  RainDelay,
  Review,
  Suspended,
  Postponed,
  Cancelled,
  Final,
};

struct GameSnapshot {
  char away[5] = "NYM";
  char home[5] = "---";
  std::uint16_t away_score = 0;
  std::uint16_t home_score = 0;
  char inning[10] = "";
  std::uint8_t balls = 0;
  std::uint8_t strikes = 0;
  std::uint8_t outs = 0;
  std::uint8_t occupied_bases = 0;
  char batter[24] = "-";
  char batter_line[12] = "-";
  char pitcher[24] = "-";
  std::uint16_t pitch_count = 0;
  char venue[31] = "";
  char event[104] = "WAITING FOR LIVE DATA";
  bool valid = false;
};

struct UpcomingSnapshot {
  char away[5] = "NYM";
  char home[5] = "---";
  char date[16] = "DATE TBD";
  char time[13] = "TIME TBD";
  char timezone[9] = "LOCAL";
  char venue[31] = "";
};

struct FinalSnapshot {
  char away[5] = "NYM";
  char home[5] = "---";
  std::uint16_t away_score = 0;
  std::uint16_t home_score = 0;
  char result[12] = "FINAL_SCORE";
  char venue[31] = "";
};

Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin,
                      kDisplayResetPin);
GFXcanvas16 display(kDisplayWidth, kDisplayHeight);
// Celebration frames go to the panel tear-free (see scan_lock.hpp); the
// scoreboard keeps the ordinary full-canvas pushes.
apple::firmware::ScanLockedPanel scan_lock(panel);
GameSnapshot game;
UpcomingSnapshot upcoming;
FinalSnapshot final_game;
ScreenState screen_state = ScreenState::Waiting;
char offseason_season[12] = "NEXT SEASON";
char delay_detail[40] = "WAITING FOR UPDATE";
char state_detail[40] = "WAITING FOR UPDATE";

apple::display::HomeRunLoop home_run_loop;
apple::display::MetsWinLoop mets_win_loop;
bool celebration_is_win = false;
bool celebration_active = false;
std::uint32_t celebration_started_ms = 0;
std::uint32_t celebration_last_key = 0xFFFFFFFFU;
std::uint32_t celebration_logged_loop = 0xFFFFFFFFU;
char celebration_name[apple::display::HomeRunLoop::kMaxNameLength + 1] = "";

char serial_line[kSerialLineCapacity] = {};
std::size_t serial_line_length = 0;
char status_message[80] = "CONNECTING TO USB LIVE BRIDGE";
bool needs_redraw = true;
std::uint8_t last_rain_frame = 0xFF;

void copy_text(char* destination, std::size_t capacity, const char* source) {
  if (capacity == 0) {
    return;
  }
  std::strncpy(destination, source, capacity - 1);
  destination[capacity - 1] = '\0';
}

void copy_text_span(char* destination, std::size_t capacity,
                    const char* source, std::size_t length) {
  if (capacity == 0) {
    return;
  }
  const std::size_t copied = std::min(length, capacity - 1);
  std::memcpy(destination, source, copied);
  destination[copied] = '\0';
}

bool wrap_event_text(const char* source,
                     char (&first_line)[kEventCharactersPerLine + 1],
                     char (&second_line)[kEventCharactersPerLine + 1]) {
  first_line[0] = '\0';
  second_line[0] = '\0';
  const std::size_t length = std::strlen(source);
  if (length <= kEventCharactersPerLine) {
    copy_text(first_line, sizeof(first_line), source);
    return false;
  }

  std::size_t split = kEventCharactersPerLine;
  while (split > 0 && source[split] != ' ') {
    --split;
  }
  if (split == 0) {
    split = kEventCharactersPerLine;
  }
  copy_text_span(first_line, sizeof(first_line), source, split);

  const char* remainder = source + split;
  while (*remainder == ' ') {
    ++remainder;
  }
  const std::size_t remainder_length = std::strlen(remainder);
  if (remainder_length <= kEventCharactersPerLine) {
    copy_text(second_line, sizeof(second_line), remainder);
  } else {
    constexpr std::size_t kTextBeforeEllipsis = kEventCharactersPerLine - 3;
    std::size_t second_split = kTextBeforeEllipsis;
    while (second_split > 0 && remainder[second_split] != ' ') {
      --second_split;
    }
    if (second_split < kTextBeforeEllipsis / 2) {
      second_split = kTextBeforeEllipsis;
    }
    copy_text_span(second_line, sizeof(second_line), remainder, second_split);
    std::strcat(second_line, "...");
  }
  return true;
}

std::uint16_t parse_u16(const char* value) {
  return static_cast<std::uint16_t>(
      std::min<unsigned long>(std::strtoul(value, nullptr, 10), 65'535UL));
}

std::uint8_t parse_u8(const char* value, std::uint8_t maximum) {
  return static_cast<std::uint8_t>(
      std::min<unsigned long>(std::strtoul(value, nullptr, 10), maximum));
}

void set_text(std::uint16_t color, std::uint8_t size) {
  display.setTextColor(color);
  display.setTextSize(size);
  display.setTextWrap(false);
}

void draw_centered(const char* text, std::int16_t center_x, std::int16_t y,
                   std::uint8_t size, std::uint16_t color) {
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(color, size);
  display.getTextBounds(text, 0, y, &bounds_x, &bounds_y, &bounds_width,
                        &bounds_height);
  display.setCursor(center_x - static_cast<std::int16_t>(bounds_width / 2), y);
  display.print(text);
}

void draw_right_aligned(const char* text, std::int16_t right_x,
                        std::int16_t y, std::uint8_t size,
                        std::uint16_t color) {
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(color, size);
  display.getTextBounds(text, 0, y, &bounds_x, &bounds_y, &bounds_width,
                        &bounds_height);
  display.setCursor(right_x - static_cast<std::int16_t>(bounds_width), y);
  display.print(text);
}

void draw_fitted_player_name(const char* text, std::int16_t left_x,
                             std::int16_t top_y, std::uint16_t max_width) {
  std::uint8_t size = 2;
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(ST77XX_WHITE, size);
  display.getTextBounds(text, 0, 0, &bounds_x, &bounds_y, &bounds_width,
                        &bounds_height);
  if (bounds_width > max_width) {
    size = 1;
  }
  set_text(ST77XX_WHITE, size);
  const std::int16_t centered_y =
      top_y + static_cast<std::int16_t>((16 - size * 8) / 2);
  display.setCursor(left_x, centered_y);
  display.print(text);
}

void draw_base_diamond(std::int16_t center_x, std::int16_t center_y,
                       std::int16_t radius, bool occupied) {
  const std::uint16_t color = occupied ? kGold : ST77XX_WHITE;
  const std::uint16_t fill = occupied ? color : kDarkBlue;
  display.fillTriangle(center_x, center_y - radius, center_x + radius, center_y,
                       center_x, center_y + radius, fill);
  display.fillTriangle(center_x, center_y - radius, center_x - radius, center_y,
                       center_x, center_y + radius, fill);
  display.drawLine(center_x, center_y - radius, center_x + radius, center_y,
                   color);
  display.drawLine(center_x + radius, center_y, center_x, center_y + radius,
                   color);
  display.drawLine(center_x, center_y + radius, center_x - radius, center_y,
                   color);
  display.drawLine(center_x - radius, center_y, center_x, center_y - radius,
                   color);
}

void draw_out_dots(std::uint8_t outs) {
  for (std::uint8_t index = 0; index < 2; ++index) {
    const std::int16_t x =
        kLiveBasesCenterX - 10 + static_cast<std::int16_t>(index * 20);
    if (index < outs) {
      display.fillCircle(x, 126, 6, kMetsOrange);
    } else {
      display.drawCircle(x, 126, 6, kMutedBlue);
    }
  }
}

void draw_waiting_layout() {
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  display.fillRect(0, 38, kDisplayWidth, 4, kMetsOrange);
  draw_centered("HOME RUN APPLE", 160, 10, 2, ST77XX_WHITE);

  display.drawRoundRect(20, 63, 280, 116, 9, kMutedBlue);
  draw_centered("USB LIVE DISPLAY", 160, 82, 2, kMetsOrange);
  draw_centered(status_message, 160, 119, 1, ST77XX_WHITE);
  draw_centered("MOTION OUTPUTS DISARMED", 160, 146, 1, kMutedBlue);
  display.fillRect(0, 226, kDisplayWidth, 14, kPanelBlue);
  draw_centered("Waiting for the host feed", 160, 229, 1, ST77XX_WHITE);
}

void draw_upcoming_layout() {
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  display.fillRect(0, 38, kDisplayWidth, 4, kMetsOrange);
  draw_centered("NEXT METS GAME", 160, 10, 2, ST77XX_WHITE);

  const std::uint16_t away_color =
      std::strcmp(upcoming.away, "NYM") == 0 ? kMetsOrange : ST77XX_WHITE;
  const std::uint16_t home_color =
      std::strcmp(upcoming.home, "NYM") == 0 ? kMetsOrange : ST77XX_WHITE;
  draw_centered(upcoming.away, 80, 77, 4, away_color);
  draw_centered("AT", 160, 89, 2, kMutedBlue);
  draw_centered(upcoming.home, 240, 77, 4, home_color);

  display.drawRoundRect(26, 130, 268, 68, 8, kMutedBlue);
  draw_centered(upcoming.date, 160, 143, 2, ST77XX_WHITE);
  char local_time[24] = {};
  std::snprintf(local_time, sizeof(local_time), "%s %s", upcoming.time,
                upcoming.timezone);
  draw_centered(local_time, 160, 169, 2, kGold);

  display.fillRect(0, 232, kDisplayWidth, 8, kMetsOrange);
}

void draw_offseason_layout() {
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  display.fillRect(0, 38, kDisplayWidth, 4, kMetsOrange);
  draw_centered("OFFSEASON", 160, 10, 2, ST77XX_WHITE);

  // Sleeping Apple and pedestal, matching the manually maintained Aseprite.
  display.fillCircle(145, 79, 21, ST77XX_RED);
  display.fillCircle(174, 79, 21, ST77XX_RED);
  display.fillTriangle(125, 80, 194, 80, 160, 110, ST77XX_RED);
  display.fillRoundRect(160, 48, 4, 19, 2, kGold);
  display.fillTriangle(159, 60, 140, 58, 150, 70, kLiveGreen);
  display.fillCircle(175, 68, 5, 0xFDCF);
  draw_centered("Z", 211, 62, 1, kMutedBlue);
  draw_centered("Z", 228, 48, 2, kMutedBlue);

  display.fillRect(120, 98, 78, 17, kPanelBlue);
  display.fillRect(72, 115, 174, 14, 0x32C9);
  display.fillRect(72, 129, 174, 4, kMetsOrange);
  display.fillRect(72, 133, 174, 45, kMetsBlue);
  for (std::int16_t x = 82; x < 246; x += 39) {
    display.fillTriangle(x, 133, x + 28, 178, x, 178, kPanelBlue);
  }

  draw_centered("SEE YOU NEXT SEASON", 160, 195, 2, ST77XX_WHITE);
  display.fillRect(0, 220, kDisplayWidth, 20, kPanelBlue);
  draw_centered(offseason_season, 160, 227, 1, kMetsOrange);
}

void draw_delay_layout(bool rain, std::uint8_t rain_frame = 0) {
  const std::uint16_t accent = rain ? kMutedBlue : kDelayYellow;
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  display.fillRect(0, 38, kDisplayWidth, 4, accent);
  draw_centered(rain ? "RAIN DELAY" : "GAME DELAYED", 160, 10, 2,
                ST77XX_WHITE);

  display.fillRoundRect(22, 66, 276, 126, 9, kPanelBlue);
  display.drawRoundRect(22, 66, 276, 126, 9, accent);
  if (rain) {
    display.fillCircle(143, 96, 10, kMutedBlue);
    display.fillCircle(160, 90, 15, kMutedBlue);
    display.fillCircle(179, 97, 11, kMutedBlue);
    display.fillRect(143, 96, 37, 12, kMutedBlue);
    for (std::uint8_t index = 0;
         index < sizeof(kRainOffsets) / sizeof(kRainOffsets[0]); ++index) {
      const std::int16_t x = 136 + static_cast<std::int16_t>(index * 8);
      const std::int16_t y =
          111 + static_cast<std::int16_t>(
                    (kRainOffsets[index] + rain_frame * 4) % 24);
      const std::int16_t length = index % 2 == 0 ? 9 : 7;
      display.drawLine(x, y, x - 3, y + length - 1, kRainBlue);
      display.drawLine(x + 1, y, x - 2, y + length - 1, kRainBlue);
    }
    draw_centered("WAITING FOR UPDATE", 160, 164, 1, ST77XX_WHITE);
  } else {
    display.fillCircle(160, 106, 22, kDelayYellow);
    display.fillCircle(160, 106, 18, kPanelBlue);
    display.fillRect(159, 93, 3, 14, kDelayYellow);
    display.drawLine(160, 106, 172, 112, kDelayYellow);
    display.drawLine(160, 107, 172, 113, kDelayYellow);
    draw_centered("DELAY IN PROGRESS", 160, 134, 2, kDelayYellow);
    draw_centered(delay_detail, 160, 164, 1, ST77XX_WHITE);
  }
  display.fillRect(0, 220, kDisplayWidth, 20, kPanelBlue);
  draw_centered("WAITING FOR MLB UPDATE", 160, 227, 1, accent);
}

void draw_state_layout(ScreenState state) {
  const bool is_review = state == ScreenState::Review;
  const bool is_suspended = state == ScreenState::Suspended;
  const bool is_postponed = state == ScreenState::Postponed;
  const bool is_cancelled = state == ScreenState::Cancelled;
  const std::uint16_t accent =
      (is_postponed || is_cancelled) ? ST77XX_RED : kDelayYellow;
  const char* title = is_review      ? "PLAY UNDER REVIEW"
                      : is_suspended ? "GAME SUSPENDED"
                      : is_postponed ? "GAME POSTPONED"
                                     : "GAME CANCELLED";
  const char* line_one = is_review      ? "CALL PENDING"
                         : is_suspended ? "PLAY STOPPED"
                         : is_postponed ? "POSTPONED"
                                        : "NO GAME";
  const char* line_two = is_review      ? "WAITING FOR REVIEW"
                         : is_postponed ? "NEXT GAME TBD"
                         : is_cancelled ? "SCHEDULE UPDATE PENDING"
                                        : state_detail;

  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  display.fillRect(0, 38, kDisplayWidth, 4, accent);
  draw_centered(title, 160, 10, 2, ST77XX_WHITE);
  display.fillRoundRect(22, 66, 276, 126, 9, kPanelBlue);
  display.drawRoundRect(22, 66, 276, 126, 9, accent);

  if (is_review) {
    display.drawCircle(160, 104, 23, accent);
    draw_centered("?", 160, 86, 4, accent);
  } else if (is_suspended) {
    display.drawCircle(160, 104, 22, accent);
    display.fillRect(151, 91, 5, 27, accent);
    display.fillRect(165, 91, 5, 27, accent);
  } else {
    display.drawRoundRect(139, 82, 42, 42, 5, accent);
    display.drawLine(148, 91, 172, 115, accent);
    display.drawLine(172, 91, 148, 115, accent);
  }
  draw_centered(line_one, 160, 134, 2, accent);
  draw_centered(line_two, 160, 164, 1, ST77XX_WHITE);
  display.fillRect(0, 220, kDisplayWidth, 20, kPanelBlue);
  draw_centered(is_review ? "OFFICIAL REVIEW IN PROGRESS"
                          : "WAITING FOR MLB UPDATE",
                160, 227, 1, accent);
}

void draw_final_layout() {
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  display.fillRect(0, 38, kDisplayWidth, 4, kMetsOrange);
  draw_centered("FINAL", 160, 9, 3, ST77XX_WHITE);

  char away_line[14] = {};
  char home_line[14] = {};
  std::snprintf(away_line, sizeof(away_line), "%s %u", final_game.away,
                final_game.away_score);
  std::snprintf(home_line, sizeof(home_line), "%s %u", final_game.home,
                final_game.home_score);
  const std::uint16_t away_color =
      std::strcmp(final_game.away, "NYM") == 0 ? kMetsOrange : ST77XX_WHITE;
  const std::uint16_t home_color =
      std::strcmp(final_game.home, "NYM") == 0 ? kMetsOrange : ST77XX_WHITE;
  draw_centered(away_line, 160, 62, 4, away_color);
  draw_centered(home_line, 160, 105, 4, home_color);
  const bool mets_win = std::strcmp(final_game.result, "METS_WIN") == 0;
  draw_centered(mets_win ? "METS WIN" : "FINAL SCORE", 160, 158, 2,
                mets_win ? kMetsOrange : ST77XX_WHITE);
  display.fillRect(0, 220, kDisplayWidth, 20, kPanelBlue);
  draw_centered(final_game.venue, 160, 227, 1, kMutedBlue);
}

void draw_game_layout() {
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, kDisplayWidth, 58, kMetsBlue);
  display.fillRect(0, 54, kDisplayWidth, 4, kMetsOrange);

  char score[8] = {};
  set_text(team_abbreviation_color(game.away), 3);
  display.setCursor(8, 14);
  display.print(game.away);
  set_text(ST77XX_WHITE, 3);
  std::snprintf(score, sizeof(score), " %u", game.away_score);
  display.print(score);

  char home_score_block[13] = {};
  std::snprintf(home_score_block, sizeof(home_score_block), "%s %u",
                game.home, game.home_score);
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(ST77XX_WHITE, 3);
  display.getTextBounds(home_score_block, 0, 14, &bounds_x, &bounds_y,
                        &bounds_width, &bounds_height);
  display.setCursor(312 - static_cast<std::int16_t>(bounds_width), 14);
  set_text(team_abbreviation_color(game.home), 3);
  display.print(game.home);
  set_text(ST77XX_WHITE, 3);
  std::snprintf(score, sizeof(score), " %u", game.home_score);
  display.print(score);

  draw_centered(game.inning, 160, 7, 2, ST77XX_WHITE);
  draw_centered("LIVE", 160, 34, 1, kLiveGreen);

  char count[8] = {};
  std::snprintf(count, sizeof(count), "%u-%u", game.balls, game.strikes);
  draw_centered("COUNT", kLiveCountCenterX, 72, 1, kMutedBlue);
  draw_centered(count, kLiveCountCenterX, 88, 4, kGold);

  draw_base_diamond(kLiveBasesCenterX, 75, 13,
                    (game.occupied_bases & 0x02U) != 0);
  draw_base_diamond(kLiveBasesCenterX + 21, 96, 13,
                    (game.occupied_bases & 0x01U) != 0);
  draw_base_diamond(kLiveBasesCenterX - 21, 96, 13,
                    (game.occupied_bases & 0x04U) != 0);
  draw_out_dots(game.outs);
  draw_centered("OUTS", kLiveBasesCenterX, 139, 1, kMutedBlue);

  display.drawFastHLine(0, 151, kDisplayWidth, kMutedBlue);
  set_text(kMetsOrange, 1);
  display.setCursor(12, 159);
  display.print("BATTING");
  if (std::strcmp(game.batter_line, "-") != 0) {
    draw_right_aligned(game.batter_line, 148, 159, 1, kGold);
  }
  display.setCursor(172, 159);
  display.print("PITCHING");
  if (game.pitch_count > 0) {
    char pitches[12] = {};
    std::snprintf(pitches, sizeof(pitches), "P:%u", game.pitch_count);
    draw_right_aligned(pitches, 313, 159, 1, kGold);
  }

  draw_fitted_player_name(game.batter, 12, 173, 144);
  draw_fitted_player_name(game.pitcher, 172, 173, 140);

  char first_event_line[kEventCharactersPerLine + 1] = {};
  char second_event_line[kEventCharactersPerLine + 1] = {};
  const bool event_wraps =
      wrap_event_text(game.event, first_event_line, second_event_line);
  display.fillRect(0, 199, kDisplayWidth, event_wraps ? 41 : 21, kPanelBlue);
  set_text(ST77XX_WHITE, 1);
  display.setCursor(7, event_wraps ? 203 : 206);
  display.print(first_event_line);
  if (event_wraps) {
    display.setCursor(7, 224);
    display.print(second_event_line);
  } else {
    display.fillRect(0, 220, kDisplayWidth, 20, kMetsBlue);
    display.setCursor(7, 227);
    display.print(game.venue);
  }
}

std::size_t split_fields(char* line, char** fields, std::size_t capacity) {
  if (capacity == 0) {
    return 0;
  }

  std::size_t count = 1;
  fields[0] = line;
  for (char* cursor = line; *cursor != '\0' && count < capacity; ++cursor) {
    if (*cursor == '|') {
      *cursor = '\0';
      fields[count++] = cursor + 1;
    }
  }
  return count;
}

void accept_game_message(char** fields, std::size_t field_count) {
  if (field_count != kExpectedGameFieldCount) {
    Serial.printf("LIVE_DISPLAY_ERROR=FIELD_COUNT_%u\n",
                  static_cast<unsigned>(field_count));
    return;
  }

  copy_text(game.away, sizeof(game.away), fields[1]);
  game.away_score = parse_u16(fields[2]);
  copy_text(game.home, sizeof(game.home), fields[3]);
  game.home_score = parse_u16(fields[4]);
  copy_text(game.inning, sizeof(game.inning), fields[5]);
  game.balls = parse_u8(fields[6], 4);
  game.strikes = parse_u8(fields[7], 3);
  game.outs = parse_u8(fields[8], 3);
  game.occupied_bases = parse_u8(fields[9], 7);
  copy_text(game.batter, sizeof(game.batter), fields[10]);
  copy_text(game.batter_line, sizeof(game.batter_line), fields[11]);
  copy_text(game.pitcher, sizeof(game.pitcher), fields[12]);
  game.pitch_count = parse_u16(fields[13]);
  copy_text(game.venue, sizeof(game.venue), fields[14]);
  copy_text(game.event, sizeof(game.event), fields[15]);
  // Fields 16 and 17 are gamePk and feed timecode. They are retained in the
  // protocol for diagnostics even though this layout does not draw them.
  game.valid = true;
  screen_state = ScreenState::Game;
  needs_redraw = true;
  Serial.printf("LIVE_DISPLAY_UPDATE=%s_%u_%s_%u_%s\n", game.away,
                game.away_score, game.home, game.home_score, game.inning);
}

void accept_status_message(char** fields, std::size_t field_count) {
  if (field_count < 2) {
    return;
  }
  copy_text(status_message, sizeof(status_message), fields[1]);
  game.valid = false;
  screen_state = ScreenState::Waiting;
  needs_redraw = true;
  Serial.printf("LIVE_DISPLAY_STATUS=%s\n", status_message);
}

void accept_upcoming_message(char** fields, std::size_t field_count) {
  constexpr std::size_t kExpectedUpcomingFieldCount = 8;
  if (field_count != kExpectedUpcomingFieldCount) {
    Serial.printf("LIVE_DISPLAY_ERROR=UPCOMING_FIELD_COUNT_%u\n",
                  static_cast<unsigned>(field_count));
    return;
  }
  copy_text(upcoming.away, sizeof(upcoming.away), fields[1]);
  copy_text(upcoming.home, sizeof(upcoming.home), fields[2]);
  copy_text(upcoming.date, sizeof(upcoming.date), fields[3]);
  copy_text(upcoming.time, sizeof(upcoming.time), fields[4]);
  copy_text(upcoming.timezone, sizeof(upcoming.timezone), fields[5]);
  copy_text(upcoming.venue, sizeof(upcoming.venue), fields[6]);
  // Field 7 is gamePk and is retained for protocol diagnostics.
  screen_state = ScreenState::Upcoming;
  needs_redraw = true;
  Serial.printf("LIVE_DISPLAY_UPCOMING=%s_AT_%s_%s_%s_%s\n", upcoming.away,
                upcoming.home, upcoming.date, upcoming.time,
                upcoming.timezone);
}

void accept_offseason_message(char** fields, std::size_t field_count) {
  if (field_count < 2) {
    Serial.println("LIVE_DISPLAY_ERROR=OFFSEASON_FIELDS");
    return;
  }
  copy_text(offseason_season, sizeof(offseason_season), fields[1]);
  screen_state = ScreenState::Offseason;
  needs_redraw = true;
  Serial.printf("LIVE_DISPLAY_OFFSEASON=%s\n", offseason_season);
}

void accept_delay_message(char** fields, std::size_t field_count) {
  if (field_count < 3) {
    Serial.println("LIVE_DISPLAY_ERROR=DELAY_FIELDS");
    return;
  }
  const bool rain = std::strcmp(fields[1], "RAIN") == 0;
  if (!rain && std::strcmp(fields[1], "GENERIC") != 0) {
    Serial.printf("LIVE_DISPLAY_ERROR=DELAY_KIND_%s\n", fields[1]);
    return;
  }
  copy_text(delay_detail, sizeof(delay_detail), fields[2]);
  screen_state = rain ? ScreenState::RainDelay : ScreenState::GenericDelay;
  last_rain_frame = 0xFF;
  needs_redraw = true;
  Serial.printf("LIVE_DISPLAY_DELAY=%s|%s\n", rain ? "RAIN" : "GENERIC",
                delay_detail);
}

void accept_state_message(char** fields, std::size_t field_count) {
  if (field_count < 3) {
    Serial.println("LIVE_DISPLAY_ERROR=STATE_FIELDS");
    return;
  }
  if (std::strcmp(fields[1], "REVIEW") == 0) {
    screen_state = ScreenState::Review;
  } else if (std::strcmp(fields[1], "SUSPENDED") == 0) {
    screen_state = ScreenState::Suspended;
  } else if (std::strcmp(fields[1], "POSTPONED") == 0) {
    screen_state = ScreenState::Postponed;
  } else if (std::strcmp(fields[1], "CANCELLED") == 0) {
    screen_state = ScreenState::Cancelled;
  } else {
    Serial.printf("LIVE_DISPLAY_ERROR=STATE_KIND_%s\n", fields[1]);
    return;
  }
  copy_text(state_detail, sizeof(state_detail), fields[2]);
  needs_redraw = true;
  Serial.printf("LIVE_DISPLAY_STATE=%s|%s\n", fields[1], state_detail);
}

void accept_final_message(char** fields, std::size_t field_count) {
  constexpr std::size_t kExpectedFinalFieldCount = 9;
  if (field_count != kExpectedFinalFieldCount) {
    Serial.printf("LIVE_DISPLAY_ERROR=FINAL_FIELD_COUNT_%u\n",
                  static_cast<unsigned>(field_count));
    return;
  }
  copy_text(final_game.away, sizeof(final_game.away), fields[1]);
  final_game.away_score = parse_u16(fields[2]);
  copy_text(final_game.home, sizeof(final_game.home), fields[3]);
  final_game.home_score = parse_u16(fields[4]);
  copy_text(final_game.result, sizeof(final_game.result), fields[5]);
  copy_text(final_game.venue, sizeof(final_game.venue), fields[6]);
  // Fields 7 and 8 retain gamePk and feed timecode for diagnostics.
  screen_state = ScreenState::Final;
  needs_redraw = true;
  Serial.printf("LIVE_DISPLAY_FINAL=%s_%u_%s_%u_%s\n", final_game.away,
                final_game.away_score, final_game.home, final_game.home_score,
                final_game.result);
}

void end_celebration(const char* reason) {
  if (!celebration_active) {
    return;
  }
  celebration_active = false;
  scan_lock.leave();
  needs_redraw = true;
  Serial.printf("LIVE_DISPLAY_CELEBRATION_END=%s\n", reason);
}

// @CELEBRATION|HOME_RUN|JUAN SOTO|<play key>   or   @CELEBRATION|GRAND_SLAM|...
// @CELEBRATION|END stops early.
void accept_celebration_message(char** fields, std::size_t field_count) {
  if (field_count >= 2 && std::strcmp(fields[1], "END") == 0) {
    end_celebration("HOST");
    return;
  }
  if (field_count < 3) {
    Serial.println("LIVE_DISPLAY_ERROR=CELEBRATION_FIELDS");
    return;
  }
  const bool win = std::strcmp(fields[1], "METS_WIN") == 0;
  const bool grand_slam = std::strcmp(fields[1], "GRAND_SLAM") == 0;
  if (!win && !grand_slam && std::strcmp(fields[1], "HOME_RUN") != 0) {
    Serial.printf("LIVE_DISPLAY_ERROR=CELEBRATION_KIND_%s\n", fields[1]);
    return;
  }
  if (win) {
    // @CELEBRATION|METS_WIN|<away>|<away runs>|<home>|<home runs>|<key>
    if (field_count < 6) {
      Serial.println("LIVE_DISPLAY_ERROR=CELEBRATION_FIELDS");
      return;
    }
    const bool mets_home = std::strcmp(fields[4], "NYM") == 0;
    mets_win_loop.begin(fields[2], parse_u16(fields[3]), fields[4], parse_u16(fields[5]), mets_home,
                        esp_random());
    Serial.printf("LIVE_DISPLAY_CELEBRATION=METS_WIN|%s %u|%s %u|%s\n", mets_win_loop.away(),
                  mets_win_loop.away_runs(), mets_win_loop.home(), mets_win_loop.home_runs(),
                  field_count > 6 ? fields[6] : "-");
  } else {
    copy_text(celebration_name, sizeof(celebration_name), fields[2]);
    home_run_loop.begin(grand_slam ? apple::display::Headline::GrandSlam
                                   : apple::display::Headline::HomeRun,
                        celebration_name, esp_random());
    Serial.printf("LIVE_DISPLAY_CELEBRATION=%s|%s|%s\n",
                  grand_slam ? "GRAND_SLAM" : "HOME_RUN", celebration_name,
                  field_count > 3 ? fields[3] : "-");
  }
  celebration_is_win = win;
  celebration_active = true;
  scan_lock.enter(1);
  celebration_started_ms = millis();
  celebration_last_key = 0xFFFFFFFFU;
  celebration_logged_loop = 0xFFFFFFFFU;
}

void service_celebration() {
  if (!celebration_active) {
    return;
  }
  const std::uint32_t now_ms = millis();
  const std::uint32_t elapsed_ms = now_ms - celebration_started_ms;
  if (elapsed_ms >= kCelebrationDisplayMs) {
    end_celebration("WINDOW");
    return;
  }
  // Redraw only when the picture can change, and push only what did.
  const std::uint32_t key = celebration_is_win ? mets_win_loop.render_key(elapsed_ms)
                                               : home_run_loop.render_key(elapsed_ms);
  if (key == celebration_last_key) {
    return;
  }
  celebration_last_key = key;
  const std::uint32_t loop_index = celebration_is_win ? mets_win_loop.loop_index(elapsed_ms)
                                                      : home_run_loop.loop_index(elapsed_ms);
  if (loop_index != celebration_logged_loop) {
    celebration_logged_loop = loop_index;
    if (celebration_is_win) {
      const apple::display::MetsWinPicks picks = mets_win_loop.picks_for_loop(loop_index);
      Serial.printf("LIVE_DISPLAY_LOOP=%lu logo=%s/%s/%s words=%s/%s/%s card=%s/%s\n",
                    static_cast<unsigned long>(loop_index + 1),
                    apple::display::logo_entrance_name(picks.logo.entrance),
                    apple::display::logo_hold_name(picks.logo.hold),
                    apple::display::logo_exit_name(picks.logo.exit),
                    apple::display::entrance_name(picks.text.entrance),
                    apple::display::hold_name(picks.text.hold),
                    apple::display::exit_name(picks.text.exit),
                    apple::display::card_entrance_name(picks.card.entrance),
                    apple::display::card_exit_name(picks.card.exit));
    } else {
      const apple::display::SequencePicks picks = home_run_loop.picks_for_loop(loop_index);
      Serial.printf("LIVE_DISPLAY_LOOP=%lu headline=%s/%s/%s name=%s/%s/%s\n",
                    static_cast<unsigned long>(loop_index + 1),
                    apple::display::entrance_name(picks.headline.entrance),
                    apple::display::hold_name(picks.headline.hold),
                    apple::display::exit_name(picks.headline.exit),
                    apple::display::entrance_name(picks.name.entrance),
                    apple::display::hold_name(picks.name.hold),
                    apple::display::exit_name(picks.name.exit));
    }
  }
  const apple::display::DirtyRect dirty =
      celebration_is_win ? mets_win_loop.render(elapsed_ms, display.getBuffer(),
                                                apple::display::default_mets_win_colors())
                         : home_run_loop.render(elapsed_ms, display.getBuffer(),
                                                apple::display::default_colors());
  scan_lock.push(display.getBuffer(), kDisplayWidth, dirty);
}

void accept_serial_line(char* line) {
  char* fields[20] = {};
  const std::size_t field_count =
      split_fields(line, fields, sizeof(fields) / sizeof(fields[0]));
  if (field_count == 0) {
    return;
  }
  if (std::strcmp(fields[0], "@GAME") == 0) {
    accept_game_message(fields, field_count);
  } else if (std::strcmp(fields[0], "@UPCOMING") == 0) {
    accept_upcoming_message(fields, field_count);
  } else if (std::strcmp(fields[0], "@OFFSEASON") == 0) {
    accept_offseason_message(fields, field_count);
  } else if (std::strcmp(fields[0], "@DELAY") == 0) {
    accept_delay_message(fields, field_count);
  } else if (std::strcmp(fields[0], "@STATE") == 0) {
    accept_state_message(fields, field_count);
  } else if (std::strcmp(fields[0], "@FINAL") == 0) {
    accept_final_message(fields, field_count);
  } else if (std::strcmp(fields[0], "@STATUS") == 0) {
    accept_status_message(fields, field_count);
  } else if (std::strcmp(fields[0], "@CELEBRATION") == 0) {
    accept_celebration_message(fields, field_count);
  }
}

void service_serial() {
  while (Serial.available() > 0) {
    const char value = static_cast<char>(Serial.read());
    if (value == '\r') {
      continue;
    }
    if (value == '\n') {
      serial_line[serial_line_length] = '\0';
      if (serial_line_length > 0) {
        accept_serial_line(serial_line);
      }
      serial_line_length = 0;
      continue;
    }
    if (serial_line_length + 1 < kSerialLineCapacity) {
      serial_line[serial_line_length++] = value;
    } else {
      serial_line_length = 0;
      Serial.println("LIVE_DISPLAY_ERROR=SERIAL_LINE_TOO_LONG");
    }
  }
}

void render_if_needed() {
  const std::uint8_t rain_frame = static_cast<std::uint8_t>(
      (millis() / kRainFrameDurationMs) % kRainFrameCount);
  const bool rain_frame_changed =
      screen_state == ScreenState::RainDelay && rain_frame != last_rain_frame;
  if (!needs_redraw && !rain_frame_changed) {
    return;
  }
  switch (screen_state) {
    case ScreenState::Game:
      draw_game_layout();
      break;
    case ScreenState::Upcoming:
      draw_upcoming_layout();
      break;
    case ScreenState::Offseason:
      draw_offseason_layout();
      break;
    case ScreenState::GenericDelay:
      draw_delay_layout(false);
      break;
    case ScreenState::RainDelay:
      draw_delay_layout(true, rain_frame);
      last_rain_frame = rain_frame;
      break;
    case ScreenState::Review:
    case ScreenState::Suspended:
    case ScreenState::Postponed:
    case ScreenState::Cancelled:
      draw_state_layout(screen_state);
      break;
    case ScreenState::Final:
      draw_final_layout();
      break;
    case ScreenState::Waiting:
    default:
      draw_waiting_layout();
      break;
  }
  panel.drawRGBBitmap(0, 0, display.getBuffer(), kDisplayWidth,
                      kDisplayHeight);
  needs_redraw = false;
}

}  // namespace

void setup() {
  apple::firmware::disarm_motion_outputs();

  Serial.begin(115200);
  const std::uint32_t serial_wait_started_ms = millis();
  while (!Serial && millis() - serial_wait_started_ms < kSerialWaitTimeoutMs) {
    delay(10);
  }

  pinMode(kDisplayBacklightPin, OUTPUT);
  digitalWrite(kDisplayBacklightPin, LOW);
  SPI.begin();
  panel.init(240, 320);
  panel.setRotation(1);
  panel.fillScreen(kDarkBlue);
  render_if_needed();
  digitalWrite(kDisplayBacklightPin, HIGH);

  Serial.println();
  Serial.println("LIVE_DISPLAY_USB=READY");
  Serial.println(
      "LIVE_DISPLAY_PROTOCOL=@GAME_V1,@UPCOMING_V1,@OFFSEASON_V1,"
      "@DELAY_V1,@STATE_V1,@FINAL_V1,@CELEBRATION_V1");
  Serial.printf("DISPLAY_FONT=%s (%s)\n", apple::display::font_name(),
                apple::display::font_license());
  Serial.println("MOTION_OUTPUTS=LOW");
}

void loop() {
  apple::firmware::disarm_motion_outputs();
  service_serial();
  if (celebration_active) {
    service_celebration();
  } else {
    render_if_needed();
  }
  delay(1);
}
