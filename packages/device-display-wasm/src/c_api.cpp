#include "apple/display/home_run_loop.hpp"
#include "apple/display/mets_win_loop.hpp"

#include <array>
#include <cstddef>
#include <cstdint>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define APPLE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define APPLE_EXPORT
#endif

namespace {

enum class Mode : std::uint8_t { HomeRun = 0, MetsWin = 1 };

struct DisplayHandle {
  apple::display::HomeRunLoop home_run;
  apple::display::MetsWinLoop mets_win;
  std::array<std::uint16_t, apple::display::kPanelWidth * apple::display::kPanelHeight> framebuffer{};
  Mode mode{Mode::HomeRun};
};

DisplayHandle *as_handle(void *raw) { return static_cast<DisplayHandle *>(raw); }

const DisplayHandle *as_handle(const void *raw) {
  return static_cast<const DisplayHandle *>(raw);
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

} // extern "C"
