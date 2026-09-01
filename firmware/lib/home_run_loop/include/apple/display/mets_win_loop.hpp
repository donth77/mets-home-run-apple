#pragma once

#include "apple/display/display_grid.hpp"
#include "apple/display/text_engine.hpp"

#include <cstddef>
#include <cstdint>

// The Mets win celebration loop: the roundel and fireworks, METS WIN! on its
// own, then the final card, re-rolled every pass from small libraries the way
// the home run loop re-rolls its text. Same 160 x 120 role grid; everything is
// drawn live (the roundel is a generated sprite). Mirrors the mets-win-preview
// page.
namespace apple::display {

enum class LogoEntrance : std::uint8_t { Flash, Drop, Spin, Slide };
enum class LogoHold : std::uint8_t { Still, Float, Glint };
enum class LogoExit : std::uint8_t { Flash, Shrink, Drop, Wipe };
enum class CardEntrance : std::uint8_t { Pop, Slide, Drop };
enum class CardExit : std::uint8_t { Slide, Drop, Shrink };

inline constexpr std::uint8_t kLogoEntranceCount = 4;
inline constexpr std::uint8_t kLogoHoldCount = 3;
inline constexpr std::uint8_t kLogoExitCount = 4;
inline constexpr std::uint8_t kCardEntranceCount = 3;
inline constexpr std::uint8_t kCardExitCount = 3;

const char *logo_entrance_name(LogoEntrance value);
const char *logo_hold_name(LogoHold value);
const char *logo_exit_name(LogoExit value);
const char *card_entrance_name(CardEntrance value);
const char *card_exit_name(CardExit value);

struct LogoPicks {
  LogoEntrance entrance{LogoEntrance::Flash};
  LogoHold hold{LogoHold::Still};
  LogoExit exit{LogoExit::Flash};
};

struct CardPicks {
  CardEntrance entrance{CardEntrance::Pop};
  CardExit exit{CardExit::Slide};
};

struct MetsWinPicks {
  LogoPicks logo{};
  Picks text{};
  CardPicks card{};
};

// Debug pins for the preview-style controls; -1 keeps the slot random.
struct MetsWinOverride {
  std::int8_t logo_entrance{-1};
  std::int8_t logo_hold{-1};
  std::int8_t logo_exit{-1};
  std::int8_t text_entrance{-1};
  std::int8_t text_hold{-1};
  std::int8_t text_exit{-1};
  std::int8_t card_entrance{-1};
  std::int8_t card_exit{-1};
};

// RGB565 per role, in role order. The preview's "Color roles" panel exports replacements.
struct MetsWinColors {
  std::uint16_t sky;
  std::uint16_t win_field;
  std::uint16_t white;
  std::uint16_t logo_blue;
  std::uint16_t logo_orange;
  std::uint16_t shadow;
  std::uint16_t glint;
  std::uint16_t flash;
  std::uint16_t spark_white;
  std::uint16_t spark_orange;
  std::uint16_t spark_gold;
  std::uint16_t spark_blue;
  std::uint16_t spark_fade;
  std::uint16_t final_label;
};

MetsWinColors default_mets_win_colors();

class MetsWinLoop {
public:
  static constexpr std::size_t kTeamLength = 3;      // MLB abbreviations
  static constexpr unsigned kMaxRuns = 99;
  static constexpr std::uint32_t kLiveTickMs = 25;
  static constexpr int kLogoWidth = 110;
  static constexpr int kLogoHeight = 110;
  // Timeline, in milliseconds from the start of a loop.
  static constexpr std::uint32_t kLogoHoldEndMs = 4600;
  static constexpr std::uint32_t kLogoEndMs = 5000;
  static constexpr std::uint32_t kTextHoldMs = 2000;
  static constexpr std::uint32_t kTextExitMs = 400;
  static constexpr std::uint32_t kCardHoldMs = 3200;
  static constexpr std::uint32_t kCardExitMs = 400;
  static constexpr std::uint32_t kCardTailMs = 200;

  // Implementation types, defined in the .cpp; public so file-local helpers can use them.
  struct LogoPose;
  struct CardBlock;

  // The scoreboard's shared scale for two lines like "NYM 6" / "ATL 3".
  static int score_scale(const char *away, unsigned away_runs, const char *home, unsigned home_runs);

  MetsWinLoop();

  // Start a celebration with the final line in scoreboard order (away, home).
  // `mets_home` picks which line is the Mets'. The seed varies the picks.
  void begin(const char *away, unsigned away_runs, const char *home, unsigned home_runs,
             bool mets_home, std::uint32_t seed);
  void set_override(MetsWinOverride value);
  void set_fireworks(bool on) { fireworks_ = on; }

  std::uint32_t loop_ms() const { return loop_ms_; }
  std::uint32_t logo_ms() const { return kLogoEndMs; }
  std::uint32_t text_ms() const { return text_ms_; }
  std::uint32_t card_ms() const { return card_ms_; }
  std::uint32_t loop_index(std::uint32_t elapsed_ms) const { return elapsed_ms / loop_ms_; }
  MetsWinPicks picks_for_loop(std::uint32_t loop) const;

  // Render the frame for elapsed_ms since begin() into a 320 x 240 RGB565 buffer;
  // the result is what changed since the previous render (see HomeRunLoop).
  DirtyRect render(std::uint32_t elapsed_ms, std::uint16_t *rgb565, const MetsWinColors &colors);
  void invalidate() { diff_.invalidate(); }
  // Changes every live tick and on every entrance step boundary.
  std::uint32_t render_key(std::uint32_t elapsed_ms) const;

  const std::uint8_t *logical() const { return logical_; }
  // The decoded roundel: 110 x 110 roles (0 clear, 1 blue, 2 white, 3 orange).
  const std::uint8_t *logo() const { return logo_; }
  const char *away() const { return away_; }
  const char *home() const { return home_; }
  unsigned away_runs() const { return away_runs_; }
  unsigned home_runs() const { return home_runs_; }
  bool mets_home() const { return mets_home_; }

private:
  void decode_logo();
  void draw_logo(const LogoPose &pose);
  void draw_fireworks(int t_ms, std::uint32_t base, int period_ticks, int spread_ticks, int max_rockets);
  void draw_logo_beat(std::uint32_t t, const LogoPicks &picks, std::uint32_t seed);
  void draw_text_beat(std::uint32_t t, const Picks &picks, std::uint32_t seed);
  void draw_card_beat(std::uint32_t t, const CardPicks &picks, std::uint32_t seed);
  void build_card(CardBlock blocks[4]) const;
  int step_at(std::uint32_t t) const;

  char away_[kTeamLength + 1] = "NYM";
  char home_[kTeamLength + 1] = "OPP";
  unsigned away_runs_{0};
  unsigned home_runs_{0};
  bool mets_home_{false};
  bool fireworks_{true};
  std::uint32_t seed_{0};
  MetsWinOverride override_{};
  TextFit words_fit_{};

  std::uint32_t pop_ms_{0};
  std::uint32_t settle_ms_{0};
  std::uint32_t wipe_ms_{0};
  std::uint32_t text_ms_{0};
  std::uint32_t card_ms_{0};
  std::uint32_t loop_ms_{1};

  std::uint8_t logo_[kLogoWidth * kLogoHeight]{};
  std::uint8_t logical_[kLogicalPixels]{};
  FrameDiff diff_;
  MetsWinColors prev_colors_{};
};

}  // namespace apple::display
