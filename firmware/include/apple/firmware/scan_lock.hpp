#pragma once

#include "apple/display/home_run_loop.hpp"

#include <Adafruit_ST7789.h>
#include <Arduino.h>

#include <cstdint>

namespace apple::firmware {

// Tear-free pushes for a panel with no tearing-effect pin.
//
// The panel refreshes its 320 gate lines (landscape x) at a fixed line rate.
// A write can never be *started* in step with that refresh without the TE
// pin, but it can move *with* it: walking the same lines in the same order at
// the same rate never crosses the refresh sweep, whatever phase it starts at.
// Two settings make the SPI keep up: FRCTRL2 slows the refresh to its slowest
// setting (39 Hz, ~75 us per line) and 12-bit colour brings a 240-pixel line
// under that on the FIFO path (~62 us). The celebration art is eight flat
// colours, so 12-bit loses nothing. The frame is transposed into the panel's
// native order and each line is released on a software line clock.
//
// The residual mismatch is the panel oscillator's tolerance; set_line_ns()
// trims it (the display test binds '[' and ']'). enter() switches the panel
// over and leave() restores the landscape rotation, 60 Hz and 16-bit colour
// for the ordinary canvas pushes.
class ScanLockedPanel {
public:
  static constexpr std::uint8_t kRtnaLocked = 0x1F;    // FRCTRL2: 39 Hz nominal
  static constexpr std::uint8_t kRtnaDefault = 0x0F;   // 60 Hz
  static constexpr std::uint8_t kColmod12 = 0x53;
  static constexpr std::uint8_t kColmod16 = 0x55;
  static constexpr int kRows = 320;                    // gate lines = landscape x
  static constexpr int kCols = 240;                    // source lines = landscape y
  static constexpr int kRowBytes = kCols * 3 / 2;      // 12-bit: two pixels per three bytes
  // (2 x RTNA + 32) periods of the panel's ~1.25 MHz frame clock.
  static constexpr std::uint32_t kDefaultLineNs = 75'200;

  explicit ScanLockedPanel(Adafruit_ST7789& panel) : panel_(panel) {}

  bool active() const { return active_; }
  bool flip_refresh() const { return flip_refresh_; }
  std::uint32_t line_ns() const { return line_ns_; }
  void set_line_ns(std::uint32_t ns) { line_ns_ = ns; }
  // MADCTL ML: reverse the panel's refresh direction, should a panel scan the
  // other way from the write order.
  void set_flip_refresh(bool flip) {
    flip_refresh_ = flip;
    if (active_) {
      apply_madctl();
    }
  }

  // Switch the panel into the locked mode. `landscape_rotation` is the Adafruit
  // rotation (1 or 3) the canvas is drawn for; leave() restores it.
  void enter(std::uint8_t landscape_rotation) {
    rotation_ = landscape_rotation;
    reverse_ = landscape_rotation == 1;   // MY|MV: landscape x runs against the gate lines
    if (active_) {
      return;
    }
    panel_.setRotation(2);                // portrait addressing: rows are gate lines
    apply_madctl();
    std::uint8_t v = kRtnaLocked;
    panel_.sendCommand(0xC6, &v, 1);
    v = kColmod12;
    panel_.sendCommand(0x3A, &v, 1);
    active_ = true;
    Serial.printf("SCAN_LOCK=ON line_ns=%lu ml=%d\n", static_cast<unsigned long>(line_ns_),
                  flip_refresh_ ? 1 : 0);
  }

  void leave() {
    if (!active_) {
      return;
    }
    std::uint8_t v = kColmod16;
    panel_.sendCommand(0x3A, &v, 1);
    v = kRtnaDefault;
    panel_.sendCommand(0xC6, &v, 1);
    panel_.setRotation(rotation_);
    active_ = false;
    Serial.println("SCAN_LOCK=OFF");
  }

  // Push one rectangle of a landscape RGB565 canvas (`stride` pixels per row).
  void push(const std::uint16_t* fb, int stride, const apple::display::DirtyRect& rect) {
    if (!active_ || rect.empty()) {
      return;
    }
    const NativeRect n = native_rect(rect);
    pack(fb, stride, n);
    push_native(n);
  }

private:
  struct NativeRect {
    int r0, r1, c0, c1;
  };

  static std::uint16_t to444(std::uint16_t c) {
    return static_cast<std::uint16_t>(((c >> 12) << 8) | (((c >> 7) & 0xF) << 4) |
                                      ((c >> 1) & 0xF));
  }

  // Landscape rect -> native rows/columns. Columns are widened to multiples of
  // four so every row is whole 12-bit pixel pairs and an even byte count.
  NativeRect native_rect(const apple::display::DirtyRect& d) const {
    const int x1 = d.x + d.w - 1, y1 = d.y + d.h - 1;
    NativeRect n;
    n.r0 = reverse_ ? kRows - 1 - x1 : d.x;
    n.r1 = reverse_ ? kRows - 1 - d.x : x1;
    n.c0 = reverse_ ? d.y : kCols - 1 - y1;
    n.c1 = reverse_ ? y1 : kCols - 1 - d.y;
    n.c0 &= ~3;
    n.c1 |= 3;
    return n;
  }

  // Transpose and pack the rect out of the landscape canvas.
  void pack(const std::uint16_t* fb, int stride, const NativeRect& n) {
    for (int r = n.r0; r <= n.r1; ++r) {
      const int x = reverse_ ? kRows - 1 - r : r;
      std::uint8_t* out = native_ + r * kRowBytes + (n.c0 * 3) / 2;
      for (int c = n.c0; c <= n.c1; c += 2) {
        const int ya = reverse_ ? c : kCols - 1 - c;
        const int yb = reverse_ ? c + 1 : kCols - 2 - c;
        const std::uint16_t a = to444(fb[ya * stride + x]);
        const std::uint16_t b = to444(fb[yb * stride + x]);
        *out++ = static_cast<std::uint8_t>(a >> 4);
        *out++ = static_cast<std::uint8_t>(((a & 0xF) << 4) | (b >> 8));
        *out++ = static_cast<std::uint8_t>(b & 0xFF);
      }
    }
  }

  // Push the rect one gate line per panel line-time.
  void push_native(const NativeRect& n) {
    const int cols = n.c1 - n.c0 + 1;
    const std::uint32_t bytes = static_cast<std::uint32_t>(cols) * 3 / 2;
    panel_.startWrite();
    panel_.setAddrWindow(static_cast<std::uint16_t>(n.c0), static_cast<std::uint16_t>(n.r0),
                         static_cast<std::uint16_t>(cols),
                         static_cast<std::uint16_t>(n.r1 - n.r0 + 1));
    const std::uint32_t t0 = micros();
    std::uint64_t due_ns = 0;
    for (int r = n.r0; r <= n.r1; ++r) {
      while (static_cast<std::uint64_t>(micros() - t0) * 1000ULL < due_ns) {
      }
      panel_.writePixels(reinterpret_cast<std::uint16_t*>(native_ + r * kRowBytes + (n.c0 * 3) / 2),
                         bytes / 2, true, true);
      due_ns += line_ns_;
    }
    panel_.endWrite();
  }

  void apply_madctl() {
    std::uint8_t m = flip_refresh_ ? 0x10 : 0x00;   // portrait, no mirror (+ ML)
    panel_.sendCommand(0x36, &m, 1);
  }

  Adafruit_ST7789& panel_;
  std::uint8_t native_[kRows * kRowBytes]{};        // the frame in the panel's own order
  bool active_{false};
  bool flip_refresh_{false};
  bool reverse_{true};
  std::uint8_t rotation_{1};
  std::uint32_t line_ns_{kDefaultLineNs};
};

}  // namespace apple::firmware
