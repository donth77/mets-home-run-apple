#include "apple/core/types.hpp"
#include "apple/display/home_run_loop.hpp"
#include "apple/display/mets_win_loop.hpp"
#include "apple/firmware/board_pins.hpp"
#include "apple/firmware/screens.hpp"
#include "apple/firmware/scan_lock.hpp"

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

using apple::firmware::FinalScreen;
using apple::firmware::GameScreen;
using apple::firmware::ScreenModel;
using apple::firmware::ScreenPainter;
using apple::firmware::ScreenState;
using apple::firmware::UpcomingScreen;
using apple::firmware::copy_text;
using apple::firmware::kDarkBlue;
using apple::firmware::kDisplayHeight;
using apple::firmware::kDisplayWidth;

constexpr std::size_t kSerialLineCapacity = 512;
constexpr std::size_t kExpectedGameFieldCount = 18;
constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr std::uint32_t kRainFrameDurationMs = 150;
constexpr std::uint8_t kRainFrameCount = 6;
// A celebration is shown for the core's lead-in plus the raised dwell, then the
// scoreboard returns. Motion stays disarmed in this prototype target.
constexpr std::uint32_t kCelebrationDisplayMs = static_cast<std::uint32_t>(
    apple::core::kCelebrationLeadInMs + apple::core::kRaisedDwellMs);


Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin,
                      kDisplayResetPin);
GFXcanvas16 display(kDisplayWidth, kDisplayHeight);
// Celebration frames go to the panel tear-free (see scan_lock.hpp); the
// scoreboard keeps the ordinary full-canvas pushes.
apple::firmware::ScanLockedPanel scan_lock(panel);
ScreenModel model;
ScreenPainter painter(display);
GameScreen& game = model.game;
UpcomingScreen& upcoming = model.upcoming;
FinalScreen& final_game = model.final_game;
ScreenState& screen_state = model.state;
char (&offseason_season)[24] = model.offseason_season;
char (&delay_detail)[40] = model.delay_detail;
char (&state_detail)[40] = model.state_detail;

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
char (&status_message)[80] = model.status_message;
bool needs_redraw = true;
std::uint8_t last_rain_frame = 0xFF;

std::uint16_t parse_u16(const char* value) {
  return static_cast<std::uint16_t>(
      std::min<unsigned long>(std::strtoul(value, nullptr, 10), 65'535UL));
}

std::uint8_t parse_u8(const char* value, std::uint8_t maximum) {
  return static_cast<std::uint8_t>(
      std::min<unsigned long>(std::strtoul(value, nullptr, 10), maximum));
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
  painter.draw(model, rain_frame);
  if (screen_state == ScreenState::RainDelay) {
    last_rain_frame = rain_frame;
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

  copy_text(model.waiting_title, sizeof(model.waiting_title), "USB LIVE DISPLAY");
  copy_text(model.status_message, sizeof(model.status_message),
            "CONNECTING TO USB LIVE BRIDGE");
  copy_text(model.waiting_footer, sizeof(model.waiting_footer),
            "Waiting for the host feed");

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
