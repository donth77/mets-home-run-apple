#include "apple/display/home_run_loop.hpp"
#include "apple/display/mets_win_loop.hpp"
#include "apple/firmware/screens.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define APPLE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define APPLE_EXPORT
#endif

namespace {

enum class Mode : std::uint8_t { HomeRun = 0, MetsWin = 1 };

struct DisplayHandle {
  DisplayHandle()
      : screen_canvas(apple::firmware::kDisplayWidth,
                      apple::firmware::kDisplayHeight),
        screen_painter(screen_canvas) {}

  apple::display::HomeRunLoop home_run;
  apple::display::MetsWinLoop mets_win;
  std::array<std::uint16_t, apple::display::kPanelWidth * apple::display::kPanelHeight> framebuffer{};
  Mode mode{Mode::HomeRun};
  GFXcanvas16 screen_canvas;
  apple::firmware::ScreenModel screen_model;
  apple::firmware::ScreenPainter screen_painter;
};

DisplayHandle *as_handle(void *raw) { return static_cast<DisplayHandle *>(raw); }

const DisplayHandle *as_handle(const void *raw) {
  return static_cast<const DisplayHandle *>(raw);
}

void copy_ascii(char *destination, std::size_t capacity, const char *source,
                bool uppercase = false) {
  if (capacity == 0) return;
  std::size_t written = 0;
  const auto put = [&](char value) {
    if (written + 1 >= capacity) return;
    if (uppercase && value >= 'a' && value <= 'z') {
      value = static_cast<char>(value - 'a' + 'A');
    }
    destination[written++] = value;
  };

  if (source != nullptr) {
    for (const auto *at = reinterpret_cast<const unsigned char *>(source);
         *at != '\0';) {
      if (*at < 0x80) {
        put(static_cast<char>(*at++));
        continue;
      }
      if (at[0] == 0xE2 && at[1] == 0x80 &&
          (at[2] == 0x93 || at[2] == 0x94)) {
        put('-');
        at += 3;
        continue;
      }
      if (at[0] == 0xC2 && at[1] == 0xB7) {
        put('-');
        at += 2;
        continue;
      }
      if (at[0] == 0xC3 && at[1] != '\0') {
        static constexpr char kFold[] =
            "AAAAAAACEEEEIIIIDNOOOOOxOUUUUYTsaaaaaaaceeeeiiiidnooooo/"
            "ouuuuyty";
        const unsigned index = at[1] - 0x80;
        put(index < sizeof(kFold) - 1 ? kFold[index] : '?');
        at += 2;
        continue;
      }
      put('?');
      ++at;
      while ((*at & 0xC0U) == 0x80U) ++at;
    }
  }
  destination[written] = '\0';
}

const char *half_label(unsigned half) {
  switch (half) {
    case 0:
      return "TOP";
    case 1:
      return "BOT";
    case 2:
      return "MID";
    default:
      return "END";
  }
}

} // namespace

extern "C" {

APPLE_EXPORT void *apple_display_create() { return new DisplayHandle(); }

APPLE_EXPORT void apple_display_destroy(void *raw) { delete as_handle(raw); }

APPLE_EXPORT int apple_display_begin_home_run(void *raw, int grand_slam,
                                               const char *batter,
                                               std::uint32_t seed) {
  auto *handle = as_handle(raw);
  if (handle == nullptr)
    return 0;
  handle->mode = Mode::HomeRun;
  handle->home_run.begin(grand_slam != 0 ? apple::display::Headline::GrandSlam
                                         : apple::display::Headline::HomeRun,
                         batter == nullptr ? "" : batter, seed);
  return 1;
}

APPLE_EXPORT int apple_display_begin_mets_win(
    void *raw, const char *away, unsigned away_runs, const char *home,
    unsigned home_runs, int mets_home, std::uint32_t seed) {
  auto *handle = as_handle(raw);
  if (handle == nullptr)
    return 0;
  handle->mode = Mode::MetsWin;
  handle->mets_win.begin(away == nullptr ? "" : away, away_runs,
                         home == nullptr ? "" : home, home_runs,
                         mets_home != 0, seed);
  return 1;
}

APPLE_EXPORT const std::uint16_t *apple_display_render(void *raw,
                                                       std::uint32_t elapsed_ms) {
  auto *handle = as_handle(raw);
  if (handle == nullptr)
    return nullptr;
  if (handle->mode == Mode::MetsWin) {
    handle->mets_win.render(elapsed_ms, handle->framebuffer.data(),
                            apple::display::default_mets_win_colors());
  } else {
    handle->home_run.render(elapsed_ms, handle->framebuffer.data(),
                            apple::display::default_colors());
  }
  return handle->framebuffer.data();
}

APPLE_EXPORT std::uint32_t apple_display_render_key(const void *raw,
                                                    std::uint32_t elapsed_ms) {
  const auto *handle = as_handle(raw);
  if (handle == nullptr)
    return 0;
  return handle->mode == Mode::MetsWin
             ? handle->mets_win.render_key(elapsed_ms)
             : handle->home_run.render_key(elapsed_ms);
}

APPLE_EXPORT std::uint32_t apple_display_loop_ms(const void *raw) {
  const auto *handle = as_handle(raw);
  if (handle == nullptr)
    return 0;
  return handle->mode == Mode::MetsWin ? handle->mets_win.loop_ms()
                                       : handle->home_run.loop_ms();
}

APPLE_EXPORT const std::uint16_t *apple_display_framebuffer(const void *raw) {
  const auto *handle = as_handle(raw);
  return handle == nullptr ? nullptr : handle->framebuffer.data();
}

APPLE_EXPORT int apple_display_set_screen(
    void *raw, unsigned screen_state, unsigned game_number, const char *away,
    unsigned away_runs, const char *home, unsigned home_runs, unsigned final_result,
    unsigned inning, unsigned half,
    unsigned outs, unsigned occupied_bases, unsigned balls,
    unsigned strikes, const char *batter, const char *batter_line,
    const char *pitcher, unsigned pitch_count, const char *event,
    const char *venue, const char *date, const char *time,
    const char *timezone, const char *season) {
  auto *handle = as_handle(raw);
  if (handle == nullptr ||
      screen_state < static_cast<unsigned>(apple::firmware::ScreenState::Game) ||
      screen_state > static_cast<unsigned>(apple::firmware::ScreenState::Final)) {
    return 0;
  }

  auto &model = handle->screen_model;
  model = apple::firmware::ScreenModel{};
  model.state = static_cast<apple::firmware::ScreenState>(screen_state);

  auto &game = model.game;
  copy_ascii(game.away, sizeof(game.away), away, true);
  copy_ascii(game.home, sizeof(game.home), home, true);
  game.away_score = static_cast<std::uint16_t>(away_runs);
  game.home_score = static_cast<std::uint16_t>(home_runs);
  std::snprintf(game.inning, sizeof(game.inning), "%s %u", half_label(half),
                inning);
  game.outs = static_cast<std::uint8_t>(outs);
  game.occupied_bases = static_cast<std::uint8_t>(occupied_bases);
  game.balls = static_cast<std::uint8_t>(balls);
  game.strikes = static_cast<std::uint8_t>(strikes);
  copy_ascii(game.batter, sizeof(game.batter), batter);
  copy_ascii(game.batter_line, sizeof(game.batter_line), batter_line);
  copy_ascii(game.pitcher, sizeof(game.pitcher), pitcher);
  game.pitch_count = static_cast<std::uint16_t>(pitch_count);
  copy_ascii(game.event, sizeof(game.event), event);
  copy_ascii(game.venue, sizeof(game.venue), venue);
  game.valid = true;

  auto &upcoming = model.upcoming;
  upcoming.game_number = static_cast<std::uint8_t>(game_number);
  copy_ascii(upcoming.away, sizeof(upcoming.away), away, true);
  copy_ascii(upcoming.home, sizeof(upcoming.home), home, true);
  copy_ascii(upcoming.date, sizeof(upcoming.date), date, true);
  copy_ascii(upcoming.time, sizeof(upcoming.time), time, true);
  copy_ascii(upcoming.timezone, sizeof(upcoming.timezone), timezone, true);
  copy_ascii(upcoming.venue, sizeof(upcoming.venue), venue);

  auto &final_game = model.final_game;
  copy_ascii(final_game.away, sizeof(final_game.away), away, true);
  copy_ascii(final_game.home, sizeof(final_game.home), home, true);
  final_game.away_score = static_cast<std::uint16_t>(away_runs);
  final_game.home_score = static_cast<std::uint16_t>(home_runs);
  const char *result = final_result == 1 ? "METS_WIN"
                       : final_result == 2 ? "METS_LOSS"
                       : final_result == 3 ? "TIE"
                                           : "";
  copy_ascii(final_game.result, sizeof(final_game.result), result);
  copy_ascii(final_game.venue, sizeof(final_game.venue), venue);

  copy_ascii(model.offseason_season, sizeof(model.offseason_season), season,
             true);
  copy_ascii(model.delay_detail, sizeof(model.delay_detail),
             "WAITING FOR UPDATE");
  copy_ascii(model.state_detail, sizeof(model.state_detail),
             "WAITING FOR UPDATE");
  return 1;
}

APPLE_EXPORT const std::uint16_t *apple_display_render_screen(
    void *raw, unsigned rain_frame) {
  auto *handle = as_handle(raw);
  if (handle == nullptr) return nullptr;
  handle->screen_painter.draw(handle->screen_model,
                              static_cast<std::uint8_t>(rain_frame));
  return handle->screen_canvas.getBuffer();
}

} // extern "C"
