#include "apple_live/display/display.hpp"

#include "apple_live/display/celebration.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/psram.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/firmware/board_pins.hpp"

#include <Arduino.h>
#include <SPI.h>

#include <cstdint>

namespace apple::live {

using apple::firmware::ScreenModel;
using apple::firmware::ScreenPainter;
using apple::firmware::ScreenState;
using apple::firmware::kDarkBlue;
using apple::firmware::kDisplayBacklightPin;
using apple::firmware::kDisplayChipSelectPin;
using apple::firmware::kDisplayDataCommandPin;
using apple::firmware::kDisplayHeight;
using apple::firmware::kDisplayResetPin;
using apple::firmware::kDisplayWidth;

namespace {

constexpr std::uint32_t kRainFrameDurationMs = 150;
constexpr std::uint8_t kRainFrameCount = 6;
constexpr std::uint8_t kBacklightChannel = 4;  // LEDC channel for dimming the display
// Right after power-on the panel's supply may still be settling while the
// Nano has already sent its setup, so repeat it soon a few times (at about
// 2, 10 and 30 s) before dropping to the slow cadence.
constexpr std::uint32_t kPanelEarlyRefreshMs[] = {2000, 8000, 20000};

Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin, kDisplayResetPin);

}  // namespace

// The painter draws into this canvas, so the canvas is defined first.
GFXcanvas16 display(kDisplayWidth, kDisplayHeight);
ScreenModel model;

namespace {

ScreenPainter painter(display);

}  // namespace

apple::firmware::ScanLockedPanel* scan_lock = nullptr;
apple::display::HomeRunLoop* home_run_loop = nullptr;
apple::display::MetsWinLoop* mets_win_loop = nullptr;
bool backlight_on = true;
std::uint32_t next_panel_refresh_ms = 0;

namespace {

std::uint8_t panel_refreshes = 0;
bool needs_redraw = true;
std::uint8_t last_rain_frame = 0xFF;

// Brightness is a percent; the low end stays visible in a dark room.
std::uint32_t backlight_duty() {
  const std::uint32_t pct = settings.brightness < kBrightnessMin ? kBrightnessMin : settings.brightness;
  return pct >= 100 ? 255 : (pct * pct * 255) / 10000 + 6;  // gentle curve, never fully dark
}

}  // namespace

void begin_display() {
  scan_lock = make_in_psram<apple::firmware::ScanLockedPanel>(panel);
  home_run_loop = make_in_psram<apple::display::HomeRunLoop>();
  mets_win_loop = make_in_psram<apple::display::MetsWinLoop>();

  ledcSetup(kBacklightChannel, 5000, 8);
  ledcAttachPin(kDisplayBacklightPin, kBacklightChannel);
  ledcWrite(kBacklightChannel, 0);
  SPI.begin();
  panel.init(240, 320);
  panel.setRotation(1);
  panel.fillScreen(kDarkBlue);
}

void request_redraw() { needs_redraw = true; }

void render_if_needed() {
  if (celebration_active) return;
  const std::uint8_t rain_frame = static_cast<std::uint8_t>((now32() / kRainFrameDurationMs) % kRainFrameCount);
  const bool rain_changed = model.state == ScreenState::RainDelay && rain_frame != last_rain_frame;
  if (!needs_redraw && !rain_changed) return;
  painter.draw(model, rain_frame);
  if (model.state == ScreenState::RainDelay) last_rain_frame = rain_frame;
  panel.drawRGBBitmap(0, 0, display.getBuffer(), kDisplayWidth, kDisplayHeight);
  needs_redraw = false;
}

void apply_backlight() { ledcWrite(kBacklightChannel, backlight_on ? backlight_duty() : 0); }

void set_backlight(bool on) {
  if (backlight_on == on) return;
  backlight_on = on;
  apply_backlight();
  publish_trace("BACKLIGHT", on ? "on" : "off");
}

// Re-send the commands panel.init() used to wake the controller and turn the
// picture on, leaving the pixel format and orientation to whoever owns the
// panel next. A panel that reset or browned out on its side comes back; a
// healthy one shows nothing.
void wake_panel() {
  panel.enableSleep(false);  // SLPOUT
  delay(5);                  // the controller wants 5 ms after SLPOUT
  panel.invertDisplay(true);             // INVON, as init did
  panel.sendCommand(0x13);               // NORON
  panel.enableDisplay(true);             // DISPON
  apply_backlight();
}

// Every few minutes, wake the panel, put it back in the canvas's 16-bit
// landscape mode and repaint. Skipped during a celebration, which wakes the
// panel itself before taking it over.
void service_panel_refresh() {
  if (celebration_active || !due(next_panel_refresh_ms)) return;
  constexpr std::uint8_t kEarly = sizeof(kPanelEarlyRefreshMs) / sizeof(kPanelEarlyRefreshMs[0]);
  next_panel_refresh_ms = now32() + (panel_refreshes < kEarly ? kPanelEarlyRefreshMs[panel_refreshes] : kPanelRefreshMs);
  if (panel_refreshes < kEarly) ++panel_refreshes;
  wake_panel();
  std::uint8_t colmod = 0x55;
  panel.sendCommand(0x3A, &colmod, 1);  // 16-bit colour
  panel.setRotation(1);                  // MADCTL for landscape
  request_redraw();
}

}  // namespace apple::live
