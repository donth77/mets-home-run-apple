#include "apple/display/mets_win_loop.hpp"

#include "apple/display/generated/home_run_frames.hpp"
#include "apple/display/generated/mets_win_assets.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace apple::display {

namespace {

namespace gen = apple::display::generated;

// Roles, in the order of the preview's ROLES table.
constexpr std::uint8_t kSky = 0;
constexpr std::uint8_t kWinField = 1;
constexpr std::uint8_t kWhite = 2;
constexpr std::uint8_t kLogoBlue = 3;
constexpr std::uint8_t kLogoOrange = 4;
constexpr std::uint8_t kShadow = 5;
constexpr std::uint8_t kGlint = 6;
constexpr std::uint8_t kFlash = 7;
constexpr std::uint8_t kSparkWhite = 8;
constexpr std::uint8_t kSparkOrange = 9;
constexpr std::uint8_t kSparkGold = 10;
constexpr std::uint8_t kSparkBlue = 11;
constexpr std::uint8_t kSparkFade = 12;
constexpr std::uint8_t kFinalLabel = 13;
constexpr std::uint8_t kSparkColors[4] = {kSparkOrange, kSparkWhite, kSparkGold, kSparkBlue};
constexpr std::uint8_t kLogoRole[4] = {kSky, kLogoBlue, kWhite, kLogoOrange};

constexpr int kW = kLogicalWidth;
constexpr int kH = kLogicalHeight;
constexpr int kCx = 80;
constexpr int kCy = 60;
constexpr int kTextCy = 60;
constexpr text::Roles kTextRoles{kShadow, kGlint};
constexpr int kLogoW = gen::kLogoWidth;
constexpr int kLogoH = gen::kLogoHeight;
constexpr int kLogoX = gen::kLogoX;
constexpr int kLogoY = gen::kLogoY;
// The quick pop, in quarters of the final size: no rings to wait for here.
constexpr int kQuickPop[5] = {1, 2, 3, 5, 4};
// Turning to face you: widths 110*sin(pi/2 * (k+1)/11), a quarter turn from edge-on.
constexpr int kSpinWidths[11] = {16, 31, 46, 60, 73, 85, 94, 101, 106, 109, 110};
constexpr int kFxGravity = 15;                 // 1/256 px per tick^2
constexpr float kPi = 3.14159265f;

int iround(float v) { return static_cast<int>(std::lround(v)); }
float clamp01(float u) { return u < 0.f ? 0.f : (u > 1.f ? 1.f : u); }
float ease_in_quad(float u) { u = clamp01(u); return u * u; }
float glint_pos(float u) {
  return static_cast<float>(kLogoX + kLogoY - 6) + static_cast<float>(kLogoW + kLogoH + 12) * u;
}
float fmod_pos(float value, float period) {
  const float m = std::fmod(value, period);
  return m < 0.f ? m + period : m;
}

bool same_colors(const MetsWinColors &a, const MetsWinColors &b) {
  return std::memcmp(&a, &b, sizeof(MetsWinColors)) == 0;   // plain uint16 fields, no padding
}

void copy_team(char *dst, const char *src) {
  std::size_t n = 0;
  for (; src != nullptr && *src != '\0' && n < MetsWinLoop::kTeamLength; ++src) {
    char c = *src;
    if (c >= 'a' && c <= 'z')
      c = static_cast<char>(c - 'a' + 'A');
    if (c >= 'A' && c <= 'Z')
      dst[n++] = c;
  }
  dst[n] = '\0';
}

std::uint32_t fx_hash(std::uint32_t base, std::uint32_t i, std::uint32_t f) {
  return text::lcg(base + i * 131u + f * 7919u);
}

}  // namespace

struct MetsWinLoop::LogoPose {
  int w{kLogoW};
  int h{kLogoH};
  int dx{0};
  int dy{0};
  bool has_glint{false};
  float glint_c{0.f};
  bool white{false};     // a flash-white silhouette
  bool gone{false};
};

// A card block is one or two parts (team and runs on a score line) drawn with
// the same pose, each centred on its own x.
struct MetsWinLoop::CardBlock {
  struct Part {
    TextFit fit;
    int cx;
  };
  Part parts[2];
  int part_count{1};
  std::uint8_t role{kWhite};
  int cy{0};
};

const char *logo_entrance_name(LogoEntrance value) {
  switch (value) {
    case LogoEntrance::Flash: return "flash";
    case LogoEntrance::Drop: return "drop";
    case LogoEntrance::Spin: return "spin";
    case LogoEntrance::Slide: return "slide";
  }
  return "?";
}

const char *logo_hold_name(LogoHold value) {
  switch (value) {
    case LogoHold::Still: return "still";
    case LogoHold::Float: return "float";
    case LogoHold::Glint: return "glint";
  }
  return "?";
}

const char *logo_exit_name(LogoExit value) {
  switch (value) {
    case LogoExit::Flash: return "flash";
    case LogoExit::Shrink: return "shrink";
    case LogoExit::Drop: return "drop";
    case LogoExit::Wipe: return "wipe";
  }
  return "?";
}

const char *card_entrance_name(CardEntrance value) {
  switch (value) {
    case CardEntrance::Pop: return "pop";
    case CardEntrance::Slide: return "slide";
    case CardEntrance::Drop: return "drop";
  }
  return "?";
}

const char *card_exit_name(CardExit value) {
  switch (value) {
    case CardExit::Slide: return "slide";
    case CardExit::Drop: return "drop";
    case CardExit::Shrink: return "shrink";
  }
  return "?";
}

MetsWinColors default_mets_win_colors() {
  // The preview's defaults, RGB565: sky #00081F, Mets blue #002D72, white, Mets
  // orange #FF5910, gold #FFD45C, muted blue #587493, panel blue #0B1C3D, neutral #AAB4C1.
  return MetsWinColors{0x0043, 0x016E, 0xFFFF, 0x016E, 0xFAC2, 0xFAC2, 0xFEAB,
                       0xFFFF, 0xFFFF, 0xFAC2, 0xFEAB, 0x5BB2, 0x08E7, 0xADB8};
}

int MetsWinLoop::score_scale(const char *away, unsigned away_runs, const char *home,
                             unsigned home_runs) {
  char a[16], h[16];
  std::snprintf(a, sizeof(a), "%s %u", away, std::min(away_runs, kMaxRuns));
  std::snprintf(h, sizeof(h), "%s %u", home, std::min(home_runs, kMaxRuns));
  return text::fit_words(a, h).scale_x;
}

MetsWinLoop::MetsWinLoop() {
  decode_logo();
  begin("NYM", 0, "OPP", 0, false, 0);
}

void MetsWinLoop::decode_logo() {
  std::size_t p = 0;
  for (std::size_t i = 0; i + 1 < gen::kLogoRleSize && p < sizeof(logo_); i += 2) {
    std::size_t run = static_cast<std::size_t>(gen::kLogoRle[i]) + 1;
    run = std::min(run, sizeof(logo_) - p);
    std::memset(logo_ + p, gen::kLogoRle[i + 1], run);
    p += run;
  }
}

void MetsWinLoop::begin(const char *away, unsigned away_runs, const char *home,
                        unsigned home_runs, bool mets_home, std::uint32_t seed) {
  copy_team(away_, away);
  copy_team(home_, home);
  if (away_[0] == '\0')
    std::strcpy(away_, "AWY");
  if (home_[0] == '\0')
    std::strcpy(home_, "HME");
  away_runs_ = std::min(away_runs, kMaxRuns);
  home_runs_ = std::min(home_runs, kMaxRuns);
  mets_home_ = mets_home;
  seed_ = seed;
  words_fit_ = text::fit_words("METS", "WIN!");
  diff_.invalidate();

  pop_ms_ = 0;
  settle_ms_ = 0;
  for (std::size_t k = 0; k < gen::kStepCount; ++k) {
    pop_ms_ += gen::kSteps[k].ms;
    if (k < gen::kSettleStep)
      settle_ms_ += gen::kSteps[k].ms;
  }
  wipe_ms_ = static_cast<std::uint32_t>(gen::kWipeFrames) * gen::kWipeStepMs;
  text_ms_ = pop_ms_ + kTextHoldMs + kTextExitMs + wipe_ms_;
  card_ms_ = pop_ms_ + kCardHoldMs + kCardExitMs + kCardTailMs;
  loop_ms_ = kLogoEndMs + text_ms_ + card_ms_;
}

void MetsWinLoop::set_override(MetsWinOverride value) { override_ = value; }

MetsWinPicks MetsWinLoop::picks_for_loop(std::uint32_t loop) const {
  const std::uint32_t n = seed_ + loop;
  // Same salts as the preview's picksFor, so a seed reproduces the same loop.
  auto pick = [n](std::uint8_t count, std::uint32_t salt, int exclude) -> std::uint8_t {
    std::uint8_t keys[8];
    std::uint8_t total = 0;
    for (std::uint8_t i = 0; i < count; ++i)
      if (static_cast<int>(i) != exclude)
        keys[total++] = i;
    return keys[text::lcg(n * 7u + salt) % total];
  };
  auto choose = [&](std::int8_t pinned, std::uint8_t count, std::uint32_t salt, int exclude) {
    return pinned >= 0 ? static_cast<std::uint8_t>(pinned) : pick(count, salt, exclude);
  };
  MetsWinPicks out;
  const std::uint8_t le = choose(override_.logo_entrance, kLogoEntranceCount, 11, -1);
  const std::uint8_t lh = choose(override_.logo_hold, kLogoHoldCount, 12, -1);
  const std::uint8_t lx = choose(override_.logo_exit, kLogoExitCount, 13, -1);
  // The logo entrances' families in the text library: flash~pop, drop, spin, slide.
  static constexpr int kFamily[4] = {static_cast<int>(Entrance::Pop), static_cast<int>(Entrance::Drop),
                                     static_cast<int>(Entrance::Spin), static_cast<int>(Entrance::Slide)};
  const std::uint8_t te = choose(override_.text_entrance, kEntranceCount, 21, kFamily[le]);
  const std::uint8_t th = choose(override_.text_hold, kHoldCount, 22, -1);
  const std::uint8_t tx = choose(override_.text_exit, kExitCount, 23, -1);
  // Card entrances {pop, slide, drop} against the text entrance; card exits
  // {slide, drop, shrink} against the text exit.
  static constexpr int kCardEntranceOf[5] = {0, 1, 2, -1, -1};          // Entrance -> CardEntrance
  static constexpr int kCardExitOf[6] = {-1, 0, 1, -1, 2, -1};          // Exit -> CardExit
  const std::uint8_t ce = choose(override_.card_entrance, kCardEntranceCount, 31, kCardEntranceOf[te]);
  const std::uint8_t cx = choose(override_.card_exit, kCardExitCount, 32, kCardExitOf[tx]);
  out.logo = LogoPicks{static_cast<LogoEntrance>(le), static_cast<LogoHold>(lh), static_cast<LogoExit>(lx)};
  out.text = Picks{static_cast<Entrance>(te), static_cast<Hold>(th), static_cast<Exit>(tx)};
  out.card = CardPicks{static_cast<CardEntrance>(ce), static_cast<CardExit>(cx)};
  return out;
}

int MetsWinLoop::step_at(std::uint32_t t) const {
  std::uint32_t acc = 0;
  std::size_t k = 0;
  while (k + 1 < gen::kStepCount && t >= acc + gen::kSteps[k].ms)
    acc += gen::kSteps[k++].ms;
  return static_cast<int>(k);
}

// ---------------------------------------------------------------------------
// The roundel

void MetsWinLoop::draw_logo(const LogoPose &p) {
  if (p.w <= 0 || p.h <= 0)
    return;
  const int x0 = kLogoX + ((kLogoW - p.w) >> 1) + p.dx;
  const int y0 = kLogoY + ((kLogoH - p.h) >> 1) + p.dy;
  for (int oy = 0; oy < p.h; ++oy) {
    const int py = y0 + oy;
    if (py < 0 || py >= kH)
      continue;
    const int sy = std::min(kLogoH - 1, oy * kLogoH / p.h);
    for (int ox = 0; ox < p.w; ++ox) {
      const int px = x0 + ox;
      if (px < 0 || px >= kW)
        continue;
      const std::uint8_t r = logo_[sy * kLogoW + std::min(kLogoW - 1, ox * kLogoW / p.w)];
      if (r == 0)
        continue;
      std::uint8_t role = p.white ? kFlash : kLogoRole[r];
      if (!p.white && p.has_glint && r == 2) {
        const float v = static_cast<float>(px + py) - p.glint_c;
        if (v >= 0.f && v < 6.f)
          role = kGlint;
      }
      logical_[py * kW + px] = role;
    }
  }
}

namespace {

MetsWinLoop::LogoPose logo_entrance(LogoEntrance e, int k);

}  // namespace

// ---------------------------------------------------------------------------
// Fireworks: deterministic and stateless. Everything is a hash of (seed,
// rocket, field), positions are 8.8 fixed point and the sine table comes from
// the generator, so the preview draws the same sparks.

void MetsWinLoop::draw_fireworks(int t_ms, std::uint32_t base, int period_ticks, int spread_ticks,
                                 int max_rockets) {
  if (t_ms < 0)
    return;
  auto plot = [this](int x, int y, std::uint8_t role) {
    if (x >= 0 && x < kW && y >= 0 && y < kH)
      logical_[y * kW + x] = role;
  };
  auto plot_sky = [this](int x, int y, std::uint8_t role) {
    if (x >= 0 && x < kW && y >= 0 && y < kH && logical_[y * kW + x] == kSky)
      logical_[y * kW + x] = role;
  };
  const int n = t_ms / static_cast<int>(kLiveTickMs);
  int launch = static_cast<int>(fx_hash(base, 0, 0) % 8u);
  for (std::uint32_t i = 0; static_cast<int>(i) < max_rockets && launch <= n; ++i) {
    const int x0 = 12 + static_cast<int>(fx_hash(base, i, 2) % 137u);
    const int by = 10 + static_cast<int>(fx_hash(base, i, 3) % 51u);
    const int climb = 512 + static_cast<int>(fx_hash(base, i, 4) % 257u);
    const int rise = (119 * 256 - by * 256 + climb - 1) / climb;
    const int age = n - launch;
    if (age < rise) {
      const int y = (119 * 256 - climb * age) >> 8;
      plot_sky(x0, y, kSparkWhite);
      plot_sky(x0, y + 1, kSparkFade);
    } else {
      const int k = age - rise;
      const int count = 16 + static_cast<int>(fx_hash(base, i, 5) % 9u);
      const std::uint8_t col = kSparkColors[fx_hash(base, i, 6) % 4u];
      if (k < 2) {
        plot(x0, by, kSparkWhite);
        plot(x0 - 1, by, kSparkWhite);
        plot(x0 + 1, by, kSparkWhite);
        plot(x0, by - 1, kSparkWhite);
        plot(x0, by + 1, kSparkWhite);
      }
      for (int j = 0; j < count; ++j) {
        const int life = 18 + static_cast<int>(fx_hash(base, i, 80u + j) % 9u);
        if (k >= life)
          continue;
        const int a = ((j * 256) / count + static_cast<int>(fx_hash(base, i, 7u + j) % 17u) - 8) & 255;
        const int v = 384 + static_cast<int>(fx_hash(base, i, 40u + j) % 257u);
        const int vx = (v * gen::kSin256[(a + 64) & 255]) >> 8;
        const int vy = -((v * gen::kSin256[a]) >> 8);
        const int px = (x0 * 256 + vx * k) >> 8;
        const int py = (by * 256 + vy * k + kFxGravity * k * (k + 1) / 2) >> 8;
        if (k * 5 < life * 3)
          plot(px, py, col);
        else
          plot_sky(px, py, kSparkFade);
        if (k * 10 < life * 3) {                  // 2x2 core while young
          plot(px + 1, py, col);
          plot(px, py + 1, col);
          plot(px + 1, py + 1, col);
        }
      }
    }
    launch += period_ticks + static_cast<int>(fx_hash(base, i + 1, 1) % static_cast<std::uint32_t>(spread_ticks));
  }
}

// ---------------------------------------------------------------------------
// Beats

namespace {

MetsWinLoop::LogoPose logo_entrance(LogoEntrance e, int k) {
  MetsWinLoop::LogoPose p;
  switch (e) {
    case LogoEntrance::Flash:
      // A flash-white silhouette pops quarter, half, full, then the colours arrive;
      // never a full-screen strobe, so the loop resets on the sky it ended on.
      if (k <= 2) {
        p.white = true;
        p.w = p.h = k == 0 ? 28 : k == 1 ? 55 : kLogoW;
      }
      break;
    case LogoEntrance::Drop:
      p.dy = text::fall_curve(k);
      break;
    case LogoEntrance::Spin:
      p.w = k < 11 ? kSpinWidths[k] : kLogoW;
      break;
    case LogoEntrance::Slide:
      p.dx = text::slide_in(k);
      break;
  }
  return p;
}

// Hold styles rest for the first 400 ms; `t` counts from the settle step. The
// slide entrance adds one glint sweep over the first 700 ms of the hold.
MetsWinLoop::LogoPose logo_hold(LogoHold h, float t, bool after_glint) {
  MetsWinLoop::LogoPose p;
  switch (h) {
    case LogoHold::Still:
      break;
    case LogoHold::Float:
      p.dy = iround(2.f * std::sin(2.f * kPi * t / 1400.f));
      break;
    case LogoHold::Glint:
      if (t >= 400.f) {
        const float phase = fmod_pos(t - 400.f, 1800.f);
        if (phase <= 700.f) {
          p.has_glint = true;
          p.glint_c = glint_pos(phase / 700.f);
        }
      }
      break;
  }
  if (after_glint && t < 700.f) {
    p.has_glint = true;
    p.glint_c = glint_pos(t / 700.f);
  }
  return p;
}

// u in [0, 1) over the 400 ms exit.
MetsWinLoop::LogoPose logo_exit(LogoExit e, float u, bool &wipe) {
  MetsWinLoop::LogoPose p;
  wipe = false;
  switch (e) {
    case LogoExit::Flash:
      if (u >= 0.875f)
        p.gone = true;
      else if (u >= 0.75f)
        p.white = true;
      break;
    case LogoExit::Shrink:
      if (u >= 0.9f)
        p.gone = true;
      else if (u >= 0.67f)
        p.w = p.h = 28;
      else if (u >= 0.34f)
        p.w = p.h = 55;
      break;
    case LogoExit::Drop:
      p.dy = iround(170.f * ease_in_quad(u));
      break;
    case LogoExit::Wipe:
      wipe = true;
      break;
  }
  return p;
}

}  // namespace

void MetsWinLoop::draw_logo_beat(std::uint32_t t, const LogoPicks &picks, std::uint32_t seed) {
  std::memset(logical_, kSky, sizeof(logical_));
  const bool after_glint = picks.entrance == LogoEntrance::Slide;
  const float t_clock = static_cast<float>(t) - static_cast<float>(settle_ms_);
  LogoPose pose;
  float wipe_u = -1.f;
  if (t < pop_ms_) {
    const int k = step_at(t);
    pose = k >= static_cast<int>(gen::kSettleStep) ? logo_hold(picks.hold, t_clock, after_glint)
                                                    : logo_entrance(picks.entrance, k);
  } else if (t < kLogoHoldEndMs) {
    pose = logo_hold(picks.hold, t_clock, after_glint);
  } else {
    const float u = static_cast<float>(t - kLogoHoldEndMs) / static_cast<float>(kLogoEndMs - kLogoHoldEndMs);
    bool wipe = false;
    pose = logo_exit(picks.exit, u, wipe);
    if (wipe)
      wipe_u = u;
  }
  if (!pose.gone)
    draw_logo(pose);
  // Until the settle, the previous loop's card fireworks keep drifting across the boundary.
  if (fireworks_) {
    if (t < settle_ms_)
      draw_fireworks(static_cast<int>(card_ms_ + t), (seed - 1u) * 3u + 202u, 40, 20, 8);
    else
      draw_fireworks(static_cast<int>(t) - static_cast<int>(settle_ms_), seed * 3u + 101u, 20, 12, 16);
  }
  if (wipe_u >= 0.f)
    text::fill_diamond_at(logical_, kCx, kCy, iround(gen::kWipeMaxHalfDiagonal * wipe_u * wipe_u), kWinField);
}

void MetsWinLoop::draw_text_beat(std::uint32_t t, const Picks &picks, std::uint32_t seed) {
  std::memset(logical_, kWinField, sizeof(logical_));
  const TextFit &fit = words_fit_;
  const int n_letters = text::letters_in(fit);
  const float t_clock = static_cast<float>(t) - static_cast<float>(settle_ms_);
  auto draw_held = [&]() {
    text::Pose p = text::settled_pose();
    text::apply_hold_style(picks.hold, t_clock,
                           text::layout_lines(fit, fit.scale_x, fit.scale_y, kCx, kTextCy), seed, p);
    text::draw_pose(logical_, fit, kWhite, p, kCx, kTextCy, kTextRoles);
  };
  if (t < pop_ms_) {
    const int k = step_at(t);
    if (k >= static_cast<int>(gen::kSettleStep)) {
      draw_held();
    } else {
      text::draw_pose(logical_, fit, kWhite,
                      text::entrance_pose(picks.entrance, k, fit, n_letters, kQuickPop[std::min(k, 4)]),
                      kCx, kTextCy, kTextRoles);
    }
    return;
  }
  const std::uint32_t th = t - pop_ms_;
  if (th < kTextHoldMs) {
    draw_held();
    return;
  }
  const std::uint32_t te = th - kTextHoldMs;
  bool gone = false;
  if (te < kTextExitMs) {
    text::draw_pose(logical_, fit, kWhite,
                    text::exit_pose(picks.exit, static_cast<float>(te) / kTextExitMs, fit, gone),
                    kCx, kTextCy, kTextRoles);
    return;
  }
  const text::Pose final_pose = text::exit_pose(picks.exit, 1.f, fit, gone);
  if (!gone)
    text::draw_pose(logical_, fit, kWhite, final_pose, kCx, kTextCy, kTextRoles);
  const std::uint32_t i = std::min<std::uint32_t>(gen::kWipeFrames - 1, (te - kTextExitMs) / gen::kWipeStepMs);
  const float frac = static_cast<float>(i + 1) / gen::kWipeFrames;
  text::fill_diamond_at(logical_, kCx, kCy, iround(gen::kWipeMaxHalfDiagonal * frac * frac), kSky);
}

// FINAL, the two score lines as a scoreboard (teams left-aligned, runs
// right-aligned, one scale for both lines), and the call.
void MetsWinLoop::build_card(CardBlock blocks[4]) const {
  char away_runs[4], home_runs[4];
  std::snprintf(away_runs, sizeof(away_runs), "%u", away_runs_);
  std::snprintf(home_runs, sizeof(home_runs), "%u", home_runs_);
  const int s = score_scale(away_, away_runs_, home_, home_runs_);
  const int tw = std::max(text::text_width(away_), text::text_width(home_));
  const int rw = std::max(text::text_width(away_runs), text::text_width(home_runs));
  const int gap = text::text_width("  ");
  const int left = kCx - ((tw + gap + rw) * s) / 2;
  const int right = left + (tw + gap + rw) * s;
  auto line = [&](CardBlock &b, const char *team, const char *runs, std::uint8_t role, int cy) {
    b.parts[0] = {text::fit_line(team, s, s), left + (text::text_width(team) * s) / 2};
    b.parts[1] = {text::fit_line(runs, s, s), right - (text::text_width(runs) * s) / 2};
    b.part_count = 2;
    b.role = role;
    b.cy = cy;
  };
  blocks[0].parts[0] = {text::fit_line("FINAL", 2, 2), kCx};
  blocks[0].part_count = 1;
  blocks[0].role = kFinalLabel;
  blocks[0].cy = 12;
  line(blocks[1], away_, away_runs, mets_home_ ? kWhite : kLogoOrange, 44);
  line(blocks[2], home_, home_runs, mets_home_ ? kLogoOrange : kWhite, 80);
  blocks[3].parts[0] = {text::fit_line("PUT IT IN THE BOOKS!", 1, 1, 1), kCx};
  blocks[3].part_count = 1;
  blocks[3].role = kGlint;
  blocks[3].cy = 108;
}

void MetsWinLoop::draw_card_beat(std::uint32_t t, const CardPicks &picks, std::uint32_t seed) {
  std::memset(logical_, kSky, sizeof(logical_));
  CardBlock blocks[4];
  build_card(blocks);
  auto draw_block = [&](const CardBlock &b, auto pose_for) {
    for (int pi = 0; pi < b.part_count; ++pi)
      text::draw_pose(logical_, b.parts[pi].fit, b.role, pose_for(b.parts[pi].fit), b.parts[pi].cx, b.cy,
                      kTextRoles);
  };
  if (t < pop_ms_) {
    const int k = step_at(t);
    // Pop cascades top-down two steps apart, each block on the quick pop; Drop
    // falls bottom-up (the call first, FINAL last) so no block crosses another.
    for (int bi = 0; bi < 4; ++bi) {
      draw_block(blocks[bi], [&](const TextFit &fit) {
        text::Pose p;
        if (k >= static_cast<int>(gen::kSettleStep))
          return p;
        switch (picks.entrance) {
          case CardEntrance::Pop: {
            const int kb = k - 2 * bi;
            if (kb < 0)
              return text::hidden_pose();
            return text::entrance_pose(Entrance::Pop, kb, fit, 0, kQuickPop[std::min(kb, 4)]);
          }
          case CardEntrance::Slide:
            p.dx = text::slide_in(k);
            return p;
          case CardEntrance::Drop:
            p.dy = text::fall_curve(k - (3 - bi));
            return p;
        }
        return p;
      });
    }
  } else {
    const std::uint32_t th = t - pop_ms_;
    if (th < kCardHoldMs) {
      for (int bi = 0; bi < 4; ++bi)
        draw_block(blocks[bi], [](const TextFit &) { return text::Pose{}; });
    } else if (th - kCardHoldMs < kCardExitMs) {
      const float u = static_cast<float>(th - kCardHoldMs) / kCardExitMs;
      for (int bi = 0; bi < 4; ++bi) {
        draw_block(blocks[bi], [&](const TextFit &fit) {
          bool gone = false;
          switch (picks.exit) {
            case CardExit::Slide:
              return text::exit_pose(Exit::Slide, u, fit, gone);
            case CardExit::Drop:
              return text::exit_pose(Exit::Drop, u, fit, gone);
            case CardExit::Shrink: {
              // Bottom-up, each block collapsing over half the exit.
              const float ub = (u - static_cast<float>(3 - bi) * 0.1625f) / 0.5f;
              if (ub < 0.f)
                return text::Pose{};
              if (ub >= 1.f)
                return text::hidden_pose();
              return text::exit_pose(Exit::Shrink, ub, fit, gone);
            }
          }
          return text::Pose{};
        });
      }
    }
  }
  if (fireworks_)
    draw_fireworks(static_cast<int>(t), seed * 3u + 202u, 40, 20, 8);
}

// ---------------------------------------------------------------------------

std::uint32_t MetsWinLoop::render_key(std::uint32_t elapsed_ms) const {
  const std::uint32_t loop = elapsed_ms / loop_ms_;
  const std::uint32_t t = elapsed_ms % loop_ms_;
  // Every live tick, plus the entrance step so step boundaries land exactly.
  std::uint32_t beat_t = t;
  if (t >= kLogoEndMs)
    beat_t = t < kLogoEndMs + text_ms_ ? t - kLogoEndMs : t - kLogoEndMs - text_ms_;
  const std::uint32_t step = beat_t < pop_ms_ ? static_cast<std::uint32_t>(step_at(beat_t)) + 1 : 0;
  return loop * 100000u + (t / kLiveTickMs) * 16u + step;
}

DirtyRect MetsWinLoop::render(std::uint32_t elapsed_ms, std::uint16_t *rgb565,
                              const MetsWinColors &colors) {
  const std::uint32_t loop = elapsed_ms / loop_ms_;
  const std::uint32_t t = elapsed_ms % loop_ms_;
  const MetsWinPicks picks = picks_for_loop(loop);
  const std::uint32_t loop_seed = seed_ + loop;
  diff_.remember(logical_);

  if (t < kLogoEndMs)
    draw_logo_beat(t, picks.logo, loop_seed);
  else if (t < kLogoEndMs + text_ms_)
    draw_text_beat(t - kLogoEndMs, picks.text, loop_seed);
  else
    draw_card_beat(t - kLogoEndMs - text_ms_, picks.card, loop_seed);

  const std::uint16_t map[16] = {colors.sky,         colors.win_field,   colors.white,
                                 colors.logo_blue,   colors.logo_orange, colors.shadow,
                                 colors.glint,       colors.flash,       colors.spark_white,
                                 colors.spark_orange, colors.spark_gold, colors.spark_blue,
                                 colors.spark_fade,  colors.final_label, colors.sky, colors.sky};
  blit_2x(logical_, rgb565, map);
  const DirtyRect dirty = diff_.changed(logical_, !same_colors(colors, prev_colors_));
  prev_colors_ = colors;
  return dirty;
}

}  // namespace apple::display
