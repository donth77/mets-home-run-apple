#include "apple/display/generated/home_run_frames.hpp"
#include "apple/display/home_run_loop.hpp"

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

namespace {

using apple::display::Colors;
using apple::display::Entrance;
using apple::display::Exit;
using apple::display::Headline;
using apple::display::Hold;
using apple::display::HomeRunLoop;
using apple::display::PickOverride;
using apple::display::SequencePicks;
using apple::display::TextFit;
namespace gen = apple::display::generated;

[[noreturn]] void fail(const std::string &message, int line) {
  std::cerr << "FAIL line " << line << ": " << message << '\n';
  std::exit(1);
}

#define EXPECT_TRUE(value)                                                     \
  do {                                                                         \
    if (!(value))                                                              \
      fail("expected true: " #value, __LINE__);                                \
  } while (false)

#define EXPECT_EQ(actual, expected)                                            \
  do {                                                                         \
    const auto actual_value = (actual);                                        \
    const auto expected_value = (expected);                                    \
    if (!(actual_value == expected_value))                                     \
      fail("values differ: " #actual " != " #expected " (" +                   \
               std::to_string(actual_value) + " vs " +                         \
               std::to_string(expected_value) + ")",                           \
           __LINE__);                                                          \
  } while (false)

constexpr std::size_t kPixels =
    static_cast<std::size_t>(HomeRunLoop::kPanelWidth) * HomeRunLoop::kPanelHeight;
constexpr std::size_t kLogical =
    static_cast<std::size_t>(HomeRunLoop::kLogicalWidth) * HomeRunLoop::kLogicalHeight;

// Distinct colors per role so a frame's role usage can be read back from RGB565.
const Colors kTestColors{0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008};

std::size_t count_color(const std::vector<std::uint16_t> &fb, std::uint16_t c) {
  std::size_t n = 0;
  for (const auto v : fb)
    n += (v == c);
  return n;
}

void test_timeline_matches_preview() {
  HomeRunLoop loop;
  loop.begin(Headline::HomeRun, "Juan Soto", 1);
  EXPECT_EQ(loop.baked_ms(), 2070u);
  EXPECT_EQ(loop.pop_ms(), 938u);
  EXPECT_EQ(loop.sequence_ms(), 4407u);
  EXPECT_EQ(loop.loop_ms(), 10884u);
  EXPECT_EQ(loop.loop_index(10883), 0u);
  EXPECT_EQ(loop.loop_index(10884), 1u);
}

void expect_lines(const TextFit &fit, const char *a, const char *b, const char *c) {
  EXPECT_EQ(fit.line_count, c != nullptr ? 3 : (b != nullptr ? 2 : 1));
  EXPECT_TRUE(std::strcmp(fit.lines[0], a) == 0);
  if (b != nullptr)
    EXPECT_TRUE(std::strcmp(fit.lines[1], b) == 0);
  if (c != nullptr)
    EXPECT_TRUE(std::strcmp(fit.lines[2], c) == 0);
}

void test_name_normalization_and_fit() {
  HomeRunLoop loop;
  loop.begin(Headline::HomeRun, "  juan   soto ", 1);
  expect_lines(loop.name(), "JUAN", "SOTO", nullptr);
  EXPECT_EQ(loop.name().scale_x, 4);
  EXPECT_EQ(loop.name().scale_y, 4);

  // Width forces x2; the height has room, so the letters go one step taller (condensed).
  loop.begin(Headline::HomeRun, "Francisco Lindor", 1);
  expect_lines(loop.name(), "FRANCISCO", "LINDOR", nullptr);
  EXPECT_EQ(loop.name().scale_x, 2);
  EXPECT_EQ(loop.name().scale_y, 3);

  loop.begin(Headline::HomeRun, "J.D. Martinez", 1);
  expect_lines(loop.name(), "J.D.", "MARTINEZ", nullptr);

  loop.begin(Headline::HomeRun, "Ohtani", 1);            // one word: one line
  expect_lines(loop.name(), "OHTANI", nullptr, nullptr);

  loop.begin(Headline::HomeRun, "José Iglesias", 1);     // non-ASCII dropped, still two lines
  expect_lines(loop.name(), "JOS", "IGLESIAS", nullptr);

  // Two lines stay when a third would not make the block bigger.
  loop.begin(Headline::HomeRun, "Pete Alonso", 1);
  expect_lines(loop.name(), "PETE", "ALONSO", nullptr);
  EXPECT_EQ(loop.name().scale_x, 3);
  EXPECT_EQ(loop.name().scale_y, 3);

  // A hyphenated surname breaks after the hyphen when that lets the block go up a size.
  loop.begin(Headline::HomeRun, "Isiah Kiner-Falefa", 1);
  expect_lines(loop.name(), "ISIAH", "KINER-", "FALEFA");
  EXPECT_EQ(loop.name().scale_x, 3);
  EXPECT_EQ(loop.name().scale_y, 3);

  // A suffix or a multi-word surname breaks at the last space for the same reason.
  loop.begin(Headline::HomeRun, "Jazz Chisholm Jr.", 1);
  expect_lines(loop.name(), "JAZZ", "CHISHOLM", "JR.");
  EXPECT_TRUE(loop.name().scale_x >= 2);
  loop.begin(Headline::HomeRun, "Jose De La Cruz", 1);
  expect_lines(loop.name(), "JOSE", "DE LA", "CRUZ");
  EXPECT_EQ(loop.name().scale_x, 3);
  EXPECT_EQ(loop.name().scale_y, 3);

  // The long demo name: with the 7 px Match 7 letters it fills the panel at x2 wide, x3 tall.
  loop.begin(Headline::HomeRun, "Christopher Encarnacion-Strand", 1);
  if (std::strcmp(apple::display::font_name(), "Match 7") == 0) {
    expect_lines(loop.name(), "CHRISTOPHER", "ENCARNACION-", "STRAND");
    EXPECT_EQ(loop.name().scale_x, 2);
    EXPECT_EQ(loop.name().scale_y, 3);
  }
  EXPECT_TRUE(loop.name().widest_px * loop.name().scale_x <= HomeRunLoop::kMaxLineWidth);

  // Headlines stay large and fully inside the margins with either the public
  // font or a local licensed font override. Exact advances differ by font.
  loop.begin(Headline::GrandSlam, "X", 1);
  expect_lines(loop.headline(), "GRAND", "SLAM!!", nullptr);
  const TextFit &grand_slam = loop.headline();
  const TextFit home_run = HomeRunLoop::fit_words("HOME", "RUN");
  EXPECT_TRUE(grand_slam.scale_x >= 3);
  EXPECT_TRUE(home_run.scale_y >= 3);
  EXPECT_TRUE(grand_slam.widest_px * grand_slam.scale_x <= HomeRunLoop::kMaxLineWidth);
  EXPECT_TRUE(home_run.widest_px * home_run.scale_x <= HomeRunLoop::kMaxLineWidth);
}

void test_name_never_repeats_headline_picks() {
  HomeRunLoop loop;
  for (std::uint32_t seed = 0; seed < 50; ++seed) {
    loop.begin(Headline::HomeRun, "Pete Alonso", seed * 2654435761u);
    bool varied = false;
    SequencePicks first = loop.picks_for_loop(0);
    for (std::uint32_t n = 0; n < 40; ++n) {
      const SequencePicks p = loop.picks_for_loop(n);
      EXPECT_TRUE(p.headline.entrance != p.name.entrance);
      EXPECT_TRUE(p.headline.hold != p.name.hold);
      EXPECT_TRUE(p.headline.exit != p.name.exit);
      EXPECT_TRUE(static_cast<int>(p.headline.entrance) < apple::display::kEntranceCount);
      EXPECT_TRUE(static_cast<int>(p.name.hold) < apple::display::kHoldCount);
      EXPECT_TRUE(static_cast<int>(p.name.exit) < apple::display::kExitCount);
      if (n > 0 && (p.headline.entrance != first.headline.entrance ||
                    p.headline.hold != first.headline.hold))
        varied = true;
    }
    EXPECT_TRUE(varied);  // the loop re-rolls, it is not stuck on one set
  }
  // A pinned slot applies to both words.
  loop.set_override(PickOverride{2, -1, 4});
  const SequencePicks p = loop.picks_for_loop(3);
  EXPECT_EQ(static_cast<int>(p.headline.entrance), 2);
  EXPECT_EQ(static_cast<int>(p.name.entrance), 2);
  EXPECT_EQ(static_cast<int>(p.headline.exit), 4);
  EXPECT_EQ(static_cast<int>(p.name.exit), 4);
  EXPECT_TRUE(p.headline.hold != p.name.hold);
}

void test_baked_frames_decode_and_flash() {
  HomeRunLoop loop;
  loop.begin(Headline::HomeRun, "Juan Soto", 7);
  std::vector<std::uint16_t> fb(kPixels, 0xFFFF);
  loop.render(0, fb.data(), kTestColors);
  EXPECT_EQ(count_color(fb, kTestColors.flash), kPixels);   // frame 0 is the flash
  loop.render(400, fb.data(), kTestColors);                  // the ball: white and seams on background
  EXPECT_TRUE(count_color(fb, kTestColors.white) > 20000);
  EXPECT_TRUE(count_color(fb, kTestColors.seam) > 100);
  EXPECT_TRUE(count_color(fb, kTestColors.background) > 1000);
  loop.render(2000, fb.data(), kTestColors);                 // completed base path
  EXPECT_TRUE(count_color(fb, kTestColors.field) > 5000);
  EXPECT_TRUE(count_color(fb, kTestColors.white) > 500);
  for (const auto r : std::vector<std::uint8_t>(loop.logical(), loop.logical() + kLogical))
    EXPECT_TRUE(r <= 4);
}

void test_live_sequence_draws_words_and_wipes() {
  HomeRunLoop loop;
  loop.begin(Headline::GrandSlam, "Juan Soto", 3);
  std::vector<std::uint16_t> fb(kPixels, 0);
  const std::uint32_t hold_start = loop.baked_ms() + loop.pop_ms() + 100;
  loop.render(hold_start, fb.data(), kTestColors);
  EXPECT_TRUE(count_color(fb, kTestColors.white) > 1500);    // GRAND SLAM!! in white
  EXPECT_TRUE(count_color(fb, kTestColors.shadow) > 300);    // on its shadow
  EXPECT_TRUE(count_color(fb, kTestColors.field) > 40000);   // on the field
  const std::uint32_t name_hold = loop.baked_ms() + loop.sequence_ms() + loop.pop_ms() + 100;
  loop.render(name_hold, fb.data(), kTestColors);
  EXPECT_TRUE(count_color(fb, kTestColors.name) > 1500);     // the batter's name in its own role
  EXPECT_EQ(count_color(fb, kTestColors.white), 0u);
  const std::uint32_t wipe_end = loop.baked_ms() + 2 * loop.sequence_ms() - 1;
  loop.render(wipe_end, fb.data(), kTestColors);
  EXPECT_TRUE(count_color(fb, kTestColors.background) > 70000);  // wiped to blue before the loop restarts
}

void test_every_variant_renders_within_bounds() {
  HomeRunLoop loop;
  std::vector<std::uint16_t> fb(kPixels, 0);
  for (int e = 0; e < apple::display::kEntranceCount; ++e) {
    for (int h = 0; h < apple::display::kHoldCount; ++h) {
      for (int x = 0; x < apple::display::kExitCount; ++x) {
        loop.begin(Headline::HomeRun, "Francisco Lindor", 11);
        loop.set_override(PickOverride{static_cast<std::int8_t>(e), static_cast<std::int8_t>(h),
                                       static_cast<std::int8_t>(x)});
        for (std::uint32_t t = loop.baked_ms(); t < loop.loop_ms(); t += 150) {
          std::fill(fb.begin(), fb.end(), 0xBEEF);
          loop.render(t, fb.data(), kTestColors);
          EXPECT_EQ(count_color(fb, 0xBEEF), 0u);          // every pixel written
          for (std::size_t i = 0; i < kLogical; ++i)
            EXPECT_TRUE(loop.logical()[i] <= 6);
        }
      }
    }
  }
}

// Regression: while the big diamond zooms out during the headline pop, its bases
// leave the screen; every 10 ms of that window must render without touching
// memory outside the logical buffer (this once passed a negative length to memset).
void test_zooming_bases_off_screen_are_safe() {
  HomeRunLoop loop;
  loop.begin(Headline::HomeRun, "Juan Soto", 5);
  loop.set_override(PickOverride{0, 5, 0});
  std::vector<std::uint16_t> fb(kPixels + 64, 0xA5A5);   // guard words after the frame
  for (std::uint32_t t = loop.baked_ms(); t < loop.baked_ms() + loop.pop_ms() + 50; t += 10) {
    loop.render(t, fb.data(), kTestColors);
    for (std::size_t i = kPixels; i < fb.size(); ++i)
      EXPECT_EQ(fb[i], 0xA5A5u);
  }
}

void test_names_never_overflow_the_screen() {
  // Pop overshoot is dropped when it would exceed the 160 px screen.
  EXPECT_EQ(HomeRunLoop::pop_scale_for(5, 4, 28), 5);   // HOME at 5x = 140 px: keeps the punch
  EXPECT_EQ(HomeRunLoop::pop_scale_for(5, 4, 35), 4);   // GRAND at 5x = 175 px: holds at 4x
  EXPECT_EQ(HomeRunLoop::pop_scale_for(5, 2, 63), 2);   // FRANCISCO at 3x = 189 px: holds at 2x
  EXPECT_EQ(HomeRunLoop::pop_scale_for(5, 3, 40), 3);   // ALONSO at 4x = 160 px: would touch the edges
  EXPECT_EQ(HomeRunLoop::pop_scale_for(1, 4, 35), 1);   // never below 1

  HomeRunLoop loop;
  std::vector<std::uint16_t> fb(kPixels, 0);
  const char *names[] = {"Juan Soto", "Pete Alonso", "Francisco Lindor", "Jazz Chisholm Jr.",
                         "Isiah Kiner-Falefa", "Christopher Encarnacion-Strand",
                         "Supercalifragilisticexpialidocious", "X", "Jose De La Cruz Martinez"};
  for (const char *name : names) {
    loop.begin(Headline::HomeRun, name, 9);
    loop.set_override(PickOverride{0, 5, 0});             // pop entrance, still hold
    // Every tick of the name's pop and the start of its hold: no name pixel may touch
    // the outer 2 px of the panel (clipping), and settled text keeps its 4 px margins.
    const std::uint32_t start = loop.baked_ms() + loop.sequence_ms();
    for (std::uint32_t t = start; t < start + loop.pop_ms() + 200; t += 50) {
      loop.render(t, fb.data(), kTestColors);
      for (std::size_t y = 0; y < HomeRunLoop::kPanelHeight; ++y) {
        const std::uint16_t *row = fb.data() + y * HomeRunLoop::kPanelWidth;
        EXPECT_TRUE(row[0] != kTestColors.name && row[1] != kTestColors.name);
        EXPECT_TRUE(row[318] != kTestColors.name && row[319] != kTestColors.name);
        if (t >= start + loop.pop_ms()) {
          for (std::size_t x = 0; x < 4; ++x)
            EXPECT_TRUE(row[x] != kTestColors.name && row[319 - x] != kTestColors.name);
        }
      }
    }
    const TextFit &fit = loop.name();
    EXPECT_TRUE(fit.scale_x >= 1 && fit.scale_y >= fit.scale_x && fit.scale_y <= fit.scale_x + 1);
    EXPECT_TRUE(fit.widest_px * fit.scale_x <= HomeRunLoop::kMaxLineWidth);
    EXPECT_TRUE(std::strlen(fit.lines[0]) >= 1);
  }
}

// The render key changes once per baked frame (the source's 60/70 ms cadence), on
// every pop step, and every live tick through a hold, so a caller redraws exactly
// when the picture can change.
void test_render_key_follows_the_picture() {
  HomeRunLoop loop;
  loop.begin(Headline::HomeRun, "Juan Soto", 2);
  std::uint32_t changes = 0, last = loop.render_key(0);
  for (std::uint32_t t = 1; t < loop.baked_ms(); ++t) {
    const std::uint32_t k = loop.render_key(t);
    if (k != last) { ++changes; last = k; }
  }
  EXPECT_EQ(changes, 30u);                                   // 31 baked frames -> 30 boundaries
  // Pop: the key flips on every step boundary and holds still inside an entrance step.
  const std::uint32_t live = loop.baked_ms();
  std::uint32_t acc = 0;
  for (std::size_t k = 0; k < gen::kStepCount; ++k) {
    if (k > 0)
      EXPECT_TRUE(loop.render_key(live + acc) != loop.render_key(live + acc - 1));
    if (k < gen::kSettleStep)
      EXPECT_EQ(loop.render_key(live + acc + gen::kSteps[k].ms - 1), loop.render_key(live + acc));
    acc += gen::kSteps[k].ms;
  }
  // Hold: one change per live tick.
  changes = 0; last = loop.render_key(live + 1000);
  for (std::uint32_t t = live + 1001; t < live + 2000; ++t) {
    const std::uint32_t k = loop.render_key(t);
    if (k != last) { ++changes; last = k; }
  }
  EXPECT_EQ(changes, 1000u / HomeRunLoop::kLiveTickMs);
  EXPECT_TRUE(loop.render_key(loop.loop_ms()) != loop.render_key(0));   // next loop is distinct
}

// render() reports the panel rectangle that changed: nothing outside it differs,
// unchanged frames report nothing, and a fresh start or invalidate() reports it all.
void test_render_reports_the_changed_rectangle() {
  HomeRunLoop loop;
  loop.begin(Headline::HomeRun, "Juan Soto", 3);
  loop.set_override(PickOverride{0, 0, 1});                  // pop / wave / slide: plenty of motion
  std::vector<std::uint16_t> before(kPixels), after(kPixels);
  apple::display::DirtyRect r = loop.render(0, after.data(), kTestColors);
  EXPECT_EQ(r.x, 0);
  EXPECT_EQ(r.y, 0);
  EXPECT_EQ(r.w, 320);
  EXPECT_EQ(r.h, 240);

  std::size_t partial = 0, empty = 0, full = 0;
  for (std::uint32_t t = HomeRunLoop::kLiveTickMs; t < 2 * loop.loop_ms(); t += HomeRunLoop::kLiveTickMs) {
    before = after;
    r = loop.render(t, after.data(), kTestColors);
    for (std::size_t i = 0; i < kPixels; ++i) {
      if (before[i] == after[i])
        continue;
      const int x = static_cast<int>(i % HomeRunLoop::kPanelWidth);
      const int y = static_cast<int>(i / HomeRunLoop::kPanelWidth);
      if (r.empty() || x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h)
        fail("changed pixel outside the dirty rect at t=" + std::to_string(t), __LINE__);
    }
    if (r.empty())
      ++empty;
    else if (r.w == 320 && r.h == 240)
      ++full;
    else
      ++partial;
  }
  EXPECT_TRUE(partial > 100);   // text frames push a band, not the panel
  EXPECT_TRUE(empty > 10);      // rests and repeated frames push nothing
  EXPECT_TRUE(full >= 2);       // the flash frame swaps a color: whole panel, in and out

  loop.invalidate();
  r = loop.render(3000, after.data(), kTestColors);
  EXPECT_EQ(r.w, 320);
  EXPECT_EQ(r.h, 240);
}

}  // namespace

int main() {
  test_render_reports_the_changed_rectangle();
  test_render_key_follows_the_picture();
  test_names_never_overflow_the_screen();
  test_zooming_bases_off_screen_are_safe();
  test_timeline_matches_preview();
  test_name_normalization_and_fit();
  test_name_never_repeats_headline_picks();
  test_baked_frames_decode_and_flash();
  test_live_sequence_draws_words_and_wipes();
  test_every_variant_renders_within_bounds();
  std::cout << "PASS apple_home_run_loop_tests (10 scenarios, font "
            << apple::display::font_name() << ")\n";
  return 0;
}
