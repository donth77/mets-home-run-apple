#pragma once

// The panel: an ST7789 driven from a 16-bit canvas, the screen model the rest
// of the firmware fills in, the celebration renderers' frame buffers, and the
// backlight.

#include "apple/display/home_run_loop.hpp"
#include "apple/display/mets_win_loop.hpp"
#include "apple/firmware/scan_lock.hpp"
#include "apple/firmware/screens.hpp"

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>

#include <cstdint>

namespace apple::live {

// The panel is write-only, so if it resets or browns out on its side (a
// marginal wire on RST, 3V3 or the clock) it goes dark while the Nano keeps
// drawing into it. Re-asserting its setup this often makes such a panel
// recover on its own; on a healthy panel the commands change nothing visible.
constexpr std::uint32_t kPanelRefreshMs = 5 * 60 * 1000;

extern GFXcanvas16 display;
extern apple::firmware::ScreenModel model;  // what the next redraw shows
extern apple::firmware::ScanLockedPanel* scan_lock;
extern apple::display::HomeRunLoop* home_run_loop;
extern apple::display::MetsWinLoop* mets_win_loop;
extern bool backlight_on;
extern std::uint32_t next_panel_refresh_ms;

// Puts the frame buffers in PSRAM and starts the panel with the backlight off.
void begin_display();
void request_redraw();
void render_if_needed();
void apply_backlight();
void set_backlight(bool on);
void wake_panel();
void service_panel_refresh();

}  // namespace apple::live
