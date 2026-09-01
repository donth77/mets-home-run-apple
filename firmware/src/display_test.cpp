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

namespace {

using apple::firmware::kDisplayBacklightPin;
using apple::firmware::kDisplayChipSelectPin;
using apple::firmware::kDisplayDataCommandPin;
using apple::firmware::kDisplayResetPin;
using apple::firmware::team_abbreviation_color;

constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr std::uint32_t kFrameIntervalMs = 50;
constexpr std::uint32_t kAutomaticPageDurationMs = 7'000;
constexpr std::uint32_t kRainFrameDurationMs = 150;
constexpr std::uint8_t kRainFrameCount = 6;
constexpr std::uint8_t kRainOffsets[] = {0, 13, 5, 19, 9, 2, 16};
constexpr std::int16_t kDisplayWidth = 320;
constexpr std::int16_t kDisplayHeight = 240;
constexpr std::int16_t kLiveBasesCenterX = 95;
constexpr std::int16_t kLiveCountCenterX = 225;

// RGB565 approximations of the Mets palette, tuned for this small IPS panel.
constexpr std::uint16_t kMetsBlue = 0x016E;
constexpr std::uint16_t kMetsOrange = 0xFAC2;
constexpr std::uint16_t kDarkBlue = 0x0008;
constexpr std::uint16_t kPanelBlue = 0x08D3;
constexpr std::uint16_t kMutedBlue = 0x5B2E;
constexpr std::uint16_t kFieldGreen = 0x2C86;
constexpr std::uint16_t kGold = 0xFEA0;
constexpr std::uint16_t kDelayYellow = 0xF628;
constexpr std::uint16_t kRainBlue = 0x75DD;

enum class TestPage : std::uint8_t {
  Live = 0,
  Upcoming,
  HomeRun,
  MetsWin,
  ColorBars,
  Offseason,
  GenericDelay,
  RainDelay,
  LiveWrapped,
};

constexpr std::uint8_t kPageCount = 9;

Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin,
                      kDisplayResetPin);
GFXcanvas16 display(kDisplayWidth, kDisplayHeight);

// The home run celebration: baked frames plus the live text sequence, with a
// fresh set of text animations every loop. Demo name until the live feed
// supplies the batter.
apple::display::HomeRunLoop home_run_loop;
apple::display::Headline home_run_kind = apple::display::Headline::HomeRun;
// Demo batters of increasing length, cycled with 'b' to check the name fit on the panel.
constexpr const char* kDemoBatters[] = {"JUAN SOTO", "PETE ALONSO", "BRANDON NIMMO",
                                        "FRANCISCO LINDOR", "JAZZ CHISHOLM JR.",
                                        "CHRISTOPHER ENCARNACION-STRAND"};
constexpr std::size_t kDemoBatterCount = sizeof(kDemoBatters) / sizeof(kDemoBatters[0]);
std::size_t demo_batter_index = 0;
std::uint32_t home_run_logged_loop = 0xFFFFFFFFU;
std::uint32_t home_run_last_key = 0xFFFFFFFFU;
// The Mets win loop on page 4; 'w' cycles demo finals (Mets away/home, one-run, blowout).
apple::display::MetsWinLoop mets_win_loop;
struct DemoFinal {
  const char* away;
  unsigned away_runs;
  const char* home;
  unsigned home_runs;
  bool mets_home;
};
constexpr DemoFinal kDemoFinals[] = {{"NYM", 6, "ATL", 3, false}, {"PHI", 2, "NYM", 4, true},
                                     {"NYM", 12, "MIA", 11, false}, {"WSH", 0, "NYM", 1, true}};
constexpr std::size_t kDemoFinalCount = sizeof(kDemoFinals) / sizeof(kDemoFinals[0]);
std::size_t demo_final_index = 0;
std::uint32_t mets_win_logged_loop = 0xFFFFFFFFU;
std::uint32_t mets_win_last_key = 0xFFFFFFFFU;
// Frame timing per loop: how long the renderer and the SPI push take.
std::uint32_t timing_frames = 0;
std::uint32_t timing_render_us = 0;
std::uint32_t timing_push_us = 0;
std::uint32_t timing_push_max_us = 0;
std::uint32_t timing_pushed_pixels = 0;
// ST7789 is rated to 80 MHz; jumper wiring may want less. 's' cycles these.
constexpr std::uint32_t kSpiSpeedsHz[] = {40'000'000, 80'000'000};  // the S3 cannot clock 60
std::size_t spi_speed_index = 1;

TestPage active_page = TestPage::Live;
bool automatic_cycle = true;
bool colors_inverted = true;  // the Waveshare IPS panel needs INVON; 'i' toggles
bool page_needs_redraw = true;
std::uint8_t display_rotation = 1;
std::uint32_t page_started_ms = 0;

// Tear-free pushes for the home run page (see scan_lock.hpp). 'k' switches the
// scheme off for an A/B look, 'm' flips the refresh direction, '[' and ']' trim
// the line clock.
apple::firmware::ScanLockedPanel scan_lock(panel);
bool scan_lock_enabled = true;

// Bit-bang a register read on the shared DIN line. Tells whether the module
// lets the panel drive DIN back (no buffer in the way); if it did, GSCAN could
// measure the real line rate and the trim would be automatic. Each value is
// read with a pull-up and a pull-down: a floating line follows the pull, a
// driven one does not. (Measured 2026-09-01: it follows the pull; the module
// buffers DIN, so the trim stays manual.)
std::uint32_t bitbang_read(std::uint8_t cmd, int bits, int pull) {
  SPI.end();
  pinMode(SCK, OUTPUT);
  pinMode(MOSI, OUTPUT);
  digitalWrite(SCK, LOW);
  digitalWrite(kDisplayDataCommandPin, LOW);
  digitalWrite(kDisplayChipSelectPin, LOW);
  for (int i = 7; i >= 0; --i) {
    digitalWrite(MOSI, (cmd >> i) & 1);
    delayMicroseconds(1);
    digitalWrite(SCK, HIGH);
    delayMicroseconds(1);
    digitalWrite(SCK, LOW);
  }
  digitalWrite(kDisplayDataCommandPin, HIGH);
  pinMode(MOSI, pull);
  delayMicroseconds(2);
  std::uint32_t v = 0;
  for (int i = 0; i < bits; ++i) {                // one leading dummy clock is included in `bits`
    digitalWrite(SCK, HIGH);
    delayMicroseconds(1);
    v = (v << 1) | (digitalRead(MOSI) ? 1U : 0U);
    digitalWrite(SCK, LOW);
    delayMicroseconds(1);
  }
  digitalWrite(kDisplayChipSelectPin, HIGH);
  pinMode(MOSI, OUTPUT);
  SPI.begin();
  return v;
}

void probe_readback() {
  Serial.printf("PANEL_READ id=%08lx/%08lx status=%08lx/%08lx\n",
                static_cast<unsigned long>(bitbang_read(0x04, 25, INPUT_PULLUP)),
                static_cast<unsigned long>(bitbang_read(0x04, 25, INPUT_PULLDOWN)),
                static_cast<unsigned long>(bitbang_read(0x09, 32, INPUT_PULLUP)),
                static_cast<unsigned long>(bitbang_read(0x09, 32, INPUT_PULLDOWN)));
  const std::uint32_t t0 = micros();
  for (int i = 0; i < 24; ++i) {
    const std::uint32_t t = micros() - t0;
    const std::uint32_t g = bitbang_read(0x45, 25, i % 2 ? INPUT_PULLDOWN : INPUT_PULLUP);
    Serial.printf("GSCAN t_us=%lu raw=%07lx\n", static_cast<unsigned long>(t),
                  static_cast<unsigned long>(g));
    delayMicroseconds(600);
  }
  page_needs_redraw = true;
}
std::uint32_t previous_frame_ms = 0;
std::uint8_t last_rain_frame = 0xFF;

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
  display.fillTriangle(center_x, center_y - radius, center_x + radius, center_y,
                       center_x, center_y + radius,
                       occupied ? color : kDarkBlue);
  display.fillTriangle(center_x, center_y - radius, center_x - radius, center_y,
                       center_x, center_y + radius,
                       occupied ? color : kDarkBlue);
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

void draw_live_layout(bool wrapped_update) {
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, 320, 58, kMetsBlue);
  display.fillRect(0, 54, 320, 4, kMetsOrange);

  set_text(team_abbreviation_color("NYM"), 3);
  display.setCursor(12, 14);
  display.print("NYM");
  set_text(ST77XX_WHITE, 3);
  display.print(" 5");
  set_text(team_abbreviation_color("ATL"), 3);
  display.setCursor(226, 14);
  display.print("ATL");
  set_text(ST77XX_WHITE, 3);
  display.print(" 3");

  draw_centered("TOP 7", 160, 8, 2, ST77XX_WHITE);
  draw_centered("LIVE", 160, 31, 1, kMetsOrange);

  draw_centered("COUNT", kLiveCountCenterX, 72, 1, kMutedBlue);
  draw_centered("2-1", kLiveCountCenterX, 88, 4, kGold);
  draw_base_diamond(kLiveBasesCenterX, 75, 13, true);
  draw_base_diamond(kLiveBasesCenterX + 21, 96, 13, false);
  draw_base_diamond(kLiveBasesCenterX - 21, 96, 13, true);
  draw_out_dots(1);
  draw_centered("OUTS", kLiveBasesCenterX, 139, 1, kMutedBlue);

  display.drawFastHLine(0, 151, 320, kMutedBlue);
  set_text(kMetsOrange, 1);
  display.setCursor(12, 159);
  display.print("BATTING");
  draw_right_aligned("2 FOR 3", 148, 159, 1, kGold);
  draw_fitted_player_name("F. LINDOR", 12, 173, 144);

  set_text(kMetsOrange, 1);
  display.setCursor(172, 159);
  display.print("PITCHING");
  set_text(kGold, 1);
  display.setCursor(278, 159);
  display.print("P:84");
  draw_fitted_player_name("S. STRIDER", 172, 173, 140);

  display.fillRect(0, 199, 320, wrapped_update ? 41 : 21, kPanelBlue);
  set_text(ST77XX_WHITE, 1);
  if (wrapped_update) {
    display.setCursor(7, 203);
    display.print("SOTO HOMERS ON A FLY BALL TO RIGHT FIELD.");
    display.setCursor(7, 224);
    display.print("LINDOR SCORES. ALONSO SCORES...");
  } else {
    display.setCursor(7, 206);
    display.print("LINDOR SINGLES TO RIGHT FIELD");
    display.fillRect(0, 220, 320, 20, kMetsBlue);
    display.setCursor(7, 227);
    display.print("CITI FIELD");
  }
}

void draw_upcoming_layout() {
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, 320, 42, kMetsBlue);
  display.fillRect(0, 38, 320, 4, kMetsOrange);
  draw_centered("NEXT METS GAME", 160, 10, 2, ST77XX_WHITE);

  draw_centered("NYM", 80, 77, 4, kMetsOrange);
  draw_centered("AT", 160, 89, 2, kMutedBlue);
  draw_centered("PHI", 240, 77, 4, ST77XX_WHITE);

  display.drawRoundRect(26, 130, 268, 68, 8, kMutedBlue);
  draw_centered("MON SEP 1", 160, 143, 2, ST77XX_WHITE);
  draw_centered("6:45 PM EDT", 160, 169, 2, kGold);

  display.fillRect(0, 232, 320, 8, kMetsOrange);
}

void draw_offseason_layout() {
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, 320, 42, kMetsBlue);
  display.fillRect(0, 38, 320, 4, kMetsOrange);
  draw_centered("OFFSEASON", 160, 10, 2, ST77XX_WHITE);

  display.fillCircle(145, 79, 21, ST77XX_RED);
  display.fillCircle(174, 79, 21, ST77XX_RED);
  display.fillTriangle(125, 80, 194, 80, 160, 110, ST77XX_RED);
  display.fillRoundRect(160, 48, 4, 19, 2, kGold);
  display.fillTriangle(159, 60, 140, 58, 150, 70, kFieldGreen);
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
  display.fillRect(0, 220, 320, 20, kPanelBlue);
  draw_centered("2027 SEASON", 160, 227, 1, kMetsOrange);
}

void draw_delay_layout(bool rain, std::uint8_t rain_frame = 0) {
  const std::uint16_t accent = rain ? kMutedBlue : kDelayYellow;
  display.fillScreen(kDarkBlue);
  display.fillRect(0, 0, 320, 42, kMetsBlue);
  display.fillRect(0, 38, 320, 4, accent);
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
    draw_centered("WAITING FOR UPDATE", 160, 164, 1, ST77XX_WHITE);
  }
  display.fillRect(0, 220, 320, 20, kPanelBlue);
  draw_centered("WAITING FOR MLB UPDATE", 160, 227, 1, accent);
}

void start_home_run_loop() {
  home_run_loop.begin(home_run_kind, kDemoBatters[demo_batter_index], esp_random());
  const apple::display::TextFit& fit = home_run_loop.name();
  Serial.printf("HOME_RUN_BATTER=%s|%s|%s scale=%dx%d\n", fit.lines[0],
                fit.line_count > 1 ? fit.lines[1] : "", fit.line_count > 2 ? fit.lines[2] : "",
                fit.scale_x, fit.scale_y);
  home_run_logged_loop = 0xFFFFFFFFU;
}

apple::display::DirtyRect draw_home_run_animation(std::uint32_t elapsed_ms) {
  const std::uint32_t loop_index = home_run_loop.loop_index(elapsed_ms);
  if (loop_index != home_run_logged_loop) {
    if (timing_frames > 0) {
      Serial.printf("HOME_RUN_TIMING frames=%lu render_avg_us=%lu push_avg_us=%lu push_max_us=%lu pushed_pct=%lu spi_mhz=%lu mode=%s line_ns=%lu\n",
                    static_cast<unsigned long>(timing_frames),
                    static_cast<unsigned long>(timing_render_us / timing_frames),
                    static_cast<unsigned long>(timing_push_us / timing_frames),
                    static_cast<unsigned long>(timing_push_max_us),
                    static_cast<unsigned long>(
                        (static_cast<std::uint64_t>(timing_pushed_pixels) * 100U) /
                        (static_cast<std::uint64_t>(timing_frames) * kDisplayWidth * kDisplayHeight)),
                    static_cast<unsigned long>(kSpiSpeedsHz[spi_speed_index] / 1'000'000U),
                    scan_lock.active() ? "scanlock" : "plain",
                    static_cast<unsigned long>(scan_lock.line_ns()));
    }
    timing_frames = timing_render_us = timing_push_us = timing_push_max_us = timing_pushed_pixels = 0;
    home_run_logged_loop = loop_index;
    const apple::display::SequencePicks picks =
        home_run_loop.picks_for_loop(loop_index);
    Serial.printf("HOME_RUN_LOOP=%lu headline=%s/%s/%s name=%s/%s/%s\n",
                  static_cast<unsigned long>(loop_index + 1),
                  apple::display::entrance_name(picks.headline.entrance),
                  apple::display::hold_name(picks.headline.hold),
                  apple::display::exit_name(picks.headline.exit),
                  apple::display::entrance_name(picks.name.entrance),
                  apple::display::hold_name(picks.name.hold),
                  apple::display::exit_name(picks.name.exit));
  }
  const std::uint32_t started_us = micros();
  const apple::display::DirtyRect dirty = home_run_loop.render(
      elapsed_ms, display.getBuffer(), apple::display::default_colors());
  timing_render_us += micros() - started_us;
  return dirty;
}

// Push only the part of the canvas the renderer says changed. Frames that changed
// nothing cost no SPI time, and small changes (text motion) take a fraction of a
// full frame, which is what keeps the picture smooth on a panel with no tearing
// sync pin.
void push_canvas_rect(const apple::display::DirtyRect& rect) {
  if (rect.empty()) {
    return;
  }
  const std::uint16_t* src = display.getBuffer() + rect.y * kDisplayWidth + rect.x;
  panel.startWrite();
  panel.setAddrWindow(rect.x, rect.y, rect.w, rect.h);
  if (rect.w == kDisplayWidth) {
    panel.writePixels(const_cast<std::uint16_t*>(src),
                      static_cast<std::uint32_t>(rect.w) * rect.h);
  } else {
    for (int row = 0; row < rect.h; ++row, src += kDisplayWidth) {
      panel.writePixels(const_cast<std::uint16_t*>(src), rect.w);
    }
  }
  panel.endWrite();
}

// Push a home run frame and account for the time it takes.
void push_home_run_frame(const apple::display::DirtyRect& dirty) {
  const std::uint32_t started_us = micros();
  if (scan_lock.active()) {
    scan_lock.push(display.getBuffer(), kDisplayWidth, dirty);
  } else {
    push_canvas_rect(dirty);
  }
  const std::uint32_t took_us = micros() - started_us;
  timing_push_us += took_us;
  timing_push_max_us = std::max(timing_push_max_us, took_us);
  timing_pushed_pixels += dirty.empty() ? 0U : static_cast<std::uint32_t>(dirty.w) * dirty.h;
  ++timing_frames;
}

void apply_spi_speed() {
  panel.setSPISpeed(kSpiSpeedsHz[spi_speed_index]);
  Serial.printf("DISPLAY_SPI_MHZ=%lu\n",
                static_cast<unsigned long>(kSpiSpeedsHz[spi_speed_index] / 1'000'000U));
}

void start_mets_win_loop() {
  const DemoFinal& f = kDemoFinals[demo_final_index];
  mets_win_loop.begin(f.away, f.away_runs, f.home, f.home_runs, f.mets_home, esp_random());
  Serial.printf("MW_FINAL=%s %u|%s %u mets_home=%d\n", mets_win_loop.away(), mets_win_loop.away_runs(),
                mets_win_loop.home(), mets_win_loop.home_runs(), mets_win_loop.mets_home() ? 1 : 0);
  mets_win_logged_loop = 0xFFFFFFFFU;
}

apple::display::DirtyRect draw_mets_win_animation(std::uint32_t elapsed_ms) {
  const std::uint32_t loop_index = mets_win_loop.loop_index(elapsed_ms);
  if (loop_index != mets_win_logged_loop) {
    if (timing_frames > 0) {
      Serial.printf("MW_TIMING frames=%lu render_avg_us=%lu push_avg_us=%lu push_max_us=%lu pushed_pct=%lu\n",
                    static_cast<unsigned long>(timing_frames),
                    static_cast<unsigned long>(timing_render_us / timing_frames),
                    static_cast<unsigned long>(timing_push_us / timing_frames),
                    static_cast<unsigned long>(timing_push_max_us),
                    static_cast<unsigned long>(
                        (static_cast<std::uint64_t>(timing_pushed_pixels) * 100U) /
                        (static_cast<std::uint64_t>(timing_frames) * kDisplayWidth * kDisplayHeight)));
    }
    timing_frames = timing_render_us = timing_push_us = timing_push_max_us = timing_pushed_pixels = 0;
    mets_win_logged_loop = loop_index;
    const apple::display::MetsWinPicks picks = mets_win_loop.picks_for_loop(loop_index);
    Serial.printf("MW_LOOP=%lu logo=%s/%s/%s words=%s/%s/%s card=%s/%s\n",
                  static_cast<unsigned long>(loop_index + 1),
                  apple::display::logo_entrance_name(picks.logo.entrance),
                  apple::display::logo_hold_name(picks.logo.hold),
                  apple::display::logo_exit_name(picks.logo.exit),
                  apple::display::entrance_name(picks.text.entrance),
                  apple::display::hold_name(picks.text.hold),
                  apple::display::exit_name(picks.text.exit),
                  apple::display::card_entrance_name(picks.card.entrance),
                  apple::display::card_exit_name(picks.card.exit));
  }
  const std::uint32_t started_us = micros();
  const apple::display::DirtyRect dirty = mets_win_loop.render(
      elapsed_ms, display.getBuffer(), apple::display::default_mets_win_colors());
  timing_render_us += micros() - started_us;
  return dirty;
}

void draw_color_bars() {
  constexpr std::uint16_t colors[] = {
      ST77XX_RED,     ST77XX_GREEN, ST77XX_BLUE,  ST77XX_CYAN,
      ST77XX_MAGENTA, ST77XX_YELLOW, ST77XX_WHITE, ST77XX_BLACK,
  };
  constexpr std::int16_t bar_width = 40;
  for (std::uint8_t index = 0; index < 8; ++index) {
    display.fillRect(static_cast<std::int16_t>(index) * bar_width, 0, bar_width,
                     180, colors[index]);
  }
  display.fillRect(0, 180, 320, 60, kDarkBlue);
  draw_centered("COLOR + EDGE TEST", 160, 193, 2, ST77XX_WHITE);
  draw_centered("320 x 240  ST7789", 160, 220, 1, kMetsOrange);
  display.drawRect(0, 0, 320, 240, ST77XX_WHITE);
}

const char* page_name(TestPage page) {
  switch (page) {
    case TestPage::Live:
      return "LIVE_SCOREBOARD";
    case TestPage::Upcoming:
      return "UPCOMING_GAME";
    case TestPage::HomeRun:
      return "HOME_RUN_ANIMATION";
    case TestPage::MetsWin:
      return "METS_WIN_ANIMATION";
    case TestPage::ColorBars:
      return "COLOR_BARS";
    case TestPage::Offseason:
      return "OFFSEASON";
    case TestPage::GenericDelay:
      return "GENERIC_DELAY";
    case TestPage::RainDelay:
      return "RAIN_DELAY";
    case TestPage::LiveWrapped:
      return "LIVE_WRAPPED_UPDATE";
    default:
      return "UNKNOWN";
  }
}

void select_page(TestPage page, std::uint32_t now_ms) {
  active_page = page;
  page_started_ms = now_ms;
  page_needs_redraw = true;
  last_rain_frame = 0xFF;
  if (page == TestPage::HomeRun) {
    start_home_run_loop();
    home_run_last_key = 0xFFFFFFFFU;
  }
  if (page == TestPage::MetsWin) {
    start_mets_win_loop();
    mets_win_last_key = 0xFFFFFFFFU;
  }
  if ((page == TestPage::HomeRun || page == TestPage::MetsWin) && scan_lock_enabled) {
    scan_lock.enter(display_rotation);
  } else {
    scan_lock.leave();
  }
  Serial.printf("DISPLAY_PAGE=%s\n", page_name(page));
}

void select_page_number(std::uint8_t page_number, std::uint32_t now_ms) {
  if (page_number >= kPageCount) {
    return;
  }
  automatic_cycle = false;
  select_page(static_cast<TestPage>(page_number), now_ms);
}

void print_commands() {
  Serial.println("DISPLAY_COMMANDS=1:live,2:upcoming,3:home_run,4:win,5:colors");
  Serial.println("DISPLAY_COMMANDS=6:offseason,7:delay,8:rain_delay");
  Serial.println("DISPLAY_COMMANDS=9:live_wrapped_update");
  Serial.println("DISPLAY_COMMANDS=a:auto,n:next,i:invert,r:rotate,h:help");
  Serial.println("DISPLAY_COMMANDS=g:toggle_grand_slam,b:next_demo_batter,w:next_demo_final,s:spi_speed");
  Serial.println("DISPLAY_COMMANDS=k:scan_lock,m:refresh_dir,[/]:line_time,q:readback_probe");
}

void service_serial(std::uint32_t now_ms) {
  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    switch (command) {
      case '1':
        select_page_number(0, now_ms);
        break;
      case '2':
        select_page_number(1, now_ms);
        break;
      case '3':
        select_page_number(2, now_ms);
        break;
      case '4':
        select_page_number(3, now_ms);
        break;
      case '5':
        select_page_number(4, now_ms);
        break;
      case '6':
        select_page_number(5, now_ms);
        break;
      case '7':
        select_page_number(6, now_ms);
        break;
      case '8':
        select_page_number(7, now_ms);
        break;
      case '9':
        select_page_number(8, now_ms);
        break;
      case 'g':
        home_run_kind = home_run_kind == apple::display::Headline::HomeRun
                            ? apple::display::Headline::GrandSlam
                            : apple::display::Headline::HomeRun;
        Serial.printf("HOME_RUN_KIND=%s\n",
                      home_run_kind == apple::display::Headline::GrandSlam
                          ? "GRAND_SLAM"
                          : "HOME_RUN");
        select_page_number(2, now_ms);
        break;
      case 'b':
        demo_batter_index = (demo_batter_index + 1) % kDemoBatterCount;
        select_page_number(2, now_ms);
        break;
      case 'w':
        demo_final_index = (demo_final_index + 1) % kDemoFinalCount;
        select_page_number(3, now_ms);
        break;
      case 's':
        spi_speed_index = (spi_speed_index + 1) % (sizeof(kSpiSpeedsHz) / sizeof(kSpiSpeedsHz[0]));
        apply_spi_speed();
        page_needs_redraw = true;
        break;
      case 'k':
        scan_lock_enabled = !scan_lock_enabled;
        if (active_page == TestPage::HomeRun || active_page == TestPage::MetsWin) {
          if (scan_lock_enabled) {
            scan_lock.enter(display_rotation);
          } else {
            scan_lock.leave();
          }
        }
        page_needs_redraw = true;
        Serial.printf("SCAN_LOCK_ENABLED=%d\n", scan_lock_enabled ? 1 : 0);
        break;
      case 'm':
        scan_lock.set_flip_refresh(!scan_lock.flip_refresh());
        page_needs_redraw = true;
        Serial.printf("SCAN_LOCK_ML=%d\n", scan_lock.flip_refresh() ? 1 : 0);
        break;
      case '[':
      case ']':
        scan_lock.set_line_ns(scan_lock.line_ns() + (command == ']' ? 200U : static_cast<std::uint32_t>(-200)));
        Serial.printf("SCAN_LINE_NS=%lu\n", static_cast<unsigned long>(scan_lock.line_ns()));
        break;
      case 'q':
        probe_readback();
        break;
      case 'a':
      case 'A':
        automatic_cycle = true;
        select_page(TestPage::Live, now_ms);
        Serial.println("DISPLAY_AUTO=ON");
        break;
      case 'n':
      case 'N': {
        automatic_cycle = false;
        const std::uint8_t next =
            (static_cast<std::uint8_t>(active_page) + 1U) % kPageCount;
        select_page(static_cast<TestPage>(next), now_ms);
        break;
      }
      case 'i':
      case 'I':
        colors_inverted = !colors_inverted;
        panel.invertDisplay(colors_inverted);
        page_needs_redraw = true;
        Serial.printf("DISPLAY_INVERTED=%s\n", colors_inverted ? "YES" : "NO");
        break;
      case 'r':
      case 'R': {
        const bool relock = scan_lock.active();
        scan_lock.leave();
        display_rotation = (display_rotation == 1) ? 3 : 1;
        panel.setRotation(display_rotation);
        if (relock) {
          scan_lock.enter(display_rotation);
        }
        page_needs_redraw = true;
        Serial.printf("DISPLAY_ROTATION=%u\n", display_rotation);
        break;
      }
      case 'h':
      case 'H':
      case '?':
        print_commands();
        break;
      default:
        break;
    }
  }
}

void render_active_page(std::uint32_t now_ms) {
  const std::uint32_t elapsed_ms = now_ms - page_started_ms;
  const std::uint8_t rain_frame = static_cast<std::uint8_t>(
      (elapsed_ms / kRainFrameDurationMs) % kRainFrameCount);
  const bool is_animated = active_page == TestPage::HomeRun ||
                           active_page == TestPage::MetsWin ||
                           active_page == TestPage::RainDelay;
  if (active_page == TestPage::RainDelay && !page_needs_redraw &&
      rain_frame == last_rain_frame) {
    return;
  }
  if (!is_animated && !page_needs_redraw) {
    return;
  }

  switch (active_page) {
    case TestPage::Live:
      draw_live_layout(false);
      break;
    case TestPage::Upcoming:
      draw_upcoming_layout();
      break;
    case TestPage::HomeRun:
      draw_home_run_animation(elapsed_ms);
      break;
    case TestPage::MetsWin:
      draw_mets_win_animation(elapsed_ms);
      break;
    case TestPage::ColorBars:
      draw_color_bars();
      break;
    case TestPage::Offseason:
      draw_offseason_layout();
      break;
    case TestPage::GenericDelay:
      draw_delay_layout(false);
      break;
    case TestPage::RainDelay:
      draw_delay_layout(true, rain_frame);
      last_rain_frame = rain_frame;
      break;
    case TestPage::LiveWrapped:
      draw_live_layout(true);
      break;
  }

  panel.drawRGBBitmap(0, 0, display.getBuffer(), kDisplayWidth,
                      kDisplayHeight);
  page_needs_redraw = false;
}

}  // namespace

void setup() {
  // Display testing must remain mechanically inert.
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
  apply_spi_speed();
  panel.setRotation(display_rotation);
  panel.invertDisplay(colors_inverted);
  panel.fillScreen(kDarkBlue);

  display.fillScreen(kDarkBlue);
  draw_centered("HOME RUN APPLE", 160, 74, 3, ST77XX_WHITE);
  draw_centered("DISPLAY LAB", 160, 112, 2, kMetsOrange);
  draw_centered("USB POWER / MOTOR DISARMED", 160, 151, 1, kMutedBlue);
  display.drawRoundRect(28, 57, 264, 124, 10, kMetsOrange);
  {
    char credit[64];
    snprintf(credit, sizeof(credit), "FONT: %s%s", apple::display::font_name(),
             apple::display::font_is_private() ? " BY SOMEPX" : " (CC0)");
    for (char *c = credit; *c != '\0'; ++c) {
      *c = static_cast<char>(toupper(static_cast<unsigned char>(*c)));
    }
    draw_centered(credit, 160, 196, 1, kMutedBlue);
  }
  panel.drawRGBBitmap(0, 0, display.getBuffer(), kDisplayWidth,
                      kDisplayHeight);
  digitalWrite(kDisplayBacklightPin, HIGH);

  Serial.println();
  Serial.println("DISPLAY_TEST=READY");
  Serial.println("DISPLAY_CONTROLLER=ST7789");
  Serial.println("DISPLAY_SIZE=320x240_LANDSCAPE");
  Serial.println("MOTION_OUTPUTS=LOW");
  Serial.printf("DISPLAY_FONT=%s (%s)\n", apple::display::font_name(),
                apple::display::font_license());
  print_commands();

  delay(1'500);
  page_started_ms = millis();
  page_needs_redraw = true;
}

void loop() {
  apple::firmware::disarm_motion_outputs();

  const std::uint32_t now_ms = millis();
  service_serial(now_ms);

  const std::uint32_t page_duration_ms =
      active_page == TestPage::HomeRun ? 2U * home_run_loop.loop_ms()
      : active_page == TestPage::MetsWin ? 2U * mets_win_loop.loop_ms()
                                         : kAutomaticPageDurationMs;
  if (automatic_cycle && now_ms - page_started_ms >= page_duration_ms) {
    const std::uint8_t next =
        (static_cast<std::uint8_t>(active_page) + 1U) % kPageCount;
    select_page(static_cast<TestPage>(next), now_ms);
  }

  if (active_page == TestPage::HomeRun || active_page == TestPage::MetsWin) {
    // Both celebration pages redraw on their render keys and push only what changed.
    const bool win = active_page == TestPage::MetsWin;
    const std::uint32_t elapsed_ms = now_ms - page_started_ms;
    const std::uint32_t key = win ? mets_win_loop.render_key(elapsed_ms) : home_run_loop.render_key(elapsed_ms);
    std::uint32_t& last_key = win ? mets_win_last_key : home_run_last_key;
    if (key != last_key) {
      last_key = key;
      if (page_needs_redraw) {         // the panel shows something else: push it all
        home_run_loop.invalidate();
        mets_win_loop.invalidate();
      }
      push_home_run_frame(win ? draw_mets_win_animation(elapsed_ms) : draw_home_run_animation(elapsed_ms));
      page_needs_redraw = false;
    }
  } else if (now_ms - previous_frame_ms >= kFrameIntervalMs) {
    previous_frame_ms = now_ms;
    render_active_page(now_ms);
  }

  delay(1);
}
