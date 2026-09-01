#pragma once

#include "apple/display/display_grid.hpp"

#include <cstddef>
#include <cstdint>

// The text engine behind every celebration: the generated pixel font, the fit
// that sizes words to the grid, the layout, and the library of entrance, hold
// and exit animations the home run and Mets win loops pick from. Mirrors the
// preview pages' shared-anim.js.
namespace apple::display {

enum class Entrance : std::uint8_t { Pop, Slide, Drop, Spin, Type };
enum class Hold : std::uint8_t { Wave, Chant, Glint, Float, Sparkle, Still };
enum class Exit : std::uint8_t { Wipe, Slide, Drop, Spin, Shrink, Twirl };

inline constexpr std::uint8_t kEntranceCount = 5;
inline constexpr std::uint8_t kHoldCount = 6;
inline constexpr std::uint8_t kExitCount = 6;

struct Picks {
  Entrance entrance{Entrance::Pop};
  Hold hold{Hold::Wave};
  Exit exit{Exit::Wipe};
};

// Debug pins for the preview-style controls; -1 keeps the slot random.
struct PickOverride {
  std::int8_t entrance{-1};
  std::int8_t hold{-1};
  std::int8_t exit{-1};
};

const char *entrance_name(Entrance value);
const char *hold_name(Hold value);
const char *exit_name(Exit value);

// The compiled-in font. A locally generated header may substitute a font that is
// licensed for use but not for redistribution; the setup screen credits it.
const char *font_name();
const char *font_license();
bool font_is_private();

// Words laid out as up to three lines with separate whole-number scales for
// width and height. Width picks the largest scale that fits the margins; when
// that is 2 or less the height goes one step taller (a condensed look) so long
// names still fill the screen. Height is bounded too. `tracking` adds pixels
// between letters (at scale 1).
struct TextFit {
  static constexpr int kMaxLines = 3;
  static constexpr std::size_t kMaxLineLength = 32;
  char lines[kMaxLines][kMaxLineLength + 1]{};
  int line_count{1};
  int scale_x{1};
  int scale_y{1};
  int widest_px{0};  // widest line at scale 1, tracking included
  int tracking{0};
};

namespace text {

// Text must stay within these on the 160 x 120 grid (2 px side margins; whole
// scales are coarse, so a tighter margin would halve long names for a few px).
inline constexpr int kMaxLineWidth = 156;
inline constexpr int kMaxBlockHeight = 100;
inline constexpr int kMaxLetters = 32;

// Same generator as the preview pages, so a seed reproduces the same picks.
inline constexpr std::uint32_t lcg(std::uint32_t n) {
  std::uint32_t x = n * 1103515245u + 12345u;
  x = x * 1103515245u + 12345u;
  return x >> 8;
}

int font_band();                                   // glyph height in pixels
int text_width(const char *s, int tracking = 0);   // at scale 1

// Fit fixed words (a headline): two lines, or one when line2 is null or empty.
TextFit fit_words(const char *line1, const char *line2);
// One line at fixed scales (a card block); the line is still trimmed to the margins.
TextFit fit_line(const char *line, int scale_x, int scale_y, int tracking = 0);
// Fit a batter's name: uppercased and normalized, split FIRST / LAST, with a
// third line when a hyphen or space lets the block go up a size.
TextFit fit_name(const char *batter_name);
// Width scale for a pop step: `quarters` of the final scale, at least 1, and
// never past the side margins for the given widest line (the one-tick
// overshoot is dropped rather than clipped).
int pop_scale_for(int quarters, int final_scale, int widest_line_px);
int letters_in(const TextFit &fit);

struct Roles {
  std::uint8_t shadow;
  std::uint8_t glint;
};

struct Layout {
  struct Letter {
    char ch{' '};
    int x{0};
    int y{0};
    int line{0};
    int w{0};
  };
  Letter letters[kMaxLetters]{};
  int count{0};
  int sx{1};
  int sy{1};
  int left{0};
  int right{0};
  int top{0};
  int bottom{0};
};
Layout layout_lines(const TextFit &fit, int sx, int sy, int cx, int cy);

// A pose is what one frame does to the fitted words: scales (0 = the fit's,
// negative = hidden), offsets, per-line / per-letter bobs, letters shown, and
// the continuous transforms the card-flip and twirl use.
struct Pose {
  enum class ColorMode : std::uint8_t { None, Band, Letter };
  int sx{0};
  int sy{0};
  int dx{0};
  int dy{0};
  int line_dy[TextFit::kMaxLines]{0, 0, 0};
  int letter_dy[kMaxLetters]{};
  bool has_letter_dy{false};
  int visible{999};
  float squash{1.f};
  float angle{0.f};
  float factor{1.f};
  bool shadow{false};
  ColorMode color_mode{ColorMode::None};
  float band_c{0.f};
  int band_w{6};
  int highlight_letter{-1};
};

Pose settled_pose();   // the fit's scales, with the shadow
Pose hidden_pose();    // draws nothing

// Entrance poses are indexed by the 14-step pop table; `pop_quarters` is the
// Pop size for this step in quarters of the final (1, 2, 3, 5, 4 ...).
Pose entrance_pose(Entrance e, int step, const TextFit &fit, int n_letters, int pop_quarters);
// Hold styles rest for the first 400 ms so the settle reads before motion;
// `t_ms` counts from the settle step.
void apply_hold_style(Hold h, float t_ms, const Layout &lay, std::uint32_t seed, Pose &p);
// Exit poses over u in [0, 1]; `gone` says the words have left by the end.
Pose exit_pose(Exit e, float u, const TextFit &fit, bool &gone);

// The drop and slide curves, shared with the logo and card animations.
int fall_curve(int step);     // -200 before the start, falling, then two bounces
int slide_in(int step);       // from the left, 3 px overshoot, settled from step 11

// Draw the words in `pose` into a 160 x 120 role buffer, centred on (cx, cy).
void draw_pose(std::uint8_t *buf, const TextFit &fit, std::uint8_t role, const Pose &pose,
               int cx, int cy, Roles roles);

// A filled diamond (|dx| + |dy| <= d), clipped to the grid.
void fill_diamond_at(std::uint8_t *buf, int cx, int cy, int d, std::uint8_t role);

}  // namespace text
}  // namespace apple::display
