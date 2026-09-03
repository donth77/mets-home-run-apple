#include "apple/display/home_run_loop.hpp"

#include "apple/display/generated/home_run_frames.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace apple::display {

namespace {

namespace gen = apple::display::generated;

constexpr std::uint8_t kBg = 0;
constexpr std::uint8_t kField = 1;
constexpr std::uint8_t kWhite = 2;
// role 3 (seam) only occurs in baked frames
constexpr std::uint8_t kShadow = 4;
constexpr std::uint8_t kName = 5;
constexpr std::uint8_t kGlint = 6;

constexpr int kCx = gen::kCenterX;
constexpr int kCy = gen::kCenterY;
constexpr int kTextCy = gen::kTextCenterY;
constexpr text::Roles kRoles{kShadow, kGlint};

int iround(float v) { return static_cast<int>(std::lround(v)); }

bool same_colors(const Colors &a, const Colors &b) {
  return a.background == b.background && a.field == b.field && a.white == b.white &&
         a.seam == b.seam && a.shadow == b.shadow && a.name == b.name &&
         a.glint == b.glint && a.flash == b.flash;
}

void fill_diamond(std::uint8_t *buf, int d, std::uint8_t role) {
  text::fill_diamond_at(buf, kCx, kCy, d, role);
}

}  // namespace

Colors default_colors() {
  return Colors{gen::kDefaultColors[0], gen::kDefaultColors[1],
                gen::kDefaultColors[2], gen::kDefaultColors[3],
                gen::kDefaultColors[4], gen::kDefaultColors[5],
                gen::kDefaultColors[6], gen::kDefaultColors[7]};
}

HomeRunLoop::HomeRunLoop() { begin(Headline::HomeRun, "", 0); }

void HomeRunLoop::begin(Headline headline, const char *batter_name, std::uint32_t seed) {
  headline_ = headline;
  seed_ = seed;
  headline_fit_ = headline == Headline::GrandSlam ? text::fit_words("GRAND", "SLAM!!")
                                                  : text::fit_words("HOME", "RUN");
  name_ = text::fit_name(batter_name);
  diff_.invalidate();

  // Timeline.
  frame_start_[0] = 0;
  for (std::size_t k = 0; k < gen::kFrameCount; ++k)
    frame_start_[k + 1] = frame_start_[k] + gen::kFrameDelaysMs[k];
  baked_ms_ = frame_start_[gen::kFrameCount];
  pop_ms_ = 0;
  settle_ms_ = 0;
  for (std::size_t k = 0; k < gen::kStepCount; ++k) {
    pop_ms_ += gen::kSteps[k].ms;
    if (k < gen::kSettleStep)
      settle_ms_ += gen::kSteps[k].ms;
  }
  sequence_ms_ = pop_ms_ + gen::kHoldMs + gen::kExitMs +
                 static_cast<std::uint32_t>(gen::kWipeFrames) * gen::kWipeStepMs;
  loop_ms_ = baked_ms_ + 2 * sequence_ms_;
}

void HomeRunLoop::set_override(PickOverride value) { override_ = value; }

SequencePicks HomeRunLoop::picks_for_loop(std::uint32_t loop) const {
  const std::uint32_t loop_seed = seed_ + loop;
  auto pick = [loop_seed](std::uint8_t count, std::uint32_t salt, int exclude) -> std::uint8_t {
    std::uint8_t keys[8];
    std::uint8_t total = 0;
    for (std::uint8_t i = 0; i < count; ++i)
      if (static_cast<int>(i) != exclude)
        keys[total++] = i;
    return keys[text::lcg(loop_seed * 7u + salt) % total];
  };
  SequencePicks out;
  const int oe = override_.entrance, oh = override_.hold, ox = override_.exit;
  const std::uint8_t he = oe >= 0 ? static_cast<std::uint8_t>(oe) : pick(kEntranceCount, 1, -1);
  const std::uint8_t hh = oh >= 0 ? static_cast<std::uint8_t>(oh) : pick(kHoldCount, 2, -1);
  const std::uint8_t hx = ox >= 0 ? static_cast<std::uint8_t>(ox) : pick(kExitCount, 3, -1);
  const std::uint8_t ne = oe >= 0 ? he : pick(kEntranceCount, 4, he);
  const std::uint8_t nh = oh >= 0 ? hh : pick(kHoldCount, 5, hh);
  const std::uint8_t nx = ox >= 0 ? hx : pick(kExitCount, 6, hx);
  out.headline = Picks{static_cast<Entrance>(he), static_cast<Hold>(hh), static_cast<Exit>(hx)};
  out.name = Picks{static_cast<Entrance>(ne), static_cast<Hold>(nh), static_cast<Exit>(nx)};
  return out;
}

void HomeRunLoop::decode_frame(std::uint8_t frame) {
  const std::uint16_t begin = gen::kFrameOffsets[frame];
  const std::uint16_t end = gen::kFrameOffsets[frame + 1];
  std::size_t p = 0;
  for (std::uint16_t i = begin; i + 1 < end && p < sizeof(logical_); i += 2) {
    std::size_t run = static_cast<std::size_t>(gen::kFrameRle[i]) + 1;
    run = std::min(run, sizeof(logical_) - p);
    std::memset(logical_ + p, gen::kFrameRle[i + 1], run);
    p += run;
  }
}

void HomeRunLoop::draw_big_diamond(std::uint16_t zoom_percent) {
  const float z = zoom_percent / 100.f;
  const int d = iround(gen::kDiamondHalfDiagonal * z);
  const int ring = std::max(1, iround(gen::kDiamondRingL1 * z));
  const int bh = std::max(3, iround(gen::kBaseHalf * z));
  fill_diamond(logical_, d, kWhite);
  fill_diamond(logical_, d - ring, kField);
  const int verts[4][2] = {{kCx, kCy + d}, {kCx + d, kCy}, {kCx, kCy - d}, {kCx - d, kCy}};
  for (const auto &v : verts) {
    const int ix = (kCx > v[0]) - (kCx < v[0]);
    const int iy = (kCy > v[1]) - (kCy < v[1]);
    text::fill_diamond_at(logical_, v[0] + ix * bh, v[1] + iy * bh, bh, kWhite);
  }
}

void HomeRunLoop::draw_sequence(std::uint32_t t, const TextFit &fit, std::uint8_t role,
                                const Picks &picks, std::uint32_t seed, bool with_diamond) {
  const int n_letters = text::letters_in(fit);
  const float t_clock = static_cast<float>(t) - static_cast<float>(settle_ms_);
  auto draw_held = [&]() {
    text::Pose p = text::settled_pose();
    text::apply_hold_style(picks.hold, t_clock,
                           text::layout_lines(fit, fit.scale_x, fit.scale_y, kCx, kTextCy), seed, p);
    text::draw_pose(logical_, fit, role, p, kCx, kTextCy, kRoles);
  };

  if (t < pop_ms_) {
    std::uint32_t acc = 0;
    std::size_t k = 0;
    while (k + 1 < gen::kStepCount && t >= acc + gen::kSteps[k].ms)
      acc += gen::kSteps[k++].ms;
    const gen::Step &st = gen::kSteps[k];
    std::memset(logical_, kBg, sizeof(logical_));
    if (with_diamond && st.big_zoom_percent != 0)
      draw_big_diamond(st.big_zoom_percent);
    if (st.ring_white >= 0) {
      fill_diamond(logical_, st.ring_white, kWhite);
      fill_diamond(logical_, st.ring_blue, kBg);
      fill_diamond(logical_, st.ring_core, kField);
    }
    if (k >= gen::kSettleStep) {
      draw_held();
    } else {
      text::draw_pose(logical_, fit, role,
                      text::entrance_pose(picks.entrance, static_cast<int>(k), fit, n_letters,
                                          st.pop_quarters),
                      kCx, kTextCy, kRoles);
    }
    return;
  }

  std::memset(logical_, kField, sizeof(logical_));
  const std::uint32_t t_hold = t - pop_ms_;
  if (t_hold < gen::kHoldMs) {
    draw_held();
    return;
  }
  const std::uint32_t t_exit = t_hold - gen::kHoldMs;
  bool gone = false;
  if (t_exit < gen::kExitMs) {
    text::draw_pose(logical_, fit, role,
                    text::exit_pose(picks.exit, static_cast<float>(t_exit) / gen::kExitMs, fit, gone),
                    kCx, kTextCy, kRoles);
    return;
  }
  const text::Pose final_pose = text::exit_pose(picks.exit, 1.f, fit, gone);
  if (!gone)
    text::draw_pose(logical_, fit, role, final_pose, kCx, kTextCy, kRoles);
  const std::uint32_t i = std::min<std::uint32_t>(gen::kWipeFrames - 1,
                                                  (t_exit - gen::kExitMs) / gen::kWipeStepMs);
  const float frac = static_cast<float>(i + 1) / gen::kWipeFrames;
  fill_diamond(logical_, iround(gen::kWipeMaxHalfDiagonal * frac * frac), kBg);
}

std::uint32_t HomeRunLoop::render_key(std::uint32_t elapsed_ms) const {
  const std::uint32_t loop = elapsed_ms / loop_ms_;
  const std::uint32_t t = elapsed_ms % loop_ms_;
  std::uint32_t key;
  if (t < baked_ms_) {
    std::uint8_t k = 0;
    while (k + 1 < gen::kFrameCount && frame_start_[k + 1] <= t)
      ++k;
    key = k;                                      // one key per baked frame
  } else {
    const std::uint32_t rel = t - baked_ms_;
    const std::uint32_t seq = rel / sequence_ms_; // headline, then name
    std::uint32_t ts = rel % sequence_ms_;
    if (ts < pop_ms_) {
      std::uint32_t acc = 0;
      std::size_t k = 0;
      while (k + 1 < gen::kStepCount && ts >= acc + gen::kSteps[k].ms)
        acc += gen::kSteps[k++].ms;
      // Entrance poses depend only on the step; once settled, the hold style
      // runs on the clock, so those steps also tick.
      const std::uint32_t sub =
          k >= gen::kSettleStep ? std::min<std::uint32_t>(9, (ts - acc) / kLiveTickMs) : 0;
      key = 100 + 10 * static_cast<std::uint32_t>(k) + sub;
    } else if ((ts -= pop_ms_) < gen::kHoldMs) {
      key = 300 + ts / kLiveTickMs;
    } else if ((ts -= gen::kHoldMs) < gen::kExitMs) {
      key = 500 + ts / kLiveTickMs;
    } else {
      key = 600 + (ts - gen::kExitMs) / gen::kWipeStepMs;
    }
    key += 1000 + seq * 1000;
  }
  return loop * 100000u + key;
}

DirtyRect HomeRunLoop::render(std::uint32_t elapsed_ms, std::uint16_t *rgb565,
                              const Colors &colors) {
  const std::uint32_t loop = elapsed_ms / loop_ms_;
  const std::uint32_t t = elapsed_ms % loop_ms_;
  diff_.remember(logical_);

  bool flash = false;
  if (t < baked_ms_) {
    std::uint8_t k = 0;
    while (k + 1 < gen::kFrameCount && frame_start_[k + 1] <= t)
      ++k;
    decode_frame(k);
    flash = k == 0;
  } else {
    const SequencePicks picks = picks_for_loop(loop);
    const std::uint32_t loop_seed = seed_ + loop;
    const std::uint32_t rel = t - baked_ms_;
    if (rel < sequence_ms_)
      draw_sequence(rel, headline_fit_, kWhite, picks.headline, loop_seed, true);
    else
      draw_sequence(rel - sequence_ms_, name_, kName, picks.name, loop_seed + 7u, false);
  }
  const std::uint16_t map[8] = {colors.background, colors.field,
                                flash ? colors.flash : colors.white,
                                colors.seam, colors.shadow, colors.name,
                                colors.glint, colors.white};
  blit_2x(logical_, rgb565, map);

  // The role buffer maps to pixels through the colors, and the flash frame maps
  // role 2 differently, so a change of either means everything may differ.
  const bool force_full = flash != prev_flash_ || !same_colors(colors, prev_colors_);
  const DirtyRect dirty = diff_.changed(logical_, force_full);
  prev_flash_ = flash;
  prev_colors_ = colors;
  return dirty;
}

}  // namespace apple::display
