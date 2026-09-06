#include <Fonts/FreeSansBold12pt7b.h>
#include "apple/firmware/offseason_art.hpp"
#include "apple/firmware/player_names.hpp"
#include "apple/firmware/screens.hpp"
#include "apple/firmware/team_colors.hpp"

#include <Adafruit_ST7789.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace apple::firmware {

namespace {

constexpr std::int16_t kStatusCardX = 10;
constexpr std::int16_t kStatusCardY = 58;
constexpr std::int16_t kStatusCardWidth = 300;
constexpr std::int16_t kStatusCardHeight = 176;
constexpr std::int16_t kStatusIconCenterX = 160;
constexpr std::int16_t kStatusLineOneY = 148;
constexpr std::int16_t kStatusLineTwoY = 176;
constexpr std::int16_t kStatusScoreY = 210;
// Center the 42-46 px status icons in the open space between the card's top
// edge and the first in-card heading.
constexpr std::int16_t kStatusIconCenterY =
    (kStatusCardY + kStatusLineOneY) / 2;

std::int16_t panel_text_width(const char* value, std::uint8_t scale) {
  const std::size_t length = std::strlen(value);
  if (length == 0) return 0;
  return static_cast<std::int16_t>((length * 6U - 1U) * scale);
}

void uppercase_ascii(char* value) {
  for (; *value != '\0'; ++value) {
    if (*value >= 'a' && *value <= 'z') {
      *value = static_cast<char>(*value - 'a' + 'A');
    }
  }
}

}  // namespace

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

void ScreenPainter::set_text(std::uint16_t color, std::uint8_t size) {
  canvas_.setTextColor(color);
  canvas_.setTextSize(size);
  canvas_.setTextWrap(false);
}

void ScreenPainter::draw_centered(const char* text, std::int16_t center_x, std::int16_t y,
                   std::uint8_t size, std::uint16_t color) {
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(color, size);
  canvas_.getTextBounds(text, 0, y, &bounds_x, &bounds_y, &bounds_width,
                        &bounds_height);
  canvas_.setCursor(center_x - static_cast<std::int16_t>(bounds_width / 2), y);
  canvas_.print(text);
}

void ScreenPainter::draw_right_aligned(const char* text, std::int16_t right_x,
                        std::int16_t y, std::uint8_t size,
                        std::uint16_t color) {
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(color, size);
  canvas_.getTextBounds(text, 0, y, &bounds_x, &bounds_y, &bounds_width,
                        &bounds_height);
  canvas_.setCursor(right_x - static_cast<std::int16_t>(bounds_width), y);
  canvas_.print(text);
}

void ScreenPainter::draw_fitted_player_name(const char* text, std::int16_t left_x,
                             std::int16_t top_y, std::uint16_t max_width) {
  char fitted[32] = {};
  const bool buffer_truncated = std::strlen(text) >= sizeof(fitted);
  copy_text(fitted, sizeof(fitted), text);
  std::uint8_t size = 2;
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(ST77XX_WHITE, size);
  canvas_.getTextBounds(fitted, 0, 0, &bounds_x, &bounds_y, &bounds_width,
                        &bounds_height);
  if (bounds_width > max_width) {
    size = 1;
  }
  set_text(ST77XX_WHITE, size);
  canvas_.getTextBounds(fitted, 0, 0, &bounds_x, &bounds_y, &bounds_width,
                        &bounds_height);
  bool width_truncated = false;
  std::size_t length = std::strlen(fitted);
  while (bounds_width > max_width && length > 0) {
    fitted[--length] = '\0';
    width_truncated = true;
    canvas_.getTextBounds(fitted, 0, 0, &bounds_x, &bounds_y, &bounds_width,
                          &bounds_height);
  }
  if ((buffer_truncated || width_truncated) && length >= 3) {
    fitted[length - 3] = '.';
    fitted[length - 2] = '.';
    fitted[length - 1] = '.';
  }
  const std::int16_t centered_y =
      top_y + static_cast<std::int16_t>((16 - size * 8) / 2);
  canvas_.setCursor(left_x, centered_y);
  canvas_.print(fitted);
}

void ScreenPainter::draw_interruption_score(const GameScreen& game) {
  if (!game.valid) return;

  char away_score[8] = {};
  char home_score[8] = {};
  std::snprintf(away_score, sizeof(away_score), "%u", game.away_score);
  std::snprintf(home_score, sizeof(home_score), "%u", game.home_score);

  constexpr std::uint8_t kScale = 2;
  constexpr std::int16_t kTeamScoreGap = 8;
  constexpr std::int16_t kMatchupGap = 20;
  const auto away_team_width = panel_text_width(game.away, kScale);
  const auto home_team_width = panel_text_width(game.home, kScale);
  const auto away_score_width = panel_text_width(away_score, kScale);
  const auto home_score_width = panel_text_width(home_score, kScale);
  const std::int16_t total_width =
      away_team_width + kTeamScoreGap + away_score_width + kMatchupGap +
      home_team_width + kTeamScoreGap + home_score_width;
  std::int16_t cursor_x = (kDisplayWidth - total_width) / 2;

  set_text(team_abbreviation_color(game.away), kScale);
  canvas_.setCursor(cursor_x, kStatusScoreY);
  canvas_.print(game.away);
  cursor_x += away_team_width + kTeamScoreGap;
  set_text(ST77XX_WHITE, kScale);
  canvas_.setCursor(cursor_x, kStatusScoreY);
  canvas_.print(away_score);
  cursor_x += away_score_width + kMatchupGap;
  set_text(team_abbreviation_color(game.home), kScale);
  canvas_.setCursor(cursor_x, kStatusScoreY);
  canvas_.print(game.home);
  cursor_x += home_team_width + kTeamScoreGap;
  set_text(ST77XX_WHITE, kScale);
  canvas_.setCursor(cursor_x, kStatusScoreY);
  canvas_.print(home_score);
}

void ScreenPainter::draw_base_diamond(std::int16_t center_x, std::int16_t center_y,
                       std::int16_t radius, bool occupied) {
  const std::uint16_t color = occupied ? kGold : ST77XX_WHITE;
  const std::uint16_t fill = occupied ? color : kDarkBlue;
  canvas_.fillTriangle(center_x, center_y - radius, center_x + radius, center_y,
                       center_x, center_y + radius, fill);
  canvas_.fillTriangle(center_x, center_y - radius, center_x - radius, center_y,
                       center_x, center_y + radius, fill);
  canvas_.drawLine(center_x, center_y - radius, center_x + radius, center_y,
                   color);
  canvas_.drawLine(center_x + radius, center_y, center_x, center_y + radius,
                   color);
  canvas_.drawLine(center_x, center_y + radius, center_x - radius, center_y,
                   color);
  canvas_.drawLine(center_x - radius, center_y, center_x, center_y - radius,
                   color);
}

void ScreenPainter::draw_out_dots(std::uint8_t outs) {
  for (std::uint8_t index = 0; index < 2; ++index) {
    const std::int16_t x =
        kLiveBasesCenterX - 10 + static_cast<std::int16_t>(index * 20);
    if (index < outs) {
      canvas_.fillCircle(x, 126, 6, kMetsOrange);
    } else {
      canvas_.drawCircle(x, 126, 6, kMutedBlue);
    }
  }
}

void ScreenPainter::draw_waiting_icon(WaitingIcon icon, std::uint16_t accent, std::int16_t top) {
  const std::int16_t cx = 160;
  switch (icon) {
    case WaitingIcon::Alert:
      for (std::int16_t i = 0; i < 3; ++i) canvas_.drawRect(142 + i, top + i, 36 - 2 * i, 36 - 2 * i, accent);
      canvas_.fillRect(cx - 2, top + 8, 5, 14, accent);
      canvas_.fillRect(cx - 2, top + 25, 5, 4, accent);
      break;
    case WaitingIcon::Update:
      for (std::int16_t i = 0; i < 3; ++i) canvas_.drawRect(142 + i, top + i, 36 - 2 * i, 36 - 2 * i, accent);
      canvas_.fillRect(cx - 2, top + 6, 4, 13, accent);
      canvas_.fillTriangle(cx - 8, top + 18, cx + 8, top + 18, cx, top + 26, accent);
      canvas_.fillRect(cx - 10, top + 28, 21, 3, accent);
      break;
    case WaitingIcon::Wifi:
    case WaitingIcon::WifiLost: {
      // Stepped 8-bit bands with flat crowns, matching the Aseprite template.
      const auto band = [&](std::int16_t top_y, std::int16_t max_dx, std::int16_t plateau,
                            std::int16_t step, std::int16_t block) {
        for (std::int16_t dx = -max_dx; dx <= max_dx; dx += step) {
          const std::int16_t drop = std::max<std::int16_t>(0, static_cast<std::int16_t>(std::abs(dx) - plateau));
          const std::int16_t y = top_y + static_cast<std::int16_t>((drop + step - 1) / step) * step;
          canvas_.fillRect(cx + dx - block / 2, y, block, block, accent);
        }
      };
      band(top, 30, 10, 5, 6);
      band(top + 12, 20, 5, 5, 6);
      band(top + 22, 12, 4, 4, 5);
      canvas_.fillRect(156, top + 30, 9, 6, accent);
      if (icon == WaitingIcon::WifiLost) {
        for (std::int16_t i = 0; i <= 35; ++i) canvas_.fillRect(142 + i, top + 35 - i, 3, 1, kErrorRed);
      }
      break;
    }
    case WaitingIcon::Clock: {
      const std::int16_t cy = top + 18;
      canvas_.drawCircle(cx, cy, 17, accent);
      canvas_.drawCircle(cx, cy, 16, accent);
      canvas_.drawCircle(cx, cy, 15, accent);
      canvas_.fillRect(cx - 1, cy - 11, 3, 12, accent);
      canvas_.fillRect(cx - 1, cy - 1, 9, 3, accent);
      break;
    }
    case WaitingIcon::None:
    default:
      break;
  }
}

void ScreenPainter::draw_waiting_layout(const ScreenModel& model) {
  // Status card: 3x header, a filled panel with an accent border (orange for
  // information, yellow while retrying, red for errors), an optional icon,
  // status at 3x when it fits (2x otherwise), an optional note at 2x split
  // on '|', no footer.
  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  canvas_.fillRect(0, 38, kDisplayWidth, 4, model.waiting_accent);
  draw_centered(model.waiting_title, 160, 9, 3, ST77XX_WHITE);

  canvas_.fillRoundRect(10, 62, 300, 156, 9, kPanelBlue);
  canvas_.drawRoundRect(10, 62, 300, 156, 9, model.waiting_accent);
  canvas_.drawRoundRect(11, 63, 298, 154, 8, model.waiting_accent);
  const bool has_icon = model.waiting_icon != WaitingIcon::None;
  const std::size_t status_length = std::strlen(model.status_message);
  const std::uint8_t status_size = status_length <= 15 ? 3 : status_length <= 25 ? 2 : 1;
  const bool has_note = model.waiting_note[0] != '\0';
  std::int16_t status_y = has_note ? 104 : (status_size == 3 ? 128 : 132);
  std::int16_t note_y = 148;
  if (has_icon) {
    draw_waiting_icon(model.waiting_icon, model.waiting_accent, has_note ? 70 : 82);
    status_y = has_note ? 116 : 130;
    note_y = 156;
  }
  draw_centered(model.status_message, 160, status_y, status_size, model.status_color);
  if (has_note) {
    char first[sizeof(model.waiting_note)];
    copy_text(first, sizeof(first), model.waiting_note);
    char* second = std::strchr(first, '|');
    if (second != nullptr) {
      *second = '\0';
      ++second;
    }
    draw_centered(first, 160, note_y, 2, kNeutralGray);
    if (second != nullptr) draw_centered(second, 160, note_y + 22, 2, kNeutralGray);
  }
}


void ScreenPainter::draw_upcoming_layout(const ScreenModel& model) {
  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  canvas_.fillRect(0, 38, kDisplayWidth, 4, kMetsOrange);
  draw_centered(model.upcoming.game_number == 2 ? "DOUBLEHEADER GAME 2"
                                                : "NEXT METS GAME",
                160, 10, 2, ST77XX_WHITE);

  const std::uint16_t away_color =
      std::strcmp(model.upcoming.away, "NYM") == 0 ? kMetsOrange : ST77XX_WHITE;
  const std::uint16_t home_color =
      std::strcmp(model.upcoming.home, "NYM") == 0 ? kMetsOrange : ST77XX_WHITE;
  const auto draw_team = [&](const char* abbreviation, std::int16_t center_x,
                             std::uint16_t color) {
    constexpr std::uint8_t kTeamScale = 4;
    const std::int16_t width = panel_text_width(abbreviation, kTeamScale);
    set_text(color, kTeamScale);
    canvas_.setCursor(center_x - width / 2, 77);
    canvas_.print(abbreviation);
  };
  // getTextBounds() includes the classic font's invisible trailing column.
  // Center the visible glyph cells so two-letter clubs such as SF and SD sit
  // on the same column centers as three-letter abbreviations.
  draw_team(model.upcoming.away, 80, away_color);
  draw_centered("AT", 160, 89, 2, kMutedBlue);
  draw_team(model.upcoming.home, 240, home_color);

  canvas_.drawRoundRect(26, 130, 268, 68, 8, kMutedBlue);
  draw_centered(model.upcoming.date, 160, 143, 2, ST77XX_WHITE);
  char local_time[24] = {};
  std::snprintf(local_time, sizeof(local_time), "%s %s", model.upcoming.time,
                model.upcoming.timezone);
  draw_centered(local_time, 160, 169, 2, kGold);

  canvas_.fillRect(0, 232, kDisplayWidth, 8, kMetsOrange);
}

void ScreenPainter::draw_offseason_layout(const ScreenModel& model) {
  draw_offseason_art(canvas_, model.offseason_season);
}

void ScreenPainter::draw_delay_layout(const ScreenModel& model, bool rain,
                                      std::uint8_t rain_frame) {
  const std::uint16_t accent = rain ? kMutedBlue : kDelayYellow;
  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  canvas_.fillRect(0, 38, kDisplayWidth, 4, accent);
  draw_centered(rain ? "RAIN DELAY" : "GAME DELAYED", 160, 10, 2,
                ST77XX_WHITE);

  canvas_.fillRect(kStatusCardX, kStatusCardY, kStatusCardWidth,
                   kStatusCardHeight, kPanelBlue);
  for (std::int16_t inset = 0; inset < 2; ++inset) {
    canvas_.drawRect(kStatusCardX + inset, kStatusCardY + inset,
                     kStatusCardWidth - inset * 2,
                     kStatusCardHeight - inset * 2, accent);
  }
  if (rain) {
    canvas_.fillCircle(143, 108, 10, kMutedBlue);
    canvas_.fillCircle(160, 102, 15, kMutedBlue);
    canvas_.fillCircle(179, 109, 11, kMutedBlue);
    canvas_.fillRect(143, 108, 37, 12, kMutedBlue);
    for (std::uint8_t index = 0;
         index < sizeof(kRainOffsets) / sizeof(kRainOffsets[0]); ++index) {
      const std::int16_t x = 136 + static_cast<std::int16_t>(index * 8);
      const std::int16_t y =
          123 + static_cast<std::int16_t>(
                    (kRainOffsets[index] + rain_frame * 4) % 24);
      const std::int16_t length = index % 2 == 0 ? 9 : 7;
      canvas_.drawLine(x, y, x - 3, y + length - 1, kRainBlue);
      canvas_.drawLine(x + 1, y, x - 2, y + length - 1, kRainBlue);
    }
    draw_centered("WAITING FOR UPDATE", 160, kStatusLineTwoY, 2,
                  ST77XX_WHITE);
  } else {
    canvas_.fillCircle(kStatusIconCenterX, kStatusIconCenterY, 22,
                       kDelayYellow);
    canvas_.fillCircle(kStatusIconCenterX, kStatusIconCenterY, 18,
                       kPanelBlue);
    canvas_.fillRect(kStatusIconCenterX - 1, kStatusIconCenterY - 13, 3, 14,
                     kDelayYellow);
    canvas_.drawLine(kStatusIconCenterX, kStatusIconCenterY,
                     kStatusIconCenterX + 12, kStatusIconCenterY + 6,
                     kDelayYellow);
    canvas_.drawLine(kStatusIconCenterX, kStatusIconCenterY + 1,
                     kStatusIconCenterX + 12, kStatusIconCenterY + 7,
                     kDelayYellow);
    draw_centered("DELAY IN PROGRESS", 160, kStatusLineOneY, 2,
                  kDelayYellow);
    draw_centered(model.delay_detail, 160, kStatusLineTwoY, 2,
                  ST77XX_WHITE);
  }
  draw_interruption_score(model.game);
}

void ScreenPainter::draw_state_layout(const ScreenModel& model, ScreenState state) {
  const bool is_review = state == ScreenState::Review;
  const bool is_suspended = state == ScreenState::Suspended;
  const bool is_postponed = state == ScreenState::Postponed;
  const bool is_cancelled = state == ScreenState::Cancelled;
  const std::uint16_t accent =
      (is_postponed || is_cancelled) ? kInterruptionRed : kDelayYellow;
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
                                        : model.state_detail;

  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  canvas_.fillRect(0, 38, kDisplayWidth, 4, accent);
  draw_centered(title, 160, 10, 2, ST77XX_WHITE);
  canvas_.fillRect(kStatusCardX, kStatusCardY, kStatusCardWidth,
                   kStatusCardHeight, kPanelBlue);
  for (std::int16_t inset = 0; inset < 2; ++inset) {
    canvas_.drawRect(kStatusCardX + inset, kStatusCardY + inset,
                     kStatusCardWidth - inset * 2,
                     kStatusCardHeight - inset * 2, accent);
  }

  if (is_review) {
    for (std::int16_t inset = 0; inset < 2; ++inset) {
      const std::int16_t radius = 23 - inset;
      canvas_.drawLine(kStatusIconCenterX, kStatusIconCenterY - radius,
                       kStatusIconCenterX + radius, kStatusIconCenterY,
                       accent);
      canvas_.drawLine(kStatusIconCenterX + radius, kStatusIconCenterY,
                       kStatusIconCenterX, kStatusIconCenterY + radius,
                       accent);
      canvas_.drawLine(kStatusIconCenterX, kStatusIconCenterY + radius,
                       kStatusIconCenterX - radius, kStatusIconCenterY,
                       accent);
      canvas_.drawLine(kStatusIconCenterX - radius, kStatusIconCenterY,
                       kStatusIconCenterX, kStatusIconCenterY - radius,
                       accent);
    }
    // The classic font's visible question-mark glyph sits one pixel up and
    // two display pixels left when its blank sixth column is centered at 3x.
    // Offset the lit pixels themselves to the center of the diamond.
    draw_centered("?", kStatusIconCenterX + 2, kStatusIconCenterY - 10, 3,
                  accent);
  } else if (is_suspended) {
    for (std::int16_t inset = 0; inset < 3; ++inset) {
      const std::int16_t radius = 23 - inset;
      constexpr std::int16_t kFlat = 9;
      canvas_.drawLine(kStatusIconCenterX - kFlat,
                       kStatusIconCenterY - radius,
                       kStatusIconCenterX + kFlat,
                       kStatusIconCenterY - radius, accent);
      canvas_.drawLine(kStatusIconCenterX + kFlat,
                       kStatusIconCenterY - radius,
                       kStatusIconCenterX + radius,
                       kStatusIconCenterY - kFlat, accent);
      canvas_.drawLine(kStatusIconCenterX + radius,
                       kStatusIconCenterY - kFlat,
                       kStatusIconCenterX + radius,
                       kStatusIconCenterY + kFlat, accent);
      canvas_.drawLine(kStatusIconCenterX + radius,
                       kStatusIconCenterY + kFlat,
                       kStatusIconCenterX + kFlat,
                       kStatusIconCenterY + radius, accent);
      canvas_.drawLine(kStatusIconCenterX + kFlat,
                       kStatusIconCenterY + radius,
                       kStatusIconCenterX - kFlat,
                       kStatusIconCenterY + radius, accent);
      canvas_.drawLine(kStatusIconCenterX - kFlat,
                       kStatusIconCenterY + radius,
                       kStatusIconCenterX - radius,
                       kStatusIconCenterY + kFlat, accent);
      canvas_.drawLine(kStatusIconCenterX - radius,
                       kStatusIconCenterY + kFlat,
                       kStatusIconCenterX - radius,
                       kStatusIconCenterY - kFlat, accent);
      canvas_.drawLine(kStatusIconCenterX - radius,
                       kStatusIconCenterY - kFlat,
                       kStatusIconCenterX - kFlat,
                       kStatusIconCenterY - radius, accent);
    }
    canvas_.fillRect(kStatusIconCenterX - 2, kStatusIconCenterY - 13, 5, 17,
                     accent);
    canvas_.fillRect(kStatusIconCenterX - 2, kStatusIconCenterY + 9, 5, 5,
                     accent);
  } else {
    for (std::int16_t inset = 0; inset < 3; ++inset) {
      canvas_.drawRect(kStatusIconCenterX - 21 + inset,
                       kStatusIconCenterY - 21 + inset, 42 - inset * 2,
                       42 - inset * 2, accent);
    }
    if (is_postponed) {
      canvas_.fillRect(kStatusIconCenterX - 11, kStatusIconCenterY - 2, 23, 4,
                       accent);
    } else {
      canvas_.drawLine(kStatusIconCenterX - 12, kStatusIconCenterY - 12,
                       kStatusIconCenterX + 12, kStatusIconCenterY + 12,
                       accent);
      canvas_.drawLine(kStatusIconCenterX + 12, kStatusIconCenterY - 12,
                       kStatusIconCenterX - 12, kStatusIconCenterY + 12,
                       accent);
    }
  }
  draw_centered(line_one, 160, kStatusLineOneY, 2, accent);
  draw_centered(line_two, 160, kStatusLineTwoY, 2, ST77XX_WHITE);
  draw_interruption_score(model.game);
}

void ScreenPainter::draw_final_layout(const ScreenModel& model) {
  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 48, kMetsBlue);
  canvas_.fillRect(0, 44, kDisplayWidth, 4, kMetsOrange);
  draw_centered("FINAL", 160, 10, 3, ST77XX_WHITE);

  canvas_.fillRect(28, 65, 264, 116, kPanelBlue);
  canvas_.drawRect(28, 65, 264, 116, kMutedBlue);
  draw_centered("AT", 160, 86, 1, kMutedBlue);
  const std::uint16_t away_color =
      std::strcmp(model.final_game.away, "NYM") == 0 ? kMetsOrange : ST77XX_WHITE;
  const std::uint16_t home_color =
      std::strcmp(model.final_game.home, "NYM") == 0 ? kMetsOrange : ST77XX_WHITE;
  draw_centered(model.final_game.away, 82, 78, 3, away_color);
  draw_centered(model.final_game.home, 238, 78, 3, home_color);

  char away_score[8] = {};
  char home_score[8] = {};
  std::snprintf(away_score, sizeof(away_score), "%u", model.final_game.away_score);
  std::snprintf(home_score, sizeof(home_score), "%u", model.final_game.home_score);
  draw_centered(away_score, 82, 112, 5, ST77XX_WHITE);
  draw_centered(home_score, 238, 112, 5, ST77XX_WHITE);

  if (std::strcmp(model.final_game.result, "METS_WIN") == 0) {
    draw_centered("METS WIN", 160, 190, 2, kMetsOrange);
  } else if (std::strcmp(model.final_game.result, "TIE") == 0) {
    draw_centered("TIE GAME", 160, 190, 2, ST77XX_WHITE);
  }
  canvas_.fillRect(0, 220, kDisplayWidth, 20, kPanelBlue);
  draw_centered(model.final_game.venue, 160, 227, 1, ST77XX_WHITE);
}

void ScreenPainter::draw_game_layout(const ScreenModel& model) {
  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 58, kMetsBlue);
  canvas_.fillRect(0, 54, kDisplayWidth, 4, kMetsOrange);

  char away_score[8] = {};
  char home_score[8] = {};
  constexpr std::int16_t kAwayTeamCenter = 40;
  constexpr std::int16_t kAwayScoreCenter = 98;
  constexpr std::int16_t kHomeTeamCenter = 230;
  constexpr std::int16_t kHomeScoreCenter = 288;

  draw_centered(model.game.away, kAwayTeamCenter, 14, 3,
                team_abbreviation_color(model.game.away));
  std::snprintf(away_score, sizeof(away_score), "%u", model.game.away_score);
  draw_centered(away_score, kAwayScoreCenter, 14, 3, ST77XX_WHITE);

  std::snprintf(home_score, sizeof(home_score), "%u", model.game.home_score);
  draw_centered(model.game.home, kHomeTeamCenter, 14, 3,
                team_abbreviation_color(model.game.home));
  draw_centered(home_score, kHomeScoreCenter, 14, 3, ST77XX_WHITE);

  draw_centered(model.game.inning, 160, 7, 2, ST77XX_WHITE);
  draw_centered("LIVE", 160, 34, 1, kLiveGreen);

  char count[8] = {};
  std::snprintf(count, sizeof(count), "%u-%u", model.game.balls, model.game.strikes);
  draw_centered("COUNT", kLiveCountCenterX, 72, 1, kMutedBlue);
  draw_centered(count, kLiveCountCenterX, 86, 4, kGold);

  draw_base_diamond(kLiveBasesCenterX, 75, 13,
                    (model.game.occupied_bases & 0x02U) != 0);
  draw_base_diamond(kLiveBasesCenterX + 21, 96, 13,
                    (model.game.occupied_bases & 0x01U) != 0);
  draw_base_diamond(kLiveBasesCenterX - 21, 96, 13,
                    (model.game.occupied_bases & 0x04U) != 0);
  draw_out_dots(model.game.outs);
  draw_centered("OUTS", kLiveBasesCenterX, 139, 1, kMutedBlue);

  canvas_.drawFastHLine(0, 151, kDisplayWidth, kMutedBlue);
  set_text(kMetsOrange, 1);
  canvas_.setCursor(12, 155);
  canvas_.print("BATTING");
  canvas_.setCursor(172, 155);
  canvas_.print("PITCHING");

  if (std::strcmp(model.game.batter_line, "-") != 0) {
    char batting_line[16] = {};
    copy_compact_batter_line(batting_line, sizeof(batting_line),
                             model.game.batter_line);
    draw_right_aligned(batting_line, 156, 154, 2, kGold);
  }
  if (model.game.pitch_count > 0) {
    char pitches[10] = {};
    std::snprintf(pitches, sizeof(pitches), "P:%u", model.game.pitch_count);
    draw_right_aligned(pitches, 312, 154, 2, kGold);
  }

  char batter_name[sizeof(model.game.batter)] = {};
  char pitcher_name[sizeof(model.game.pitcher)] = {};
  copy_compact_player_name(batter_name, sizeof(batter_name), model.game.batter);
  copy_compact_player_name(pitcher_name, sizeof(pitcher_name), model.game.pitcher);
  uppercase_ascii(batter_name);
  uppercase_ascii(pitcher_name);
  draw_fitted_player_name(batter_name, 12, 173, kLivePlayerNameWidth);
  draw_fitted_player_name(pitcher_name, 172, 173, kLivePlayerNameWidth);

  char first_event_line[kEventCharactersPerLine + 1] = {};
  char second_event_line[kEventCharactersPerLine + 1] = {};
  const bool event_wraps =
      wrap_event_text(model.game.event, first_event_line, second_event_line);
  canvas_.fillRect(0, 199, kDisplayWidth, event_wraps ? 41 : 21, kPanelBlue);
  set_text(ST77XX_WHITE, 1);
  canvas_.setCursor(7, event_wraps ? 203 : 206);
  canvas_.print(first_event_line);
  if (event_wraps) {
    canvas_.setCursor(7, 224);
    canvas_.print(second_event_line);
  } else {
    canvas_.fillRect(0, 220, kDisplayWidth, 20, kMetsBlue);
    canvas_.setCursor(7, 227);
    canvas_.print(model.game.venue);
  }
}

// First-boot Wi-Fi setup: the network name, its key, and the page address in
// type large enough to read from across a room.
// The owner button's short press. No panel, so the address gets the whole
// height: the name to type in orange, the numeric fallback under it, and the
// password the Manager asks for in gray at the bottom. The name is as large
// as 20 characters can be on this panel with this font.
void ScreenPainter::draw_info_layout(const ScreenModel& model) {
  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  canvas_.fillRect(0, 38, kDisplayWidth, 4, kMetsOrange);
  draw_centered(model.waiting_title, 160, 9, 3, ST77XX_WHITE);
  // The address in a proportional 12 pt bold, the largest that keeps twenty
  // characters inside the panel. Custom fonts position by baseline, so the y
  // here is where the letters sit, not their top. If a longer name ever
  // arrives, fall back to the built-in font rather than clip it.
  {
    std::int16_t bx = 0, by = 0;
    std::uint16_t bw = 0, bh = 0;
    canvas_.setFont(&FreeSansBold12pt7b);
    set_text(kMetsOrange, 1);
    canvas_.getTextBounds(model.status_message, 0, 0, &bx, &by, &bw, &bh);
    if (bw <= 310) {
      canvas_.setCursor(160 - static_cast<std::int16_t>(bw / 2) - bx, 112);
      canvas_.print(model.status_message);
      canvas_.setFont(nullptr);
    } else {
      canvas_.setFont(nullptr);
      draw_centered(model.status_message, 160, 96, 2, kMetsOrange);
    }
  }
  char first[sizeof(model.waiting_note)];
  copy_text(first, sizeof(first), model.waiting_note);
  char* second = std::strchr(first, '|');
  if (second != nullptr) {
    *second = '\0';
    ++second;
  }
  draw_centered(first, 160, 146, 2, ST77XX_WHITE);
  if (second != nullptr) draw_centered(second, 160, 196, 2, kNeutralGray);
}

void ScreenPainter::draw_setup_layout(const ScreenModel& model) {
  // Large type only, centered under the header; labels in a quiet gray so
  // the values carry the screen. An error band, when set, stacks on top and
  // the content packs a little tighter below it.
  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  canvas_.fillRect(0, 38, kDisplayWidth, 4, kMetsOrange);
  draw_centered("WI-FI SETUP", 160, 10, 2, ST77XX_WHITE);

  const bool banner = model.setup_banner[0] != '\0';
  if (banner) {
    canvas_.fillRect(0, 38, kDisplayWidth, 26, kErrorRed);
    draw_centered(model.setup_banner, 160, 45, 2, ST77XX_WHITE);
  }
  const std::int16_t label1 = banner ? 70 : 59;
  const std::int16_t name = banner ? 90 : 81;
  const std::int16_t label2 = banner ? 122 : 119;
  const std::int16_t key = banner ? 140 : 139;
  const std::int16_t label3 = banner ? 182 : 185;
  const std::int16_t url = banner ? 202 : 207;
  draw_centered("JOIN THIS NETWORK", 160, label1, 2, kNeutralGray);
  draw_centered(model.setup_network, 160, name, 3, ST77XX_WHITE);
  draw_centered("PASSWORD", 160, label2, 2, kNeutralGray);
  draw_centered(model.setup_key, 160, key, 4, kGold);
  draw_centered("THEN OPEN", 160, label3, 2, kNeutralGray);
  draw_centered(model.setup_url, 160, url, 2, ST77XX_WHITE);
}

// The Wi-Fi QR code (WIFI:T:WPA;S:...;P:...;;) at 5 px per module with a
// two-module quiet zone; phones join with one tap from the camera app.
void ScreenPainter::draw_setup_qr_layout(const ScreenModel& model) {
  canvas_.fillScreen(kDarkBlue);
  canvas_.fillRect(0, 0, kDisplayWidth, 42, kMetsBlue);
  canvas_.fillRect(0, 38, kDisplayWidth, 4, kMetsOrange);
  draw_centered("WI-FI SETUP", 160, 10, 2, ST77XX_WHITE);

  const std::int16_t size = model.setup_qr_size;
  if (size > 0 && size <= kSetupQrMaxSize) {
    const std::int16_t module = size <= 29 ? 5 : 4;
    const std::int16_t quiet = 2 * module;
    const std::int16_t side = size * module;
    const std::int16_t left = static_cast<std::int16_t>((kDisplayWidth - side) / 2);
    const std::int16_t top = 46 + quiet;
    canvas_.fillRect(left - quiet, top - quiet, side + 2 * quiet, side + 2 * quiet, ST77XX_WHITE);
    for (std::int16_t y = 0; y < size; ++y) {
      for (std::int16_t x = 0; x < size; ++x) {
        if (model.setup_qr[y * size + x]) canvas_.fillRect(left + x * module, top + y * module, module, module, ST77XX_BLACK);
      }
    }
  }
  draw_centered("SCAN HERE", 160, 218, 2, kNeutralGray);
}

void ScreenPainter::draw(const ScreenModel& model, std::uint8_t rain_frame) {
  switch (model.state) {
    case ScreenState::Info:
      draw_info_layout(model);
      break;
    case ScreenState::Setup:
      draw_setup_layout(model);
      break;
    case ScreenState::SetupQr:
      draw_setup_qr_layout(model);
      break;
    case ScreenState::Game:
      draw_game_layout(model);
      break;
    case ScreenState::Upcoming:
      draw_upcoming_layout(model);
      break;
    case ScreenState::Offseason:
      draw_offseason_layout(model);
      break;
    case ScreenState::GenericDelay:
      draw_delay_layout(model, false, 0);
      break;
    case ScreenState::RainDelay:
      draw_delay_layout(model, true, rain_frame);
      break;
    case ScreenState::Review:
    case ScreenState::Suspended:
    case ScreenState::Postponed:
    case ScreenState::Cancelled:
      draw_state_layout(model, model.state);
      break;
    case ScreenState::Final:
      draw_final_layout(model);
      break;
    case ScreenState::Waiting:
    default:
      draw_waiting_layout(model);
      break;
  }
}

}  // namespace apple::firmware
