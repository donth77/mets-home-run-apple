#pragma once

// Scoreboard and status screens for the 320 x 240 ST7789 panel, drawn into a
// GFXcanvas16 so the USB live-display bridge and the autonomous target share
// one layout. The celebration animations live in lib/home_run_loop.

#include <Adafruit_GFX.h>

#include <cstddef>
#include <cstdint>

namespace apple::firmware {

constexpr std::int16_t kDisplayWidth = 320;
constexpr std::int16_t kDisplayHeight = 240;
constexpr std::int16_t kLiveBasesCenterX = 95;
constexpr std::int16_t kLiveCountCenterX = 225;
constexpr std::uint16_t kLivePlayerNameWidth = 144;
constexpr std::size_t kEventCharactersPerLine = 51;
constexpr std::uint8_t kRainOffsets[] = {0, 13, 5, 19, 9, 2, 16};
constexpr std::uint16_t kMetsBlue = 0x016E;    // #002D72
constexpr std::uint16_t kMetsOrange = 0xFAC2;  // #FF5910
constexpr std::uint16_t kDarkBlue = 0x0043;    // #00081F
constexpr std::uint16_t kPanelBlue = 0x08E7;   // #0B1C3D
constexpr std::uint16_t kMutedBlue = 0x5BB2;   // #587493
constexpr std::uint16_t kNeutralGray = 0xADB8;  // #AAB4C1, readable labels
constexpr std::uint16_t kErrorRed = 0xC8E3;     // #C81E1E, error bands
constexpr std::uint16_t kInterruptionRed = 0xD228;  // #D64545
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
  Setup,
  Info,  // one short press of the owner button: the Manager's address
  SetupQr,
};

constexpr std::uint8_t kSetupQrMaxSize = 33;  // QR versions up to 4

struct GameScreen {
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

struct UpcomingScreen {
  std::uint8_t game_number = 1;
  char away[5] = "NYM";
  char home[5] = "---";
  char date[16] = "DATE TBD";
  char time[13] = "TIME TBD";
  char timezone[9] = "LOCAL";
  char venue[31] = "";
};

struct FinalScreen {
  char away[5] = "NYM";
  char home[5] = "---";
  std::uint16_t away_score = 0;
  std::uint16_t home_score = 0;
  char result[12] = "";
  char venue[31] = "";
};

enum class WaitingIcon : std::uint8_t { None, Alert, Update, Wifi, WifiLost, Clock };

/// Everything the painter needs; owners mutate it and ask for a redraw.
struct ScreenModel {
  ScreenState state = ScreenState::Waiting;
  GameScreen game;
  UpcomingScreen upcoming;
  FinalScreen final_game;
  char offseason_season[24] = "NEXT SEASON";
  char delay_detail[40] = "WAITING FOR UPDATE";
  char state_detail[40] = "WAITING FOR UPDATE";
  char waiting_title[24] = "HOME RUN APPLE";
  char status_message[80] = "STARTING";
  // Colour of the big status line on the waiting screen. White for nearly
  // everything; the info screen paints the address in orange so it is the
  // one thing the eye lands on.
  std::uint16_t status_color{0xFFFF};
  char waiting_note[48] = "MOTION OUTPUTS DISARMED";
  std::uint16_t waiting_accent = 0xFAC2;  // header rule and card border: orange, yellow, or red
  WaitingIcon waiting_icon = WaitingIcon::None;
  char waiting_footer[40] = "Waiting for game data";
  char setup_network[24] = "";
  char setup_key[12] = "";
  char setup_url[32] = "";
  char setup_banner[32] = "";  // red error band under the header when set
  std::uint8_t setup_qr_size = 0;  // modules per side; 0 hides the QR screen
  std::uint8_t setup_qr[kSetupQrMaxSize * kSetupQrMaxSize] = {};  // 1 = dark module
};

void copy_text(char* destination, std::size_t capacity, const char* source);
void copy_text_span(char* destination, std::size_t capacity, const char* source,
                    std::size_t length);
bool wrap_event_text(const char* source,
                     char (&first_line)[kEventCharactersPerLine + 1],
                     char (&second_line)[kEventCharactersPerLine + 1]);

class ScreenPainter {
 public:
  explicit ScreenPainter(GFXcanvas16& canvas) : canvas_(canvas) {}

  /// Draws the model's current screen into the canvas. `rain_frame` animates
  /// the rain-delay screen and is ignored elsewhere.
  void draw(const ScreenModel& model, std::uint8_t rain_frame = 0);

 private:
  void set_text(std::uint16_t color, std::uint8_t size);
  void draw_centered(const char* text, std::int16_t center_x, std::int16_t y,
                     std::uint8_t size, std::uint16_t color);
  void draw_right_aligned(const char* text, std::int16_t right_x,
                          std::int16_t y, std::uint8_t size,
                          std::uint16_t color);
  void draw_fitted_player_name(const char* text, std::int16_t left_x,
                               std::int16_t top_y, std::uint16_t max_width);
  void draw_interruption_score(const GameScreen& game);
  void draw_base_diamond(std::int16_t center_x, std::int16_t center_y,
                         std::int16_t radius, bool occupied);
  void draw_out_dots(std::uint8_t outs);
  void draw_waiting_layout(const ScreenModel& model);
  void draw_upcoming_layout(const ScreenModel& model);
  void draw_offseason_layout(const ScreenModel& model);
  void draw_delay_layout(const ScreenModel& model, bool rain,
                         std::uint8_t rain_frame);
  void draw_state_layout(const ScreenModel& model, ScreenState state);
  void draw_final_layout(const ScreenModel& model);
  void draw_game_layout(const ScreenModel& model);
  void draw_info_layout(const ScreenModel& model);
  void draw_setup_layout(const ScreenModel& model);
  void draw_setup_qr_layout(const ScreenModel& model);
  void draw_waiting_icon(WaitingIcon icon, std::uint16_t accent, std::int16_t top);

  GFXcanvas16& canvas_;
};

}  // namespace apple::firmware
