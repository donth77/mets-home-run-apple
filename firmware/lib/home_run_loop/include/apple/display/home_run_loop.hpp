#pragma once

#include "apple/display/display_grid.hpp"
#include "apple/display/text_engine.hpp"

#include <cstddef>
#include <cstdint>

// The home run celebration loop for the 320 x 240 panel, rendered on a 160 x 120
// logical grid and doubled. Baked frames cover the flash, ball, diamond and base
// path; the text sequence (rings, entrance, hold, exit, wipe) is drawn live, once
// for the headline and once for the batter's name. Every loop re-rolls the text
// animations from the text engine's library, and the name never repeats the
// headline's.
//
// Hardware independent: no allocation, no Arduino. The caller owns the RGB565
// framebuffer and the clock.
namespace apple::display {

enum class Headline : std::uint8_t { HomeRun, GrandSlam };

struct SequencePicks {
  Picks headline{};
  Picks name{};
};

// RGB565 per role. The preview's "Color roles" panel exports replacements.
struct Colors {
  std::uint16_t background;
  std::uint16_t field;
  std::uint16_t white;
  std::uint16_t seam;
  std::uint16_t shadow;
  std::uint16_t name;
  std::uint16_t glint;
  std::uint16_t flash;
};

Colors default_colors();

class HomeRunLoop {
public:
  static constexpr std::uint16_t kPanelWidth = ::apple::display::kPanelWidth;
  static constexpr std::uint16_t kPanelHeight = ::apple::display::kPanelHeight;
  static constexpr std::uint16_t kLogicalWidth = ::apple::display::kLogicalWidth;
  static constexpr std::uint16_t kLogicalHeight = ::apple::display::kLogicalHeight;
  static constexpr std::size_t kMaxNameLength = TextFit::kMaxLineLength;   // width, not length, governs the fit
  static constexpr int kMaxLineWidth = text::kMaxLineWidth;
  static constexpr int kMaxBlockHeight = text::kMaxBlockHeight;
  // Live sections tick this often between step boundaries (hold motion, exits).
  static constexpr std::uint32_t kLiveTickMs = 25;

  // The text engine's fits, kept here for callers and tests.
  static TextFit fit_name(const char *batter_name) { return text::fit_name(batter_name); }
  static TextFit fit_words(const char *line1, const char *line2) { return text::fit_words(line1, line2); }
  static int pop_scale_for(int quarters, int final_scale, int widest_line_px) {
    return text::pop_scale_for(quarters, final_scale, widest_line_px);
  }

  HomeRunLoop();

  // Start a celebration. The seed (e.g. esp_random()) varies the per-loop
  // animation picks between celebrations.
  void begin(Headline headline, const char *batter_name, std::uint32_t seed);
  void set_override(PickOverride value);

  std::uint32_t loop_ms() const { return loop_ms_; }
  std::uint32_t loop_index(std::uint32_t elapsed_ms) const { return elapsed_ms / loop_ms_; }
  SequencePicks picks_for_loop(std::uint32_t loop) const;

  // Render the frame for elapsed_ms since begin() into a 320 x 240 RGB565 buffer.
  // The whole buffer is written; the result says which part of the panel needs
  // pushing (what changed since the previous render, or everything after
  // begin() / invalidate()).
  DirtyRect render(std::uint32_t elapsed_ms, std::uint16_t *rgb565, const Colors &colors);
  // Forget the previous render, e.g. after the panel showed something else.
  void invalidate() { diff_.invalidate(); }

  // Changes exactly when the picture could: on baked-frame boundaries (the
  // source's own 60/70 ms cadence), on every pop and wipe step, and every
  // kLiveTickMs while text holds or exits. Callers redraw only when this
  // changes instead of on a fixed timer; render() then reports whether
  // anything actually moved.
  std::uint32_t render_key(std::uint32_t elapsed_ms) const;

  // The 160 x 120 role buffer behind the last render (tests, diagnostics).
  const std::uint8_t *logical() const { return logical_; }
  const TextFit &headline() const { return headline_fit_; }
  const TextFit &name() const { return name_; }

  // Timeline, in milliseconds from the start of a loop.
  std::uint32_t baked_ms() const { return baked_ms_; }
  std::uint32_t pop_ms() const { return pop_ms_; }
  std::uint32_t sequence_ms() const { return sequence_ms_; }

private:
  void decode_frame(std::uint8_t frame);
  void draw_sequence(std::uint32_t t, const TextFit &fit, std::uint8_t role,
                     const Picks &picks, std::uint32_t seed, bool with_diamond);
  void draw_big_diamond(std::uint16_t zoom_percent);

  Headline headline_{Headline::HomeRun};
  TextFit headline_fit_{};
  TextFit name_{};
  std::uint32_t seed_{0};
  PickOverride override_{};

  std::uint32_t frame_start_[64]{};
  std::uint32_t baked_ms_{0};
  std::uint32_t pop_ms_{0};
  std::uint32_t settle_ms_{0};
  std::uint32_t sequence_ms_{0};
  std::uint32_t loop_ms_{1};

  std::uint8_t logical_[kLogicalPixels]{};
  FrameDiff diff_;
  bool prev_flash_{false};
  Colors prev_colors_{};
};

}  // namespace apple::display
