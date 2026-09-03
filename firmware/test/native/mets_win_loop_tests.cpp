#include "apple/display/generated/home_run_frames.hpp"
#include "apple/display/mets_win_loop.hpp"

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

namespace {

using apple::display::CardEntrance;
using apple::display::CardExit;
using apple::display::DirtyRect;
using apple::display::Entrance;
using apple::display::Exit;
using apple::display::LogoEntrance;
using apple::display::MetsWinColors;
using apple::display::MetsWinLoop;
using apple::display::MetsWinOverride;
using apple::display::MetsWinPicks;
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
    static_cast<std::size_t>(apple::display::kPanelWidth) * apple::display::kPanelHeight;
constexpr std::size_t kLogical = apple::display::kLogicalPixels;

// Distinct colors per role so a frame's role usage can be read back from RGB565.
const MetsWinColors kTestColors{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14};

std::size_t count_role(const MetsWinLoop &loop, std::uint8_t role) {
  std::size_t n = 0;
  for (std::size_t i = 0; i < kLogical; ++i)
    n += loop.logical()[i] == role;
  return n;
}

void test_timeline_matches_preview() {
  MetsWinLoop loop;
  loop.begin("NYM", 6, "ATL", 3, false, 1);
  EXPECT_EQ(loop.logo_ms(), 5000u);
  EXPECT_EQ(loop.text_ms(), 3807u);          // 938 pop + 2000 hold + 400 exit + 469 wipe
  EXPECT_EQ(loop.card_ms(), 4738u);          // 938 + 3200 + 400 + 200 tail
  EXPECT_EQ(loop.loop_ms(), 13545u);
  EXPECT_EQ(loop.loop_index(13544), 0u);
  EXPECT_EQ(loop.loop_index(13545), 1u);
  EXPECT_TRUE(std::strcmp(loop.away(), "NYM") == 0);
  EXPECT_TRUE(std::strcmp(loop.home(), "ATL") == 0);
  EXPECT_EQ(loop.away_runs(), 6u);
  EXPECT_EQ(loop.home_runs(), 3u);
  loop.begin("nym", 120, "", 7, true, 1);    // normalized team, capped runs, empty home
  EXPECT_TRUE(std::strcmp(loop.away(), "NYM") == 0);
  EXPECT_TRUE(std::strcmp(loop.home(), "HME") == 0);
  EXPECT_EQ(loop.away_runs(), 99u);
}

void test_logo_decodes_cleanly() {
  MetsWinLoop loop;
  std::size_t counts[4] = {0, 0, 0, 0};
  for (int i = 0; i < MetsWinLoop::kLogoWidth * MetsWinLoop::kLogoHeight; ++i) {
    EXPECT_TRUE(loop.logo()[i] <= 3);
    ++counts[loop.logo()[i]];
  }
  EXPECT_EQ(counts[0] + counts[1] + counts[2] + counts[3], 12100u);
  EXPECT_TRUE(counts[1] > 3000 && counts[2] > 3000 && counts[3] > 1500);   // blue, white, orange
  // The roundel is a disc: corners clear, centre painted, edge rows short.
  EXPECT_EQ(static_cast<int>(loop.logo()[0]), 0);
  EXPECT_EQ(static_cast<int>(loop.logo()[MetsWinLoop::kLogoWidth - 1]), 0);
  EXPECT_TRUE(loop.logo()[55 * MetsWinLoop::kLogoWidth + 55] != 0);
  // At full size on the sky the logo covers x 25..134, y 5..114 and nothing outside.
  loop.begin("NYM", 6, "ATL", 3, false, 1);
  loop.set_override(MetsWinOverride{0, 0, 0, -1, -1, -1, -1, -1});   // flash / still / flash
  loop.set_fireworks(false);
  std::vector<std::uint16_t> fb(kPixels);
  loop.render(2000, fb.data(), kTestColors);
  for (std::size_t i = 0; i < kLogical; ++i) {
    const int x = static_cast<int>(i % apple::display::kLogicalWidth);
    const int y = static_cast<int>(i / apple::display::kLogicalWidth);
    const bool inside = x >= 25 && x <= 134 && y >= 5 && y <= 114;
    if (!inside)
      EXPECT_EQ(static_cast<int>(loop.logical()[i]), 0);
  }
  EXPECT_TRUE(count_role(loop, 3) > 3000 && count_role(loop, 2) > 3000 && count_role(loop, 4) > 1500);
}

void test_score_scale_and_card_layout() {
  const bool match7 = std::strcmp(apple::display::font_name(), "Match 7") == 0;
  if (match7) {
    EXPECT_EQ(MetsWinLoop::score_scale("NYM", 6, "ATL", 3), 4);
    EXPECT_EQ(MetsWinLoop::score_scale("NYM", 12, "PHI", 11), 4);
    EXPECT_EQ(MetsWinLoop::score_scale("SD", 0, "NYM", 1), 4);
  }
  EXPECT_TRUE(MetsWinLoop::score_scale("NYM", 6, "ATL", 3) >= 3);
  // The card frame: FINAL, the Mets line orange, the opponent white, the call gold,
  // all inside the margins.
  MetsWinLoop loop;
  loop.begin("NYM", 6, "ATL", 3, false, 1);
  loop.set_fireworks(false);
  std::vector<std::uint16_t> fb(kPixels);
  loop.render(loop.logo_ms() + loop.text_ms() + 2000, fb.data(), kTestColors);
  EXPECT_TRUE(count_role(loop, 13) > 30);   // FINAL label
  EXPECT_TRUE(count_role(loop, 4) > 200);   // NYM 6 in orange
  EXPECT_TRUE(count_role(loop, 2) > 200);   // ATL 3 in white
  EXPECT_TRUE(count_role(loop, 6) > 60);    // the call
  // Both the private Match 7 font and the wider public fallback paint the
  // trailing exclamation point through this logical pixel.
  EXPECT_EQ(static_cast<int>(loop.logical()[104 * apple::display::kLogicalWidth + 146]), 6);
  for (std::size_t y = 0; y < apple::display::kPanelHeight; ++y) {
    const std::uint16_t *row = fb.data() + y * apple::display::kPanelWidth;
    for (std::size_t x = 0; x < 4; ++x) {
      EXPECT_EQ(row[x], kTestColors.sky);
      EXPECT_EQ(row[apple::display::kPanelWidth - 1 - x], kTestColors.sky);
    }
  }
  // Mets at home: the colours swap lines.
  loop.begin("PHI", 2, "NYM", 4, true, 1);
  loop.render(loop.logo_ms() + loop.text_ms() + 2000, fb.data(), kTestColors);
  std::size_t orange_top = 0, orange_bottom = 0;
  for (std::size_t i = 0; i < kLogical; ++i) {
    if (loop.logical()[i] != 4)
      continue;
    if (i / apple::display::kLogicalWidth < 60) ++orange_top; else ++orange_bottom;
  }
  EXPECT_TRUE(orange_bottom > orange_top);
}

void test_picks_never_repeat_across_beats() {
  MetsWinLoop loop;
  static constexpr int kFamily[4] = {0, 2, 3, 1};   // logo flash/drop/spin/slide -> text pop/drop/spin/slide
  for (std::uint32_t seed = 0; seed < 50; ++seed) {
    loop.begin("NYM", 6, "ATL", 3, false, seed * 2654435761u);
    bool varied_logo = false;
    const MetsWinPicks first = loop.picks_for_loop(0);
    for (std::uint32_t n = 0; n < 40; ++n) {
      const MetsWinPicks p = loop.picks_for_loop(n);
      EXPECT_TRUE(static_cast<int>(p.text.entrance) != kFamily[static_cast<int>(p.logo.entrance)]);
      const int text_e = static_cast<int>(p.text.entrance);           // pop 0, slide 1, drop 2
      if (text_e <= 2)
        EXPECT_TRUE(static_cast<int>(p.card.entrance) != text_e);      // card pop 0, slide 1, drop 2
      const int text_x = static_cast<int>(p.text.exit);               // slide 1, drop 2, shrink 4
      const int card_x = static_cast<int>(p.card.exit);               // slide 0, drop 1, shrink 2
      EXPECT_TRUE(!(text_x == 1 && card_x == 0) && !(text_x == 2 && card_x == 1) && !(text_x == 4 && card_x == 2));
      if (p.logo.entrance != first.logo.entrance || p.logo.exit != first.logo.exit)
        varied_logo = true;
    }
    EXPECT_TRUE(varied_logo);
  }
  loop.set_override(MetsWinOverride{2, 1, 3, 4, 0, 5, 1, 2});
  const MetsWinPicks pinned = loop.picks_for_loop(7);
  EXPECT_TRUE(pinned.logo.entrance == LogoEntrance::Spin);
  EXPECT_TRUE(pinned.text.entrance == Entrance::Type);
  EXPECT_TRUE(pinned.text.exit == Exit::Twirl);
  EXPECT_TRUE(pinned.card.entrance == CardEntrance::Slide);
  EXPECT_TRUE(pinned.card.exit == CardExit::Shrink);
}

// Every variant of every slot renders inside the panel: guard words after the
// framebuffer stay untouched and roles stay in range.
void test_every_variant_renders_within_bounds() {
  MetsWinLoop loop;
  std::vector<std::uint16_t> fb(kPixels + 64, 0xA5A5);
  const int counts[8] = {4, 3, 4, 5, 6, 6, 3, 3};
  for (int slot = 0; slot < 8; ++slot) {
    for (int key = 0; key < counts[slot]; ++key) {
      MetsWinOverride o;
      std::int8_t *fields[8] = {&o.logo_entrance, &o.logo_hold, &o.logo_exit, &o.text_entrance,
                                &o.text_hold, &o.text_exit, &o.card_entrance, &o.card_exit};
      *fields[slot] = static_cast<std::int8_t>(key);
      loop.begin("NYM", 12, "PHI", 11, slot % 2 == 0, 3u + slot);
      loop.set_override(o);
      for (std::uint32_t t = 0; t < loop.loop_ms(); t += 37) {
        loop.render(t, fb.data(), kTestColors);
        for (std::size_t i = 0; i < kLogical; ++i)
          EXPECT_TRUE(loop.logical()[i] <= 13);
      }
      for (std::size_t i = kPixels; i < fb.size(); ++i)
        EXPECT_EQ(fb[i], 0xA5A5u);
    }
  }
}

void test_fireworks_and_beats_draw() {
  MetsWinLoop loop;
  loop.begin("NYM", 6, "ATL", 3, false, 5);
  loop.set_override(MetsWinOverride{0, 0, 3, 0, 5, 0, 0, 0});   // still logo, still words
  std::vector<std::uint16_t> fb(kPixels);
  // Fireworks light the sky during the logo hold ...
  std::size_t sparks = 0;
  for (std::uint32_t t = 1500; t < 4500; t += 25) {
    loop.render(t, fb.data(), kTestColors);
    for (std::uint8_t role = 8; role <= 12; ++role)
      sparks += count_role(loop, role);
  }
  EXPECT_TRUE(sparks > 500);
  // ... and never during METS WIN!, which is only words on the field.
  std::size_t off_field = 0;
  for (std::uint32_t t = loop.logo_ms() + 1000; t < loop.logo_ms() + 2900; t += 100) {
    loop.render(t, fb.data(), kTestColors);
    for (std::size_t i = 0; i < kLogical; ++i) {
      const std::uint8_t r = loop.logical()[i];
      if (r != 1 && r != 2 && r != 5)
        ++off_field;
    }
  }
  EXPECT_EQ(off_field, 0u);
  EXPECT_TRUE(count_role(loop, 2) > 300);     // METS WIN! in white
  // The flash entrance's first step is a quarter-size white silhouette, not a strobe.
  loop.render(0, fb.data(), kTestColors);
  EXPECT_TRUE(count_role(loop, 7) > 200 && count_role(loop, 7) < 1200);
  // Switching fireworks off leaves a still hold frame static.
  loop.set_fireworks(false);
  loop.render(2000, fb.data(), kTestColors);
  const DirtyRect r = loop.render(2025, fb.data(), kTestColors);
  EXPECT_TRUE(r.empty());
}

// The loop resets on the sky it ended on: whatever the picks, the first tick of a
// new loop changes only a small part of the panel.
void test_loop_boundary_is_seamless() {
  MetsWinLoop loop;
  std::vector<std::uint16_t> fb(kPixels);
  for (int entrance = 0; entrance < 4; ++entrance) {
    for (int exit = 0; exit < 3; ++exit) {
      loop.begin("NYM", 6, "ATL", 3, false, 11u + entrance);
      loop.set_override(MetsWinOverride{static_cast<std::int8_t>(entrance), -1, -1, -1, -1, -1, -1,
                                        static_cast<std::int8_t>(exit)});
      // Compare pixels, not the dirty rectangle: scattered sparks span a wide box.
      std::vector<std::uint16_t> before(kPixels);
      loop.render(loop.loop_ms() - MetsWinLoop::kLiveTickMs, before.data(), kTestColors);
      loop.render(loop.loop_ms(), fb.data(), kTestColors);
      std::size_t changed = 0;
      for (std::size_t i = 0; i < kPixels; ++i)
        changed += before[i] != fb[i];
      EXPECT_TRUE(changed < kPixels / 10);
    }
  }
}

// render() reports the panel rectangle that changed; nothing outside it differs.
void test_render_reports_the_changed_rectangle() {
  MetsWinLoop loop;
  loop.begin("NYM", 6, "ATL", 3, false, 3);
  std::vector<std::uint16_t> before(kPixels), after(kPixels);
  DirtyRect r = loop.render(0, after.data(), kTestColors);
  EXPECT_EQ(r.w, 320);
  EXPECT_EQ(r.h, 240);
  std::size_t partial = 0;
  for (std::uint32_t t = MetsWinLoop::kLiveTickMs; t < 2 * loop.loop_ms(); t += MetsWinLoop::kLiveTickMs) {
    before = after;
    r = loop.render(t, after.data(), kTestColors);
    for (std::size_t i = 0; i < kPixels; ++i) {
      if (before[i] == after[i])
        continue;
      const int x = static_cast<int>(i % apple::display::kPanelWidth);
      const int y = static_cast<int>(i / apple::display::kPanelWidth);
      if (r.empty() || x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h)
        fail("changed pixel outside the dirty rect at t=" + std::to_string(t), __LINE__);
    }
    if (!r.empty() && (r.w < 320 || r.h < 240))
      ++partial;
  }
  EXPECT_TRUE(partial > 200);
  loop.invalidate();
  r = loop.render(3000, after.data(), kTestColors);
  EXPECT_EQ(r.w, 320);
}

// The key changes every live tick and on every entrance step boundary.
void test_render_key_follows_the_picture() {
  MetsWinLoop loop;
  loop.begin("NYM", 6, "ATL", 3, false, 2);
  std::uint32_t acc = 0;
  for (std::size_t k = 1; k < gen::kStepCount; ++k) {
    acc += gen::kSteps[k - 1].ms;
    EXPECT_TRUE(loop.render_key(acc) != loop.render_key(acc - 1));                           // logo entrance
    EXPECT_TRUE(loop.render_key(loop.logo_ms() + acc) != loop.render_key(loop.logo_ms() + acc - 1));   // words
  }
  std::uint32_t changes = 0, last = loop.render_key(2000);
  for (std::uint32_t t = 2001; t < 3000; ++t) {
    const std::uint32_t key = loop.render_key(t);
    if (key != last) { ++changes; last = key; }
  }
  EXPECT_EQ(changes, 39u);          // the 25 ms ticks strictly inside (2000, 3000)
  EXPECT_TRUE(loop.render_key(loop.loop_ms()) != loop.render_key(0));
}

}  // namespace

int main() {
  test_timeline_matches_preview();
  test_logo_decodes_cleanly();
  test_score_scale_and_card_layout();
  test_picks_never_repeat_across_beats();
  test_every_variant_renders_within_bounds();
  test_fireworks_and_beats_draw();
  test_loop_boundary_is_seamless();
  test_render_reports_the_changed_rectangle();
  test_render_key_follows_the_picture();
  std::cout << "PASS apple_mets_win_loop_tests (9 scenarios, font "
            << apple::display::font_name() << ")\n";
  return 0;
}
