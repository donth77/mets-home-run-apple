#pragma once

// Minimal browser-build compatibility layer for the subset of Adafruit GFX
// used by firmware/lib/device_screens. The drawing algorithms and classic
// 5x7 font follow Adafruit GFX 1.12.1 so ScreenPainter produces the same
// RGB565 framebuffer in WebAssembly and on the Nano.
//
// Software License Agreement (BSD License)
// Copyright (c) 2012 Adafruit Industries. All rights reserved.
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
// 1. Redistributions of source code must retain the above copyright notice,
//    this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
// 3. Neither the name of the copyright holder nor the names of its
//    contributors may be used to endorse or promote products derived from
//    this software without specific prior written permission.
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

#include <stdint.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <utility>
#include <vector>

// Custom-font structures and the PROGMEM no-op, so the Adafruit-generated
// Fonts/*.h headers compile unmodified in the browser build (gfxfont.h).
#ifndef PROGMEM
#define PROGMEM
#endif

typedef struct {
  uint16_t bitmapOffset;
  uint8_t width;
  uint8_t height;
  uint8_t xAdvance;
  int8_t xOffset;
  int8_t yOffset;
} GFXglyph;

typedef struct {
  uint8_t* bitmap;
  GFXglyph* glyph;
  uint16_t first;
  uint16_t last;
  uint8_t yAdvance;
} GFXfont;

class GFXcanvas16 {
 public:
  GFXcanvas16(std::uint16_t width, std::uint16_t height,
              bool allocate_buffer = true)
      : width_(width), height_(height) {
    if (allocate_buffer) buffer_.resize(static_cast<std::size_t>(width) * height);
  }

  GFXcanvas16(const GFXcanvas16&) = delete;
  GFXcanvas16& operator=(const GFXcanvas16&) = delete;

  std::uint16_t* getBuffer() { return buffer_.empty() ? nullptr : buffer_.data(); }
  const std::uint16_t* getBuffer() const {
    return buffer_.empty() ? nullptr : buffer_.data();
  }

  std::int16_t width() const { return static_cast<std::int16_t>(width_); }
  std::int16_t height() const { return static_cast<std::int16_t>(height_); }

  void drawPixel(std::int16_t x, std::int16_t y, std::uint16_t color) {
    if (x < 0 || y < 0 || x >= width() || y >= height() || buffer_.empty()) return;
    buffer_[static_cast<std::size_t>(y) * width_ + x] = color;
  }

  void fillScreen(std::uint16_t color) {
    std::fill(buffer_.begin(), buffer_.end(), color);
  }

  void drawFastVLine(std::int16_t x, std::int16_t y, std::int16_t h,
                     std::uint16_t color) {
    if (h < 0) {
      h = static_cast<std::int16_t>(-h);
      y = static_cast<std::int16_t>(y - h + 1);
      if (y < 0) {
        h = static_cast<std::int16_t>(h + y);
        y = 0;
      }
    }
    if (x < 0 || x >= width() || y >= height() || y + h - 1 < 0) return;
    if (y < 0) {
      h = static_cast<std::int16_t>(h + y);
      y = 0;
    }
    if (y + h > height()) h = static_cast<std::int16_t>(height() - y);
    for (std::int16_t offset = 0; offset < h; ++offset) {
      buffer_[static_cast<std::size_t>(y + offset) * width_ + x] = color;
    }
  }

  void drawFastHLine(std::int16_t x, std::int16_t y, std::int16_t w,
                     std::uint16_t color) {
    if (w < 0) {
      w = static_cast<std::int16_t>(-w);
      x = static_cast<std::int16_t>(x - w + 1);
      if (x < 0) {
        w = static_cast<std::int16_t>(w + x);
        x = 0;
      }
    }
    if (y < 0 || y >= height() || x >= width() || x + w - 1 < 0) return;
    if (x < 0) {
      w = static_cast<std::int16_t>(w + x);
      x = 0;
    }
    if (x + w >= width()) w = static_cast<std::int16_t>(width() - x);
    auto begin = buffer_.begin() + static_cast<std::size_t>(y) * width_ + x;
    std::fill(begin, begin + w, color);
  }

  void fillRect(std::int16_t x, std::int16_t y, std::int16_t w,
                std::int16_t h, std::uint16_t color) {
    if (w <= 0 || h <= 0 || x >= width() || y >= height() || x + w <= 0 ||
        y + h <= 0) {
      return;
    }
    const auto left = std::max<std::int16_t>(0, x);
    const auto top = std::max<std::int16_t>(0, y);
    const auto right = std::min<std::int16_t>(width(), x + w);
    const auto bottom = std::min<std::int16_t>(height(), y + h);
    for (auto row = top; row < bottom; ++row) {
      drawFastHLine(left, row, static_cast<std::int16_t>(right - left), color);
    }
  }

  void drawLine(std::int16_t x0, std::int16_t y0, std::int16_t x1,
                std::int16_t y1, std::uint16_t color) {
    if (x0 == x1) {
      if (y0 > y1) std::swap(y0, y1);
      drawFastVLine(x0, y0, static_cast<std::int16_t>(y1 - y0 + 1), color);
      return;
    }
    if (y0 == y1) {
      if (x0 > x1) std::swap(x0, x1);
      drawFastHLine(x0, y0, static_cast<std::int16_t>(x1 - x0 + 1), color);
      return;
    }

    const bool steep = std::abs(y1 - y0) > std::abs(x1 - x0);
    if (steep) {
      std::swap(x0, y0);
      std::swap(x1, y1);
    }
    if (x0 > x1) {
      std::swap(x0, x1);
      std::swap(y0, y1);
    }
    const auto dx = static_cast<std::int16_t>(x1 - x0);
    const auto dy = static_cast<std::int16_t>(std::abs(y1 - y0));
    auto error = static_cast<std::int16_t>(dx / 2);
    const std::int16_t y_step = y0 < y1 ? 1 : -1;
    for (; x0 <= x1; ++x0) {
      if (steep) drawPixel(y0, x0, color);
      else drawPixel(x0, y0, color);
      error = static_cast<std::int16_t>(error - dy);
      if (error < 0) {
        y0 = static_cast<std::int16_t>(y0 + y_step);
        error = static_cast<std::int16_t>(error + dx);
      }
    }
  }

  void drawCircle(std::int16_t x0, std::int16_t y0, std::int16_t radius,
                  std::uint16_t color) {
    std::int16_t f = static_cast<std::int16_t>(1 - radius);
    std::int16_t ddf_x = 1;
    std::int16_t ddf_y = static_cast<std::int16_t>(-2 * radius);
    std::int16_t x = 0;
    std::int16_t y = radius;
    drawPixel(x0, static_cast<std::int16_t>(y0 + radius), color);
    drawPixel(x0, static_cast<std::int16_t>(y0 - radius), color);
    drawPixel(static_cast<std::int16_t>(x0 + radius), y0, color);
    drawPixel(static_cast<std::int16_t>(x0 - radius), y0, color);
    while (x < y) {
      if (f >= 0) {
        --y;
        ddf_y = static_cast<std::int16_t>(ddf_y + 2);
        f = static_cast<std::int16_t>(f + ddf_y);
      }
      ++x;
      ddf_x = static_cast<std::int16_t>(ddf_x + 2);
      f = static_cast<std::int16_t>(f + ddf_x);
      drawPixel(x0 + x, y0 + y, color);
      drawPixel(x0 - x, y0 + y, color);
      drawPixel(x0 + x, y0 - y, color);
      drawPixel(x0 - x, y0 - y, color);
      drawPixel(x0 + y, y0 + x, color);
      drawPixel(x0 - y, y0 + x, color);
      drawPixel(x0 + y, y0 - x, color);
      drawPixel(x0 - y, y0 - x, color);
    }
  }

  void fillCircle(std::int16_t x0, std::int16_t y0, std::int16_t radius,
                  std::uint16_t color) {
    drawFastVLine(x0, static_cast<std::int16_t>(y0 - radius),
                  static_cast<std::int16_t>(2 * radius + 1), color);
    fillCircleHelper(x0, y0, radius, 3, 0, color);
  }

  void drawRect(std::int16_t x, std::int16_t y, std::int16_t w,
                std::int16_t h, std::uint16_t color) {
    drawFastHLine(x, y, w, color);
    drawFastHLine(x, static_cast<std::int16_t>(y + h - 1), w, color);
    drawFastVLine(x, y, h, color);
    drawFastVLine(static_cast<std::int16_t>(x + w - 1), y, h, color);
  }

  void drawRoundRect(std::int16_t x, std::int16_t y, std::int16_t w,
                     std::int16_t h, std::int16_t radius,
                     std::uint16_t color) {
    const auto max_radius = static_cast<std::int16_t>(std::min(w, h) / 2);
    radius = std::min(radius, max_radius);
    drawFastHLine(x + radius, y, w - 2 * radius, color);
    drawFastHLine(x + radius, y + h - 1, w - 2 * radius, color);
    drawFastVLine(x, y + radius, h - 2 * radius, color);
    drawFastVLine(x + w - 1, y + radius, h - 2 * radius, color);
    drawCircleHelper(x + radius, y + radius, radius, 1, color);
    drawCircleHelper(x + w - radius - 1, y + radius, radius, 2, color);
    drawCircleHelper(x + w - radius - 1, y + h - radius - 1, radius, 4,
                     color);
    drawCircleHelper(x + radius, y + h - radius - 1, radius, 8, color);
  }

  void fillRoundRect(std::int16_t x, std::int16_t y, std::int16_t w,
                     std::int16_t h, std::int16_t radius,
                     std::uint16_t color) {
    const auto max_radius = static_cast<std::int16_t>(std::min(w, h) / 2);
    radius = std::min(radius, max_radius);
    fillRect(x + radius, y, w - 2 * radius, h, color);
    fillCircleHelper(x + w - radius - 1, y + radius, radius, 1,
                     h - 2 * radius - 1, color);
    fillCircleHelper(x + radius, y + radius, radius, 2,
                     h - 2 * radius - 1, color);
  }

  void fillTriangle(std::int16_t x0, std::int16_t y0, std::int16_t x1,
                    std::int16_t y1, std::int16_t x2, std::int16_t y2,
                    std::uint16_t color) {
    if (y0 > y1) {
      std::swap(y0, y1);
      std::swap(x0, x1);
    }
    if (y1 > y2) {
      std::swap(y2, y1);
      std::swap(x2, x1);
    }
    if (y0 > y1) {
      std::swap(y0, y1);
      std::swap(x0, x1);
    }
    if (y0 == y2) {
      auto left = std::min(x0, std::min(x1, x2));
      auto right = std::max(x0, std::max(x1, x2));
      drawFastHLine(left, y0, static_cast<std::int16_t>(right - left + 1), color);
      return;
    }

    const std::int16_t dx01 = x1 - x0;
    const std::int16_t dy01 = y1 - y0;
    const std::int16_t dx02 = x2 - x0;
    const std::int16_t dy02 = y2 - y0;
    const std::int16_t dx12 = x2 - x1;
    const std::int16_t dy12 = y2 - y1;
    std::int32_t a_accumulator = 0;
    std::int32_t b_accumulator = 0;
    const std::int16_t last = y1 == y2 ? y1 : static_cast<std::int16_t>(y1 - 1);
    std::int16_t y = y0;
    for (; y <= last; ++y) {
      auto a = static_cast<std::int16_t>(x0 + a_accumulator / dy01);
      auto b = static_cast<std::int16_t>(x0 + b_accumulator / dy02);
      a_accumulator += dx01;
      b_accumulator += dx02;
      if (a > b) std::swap(a, b);
      drawFastHLine(a, y, static_cast<std::int16_t>(b - a + 1), color);
    }
    a_accumulator = static_cast<std::int32_t>(dx12) * (y - y1);
    b_accumulator = static_cast<std::int32_t>(dx02) * (y - y0);
    for (; y <= y2; ++y) {
      auto a = static_cast<std::int16_t>(x1 + a_accumulator / dy12);
      auto b = static_cast<std::int16_t>(x0 + b_accumulator / dy02);
      a_accumulator += dx12;
      b_accumulator += dx02;
      if (a > b) std::swap(a, b);
      drawFastHLine(a, y, static_cast<std::int16_t>(b - a + 1), color);
    }
  }

  void setTextColor(std::uint16_t color) {
    text_color_ = color;
    text_background_ = color;
  }

  void setTextSize(std::uint8_t size) {
    text_size_x_ = size > 0 ? size : 1;
    text_size_y_ = text_size_x_;
  }

  void setTextWrap(bool wrap) { wrap_ = wrap; }

  void setFont(const GFXfont* font = nullptr) {
    // Adafruit shifts the cursor by one classic-font ascent when switching
    // between font systems, because custom fonts position by baseline.
    if (font != nullptr) {
      if (gfx_font_ == nullptr) cursor_y_ = static_cast<std::int16_t>(cursor_y_ + 6);
    } else if (gfx_font_ != nullptr) {
      cursor_y_ = static_cast<std::int16_t>(cursor_y_ - 6);
    }
    gfx_font_ = font;
  }

  void setCursor(std::int16_t x, std::int16_t y) {
    cursor_x_ = x;
    cursor_y_ = y;
  }

  std::size_t print(const char* value) {
    if (value == nullptr) return 0;
    std::size_t written = 0;
    while (*value != '\0') {
      write(static_cast<std::uint8_t>(*value++));
      ++written;
    }
    return written;
  }

  void getTextBounds(const char* value, std::int16_t x, std::int16_t y,
                     std::int16_t* x1, std::int16_t* y1,
                     std::uint16_t* bounds_width,
                     std::uint16_t* bounds_height) const {
    std::int16_t minimum_x = 0x7FFF;
    std::int16_t minimum_y = 0x7FFF;
    std::int16_t maximum_x = -1;
    std::int16_t maximum_y = -1;
    *x1 = x;
    *y1 = y;
    *bounds_width = 0;
    *bounds_height = 0;
    if (value == nullptr) return;
    while (*value != '\0') {
      const auto character = static_cast<std::uint8_t>(*value++);
      if (gfx_font_ != nullptr) {
        if (character == '\n') {
          x = 0;
          y = static_cast<std::int16_t>(y + text_size_y_ * gfx_font_->yAdvance);
          continue;
        }
        if (character == '\r') continue;
        if (character < gfx_font_->first || character > gfx_font_->last) continue;
        const GFXglyph& glyph = gfx_font_->glyph[character - gfx_font_->first];
        if (wrap_ &&
            x + text_size_x_ * (glyph.xOffset + glyph.width) > width()) {
          x = 0;
          y = static_cast<std::int16_t>(y + text_size_y_ * gfx_font_->yAdvance);
        }
        const auto left = static_cast<std::int16_t>(x + glyph.xOffset * text_size_x_);
        const auto top = static_cast<std::int16_t>(y + glyph.yOffset * text_size_y_);
        const auto right = static_cast<std::int16_t>(left + glyph.width * text_size_x_ - 1);
        const auto bottom = static_cast<std::int16_t>(top + glyph.height * text_size_y_ - 1);
        minimum_x = std::min(minimum_x, left);
        minimum_y = std::min(minimum_y, top);
        maximum_x = std::max(maximum_x, right);
        maximum_y = std::max(maximum_y, bottom);
        x = static_cast<std::int16_t>(x + glyph.xAdvance * text_size_x_);
        continue;
      }
      if (character == '\n') {
        x = 0;
        y = static_cast<std::int16_t>(y + text_size_y_ * 8);
        continue;
      }
      if (character == '\r') continue;
      if (wrap_ && x + text_size_x_ * 6 > width()) {
        x = 0;
        y = static_cast<std::int16_t>(y + text_size_y_ * 8);
      }
      const auto right = static_cast<std::int16_t>(x + text_size_x_ * 6 - 1);
      const auto bottom = static_cast<std::int16_t>(y + text_size_y_ * 8 - 1);
      maximum_x = std::max(maximum_x, right);
      maximum_y = std::max(maximum_y, bottom);
      minimum_x = std::min(minimum_x, x);
      minimum_y = std::min(minimum_y, y);
      x = static_cast<std::int16_t>(x + text_size_x_ * 6);
    }
    if (maximum_x >= minimum_x) {
      *x1 = minimum_x;
      *bounds_width = static_cast<std::uint16_t>(maximum_x - minimum_x + 1);
    }
    if (maximum_y >= minimum_y) {
      *y1 = minimum_y;
      *bounds_height = static_cast<std::uint16_t>(maximum_y - minimum_y + 1);
    }
  }

 private:
  void write(std::uint8_t character) {
    if (gfx_font_ != nullptr) {
      writeCustomFont(character);
      return;
    }
    if (character == '\n') {
      cursor_x_ = 0;
      cursor_y_ = static_cast<std::int16_t>(cursor_y_ + text_size_y_ * 8);
      return;
    }
    if (character == '\r') return;
    if (wrap_ && cursor_x_ + text_size_x_ * 6 > width()) {
      cursor_x_ = 0;
      cursor_y_ = static_cast<std::int16_t>(cursor_y_ + text_size_y_ * 8);
    }
    drawChar(cursor_x_, cursor_y_, character, text_color_, text_background_,
             text_size_x_, text_size_y_);
    cursor_x_ = static_cast<std::int16_t>(cursor_x_ + text_size_x_ * 6);
  }

  void writeCustomFont(std::uint8_t character) {
    if (character == '\n') {
      cursor_x_ = 0;
      cursor_y_ = static_cast<std::int16_t>(cursor_y_ + text_size_y_ * gfx_font_->yAdvance);
      return;
    }
    if (character == '\r') return;
    if (character < gfx_font_->first || character > gfx_font_->last) return;
    const GFXglyph& glyph = gfx_font_->glyph[character - gfx_font_->first];
    if (glyph.width > 0 && glyph.height > 0) {
      if (wrap_ &&
          cursor_x_ + text_size_x_ * (glyph.xOffset + glyph.width) > width()) {
        cursor_x_ = 0;
        cursor_y_ = static_cast<std::int16_t>(cursor_y_ + text_size_y_ * gfx_font_->yAdvance);
      }
      drawCharCustomFont(cursor_x_, cursor_y_, character, text_color_,
                         text_size_x_, text_size_y_);
    }
    cursor_x_ = static_cast<std::int16_t>(cursor_x_ + glyph.xAdvance * text_size_x_);
  }

  // Custom fonts draw by baseline and ignore the background color, matching
  // Adafruit GFX.
  void drawCharCustomFont(std::int16_t x, std::int16_t y,
                          std::uint8_t character, std::uint16_t color,
                          std::uint8_t size_x, std::uint8_t size_y) {
    const GFXglyph& glyph = gfx_font_->glyph[character - gfx_font_->first];
    const std::uint8_t* bitmap = gfx_font_->bitmap;
    std::uint16_t bitmap_offset = glyph.bitmapOffset;
    std::uint8_t bits = 0;
    std::uint8_t bit = 0;
    std::int16_t xo16 = 0;
    std::int16_t yo16 = 0;
    if (size_x > 1 || size_y > 1) {
      xo16 = glyph.xOffset;
      yo16 = glyph.yOffset;
    }
    for (std::uint8_t yy = 0; yy < glyph.height; ++yy) {
      for (std::uint8_t xx = 0; xx < glyph.width; ++xx) {
        if ((bit++ & 7U) == 0) bits = bitmap[bitmap_offset++];
        if ((bits & 0x80U) != 0) {
          if (size_x == 1 && size_y == 1) {
            drawPixel(static_cast<std::int16_t>(x + glyph.xOffset + xx),
                      static_cast<std::int16_t>(y + glyph.yOffset + yy), color);
          } else {
            fillRect(static_cast<std::int16_t>(x + (xo16 + xx) * size_x),
                     static_cast<std::int16_t>(y + (yo16 + yy) * size_y),
                     size_x, size_y, color);
          }
        }
        bits = static_cast<std::uint8_t>(bits << 1U);
      }
    }
  }

  void drawChar(std::int16_t x, std::int16_t y, std::uint8_t character,
                std::uint16_t color, std::uint16_t background,
                std::uint8_t size_x, std::uint8_t size_y) {
    if (x >= width() || y >= height() || x + 6 * size_x - 1 < 0 ||
        y + 8 * size_y - 1 < 0) {
      return;
    }
    if (character < 32 || character > 127) character = '?';
    const std::size_t glyph = static_cast<std::size_t>(character - 32) * 5;
    for (std::int8_t column = 0; column < 5; ++column) {
      auto line = kClassicFont[glyph + column];
      for (std::int8_t row = 0; row < 8; ++row, line >>= 1U) {
        if ((line & 1U) != 0) {
          if (size_x == 1 && size_y == 1) drawPixel(x + column, y + row, color);
          else fillRect(x + column * size_x, y + row * size_y, size_x, size_y, color);
        } else if (background != color) {
          if (size_x == 1 && size_y == 1) drawPixel(x + column, y + row, background);
          else fillRect(x + column * size_x, y + row * size_y, size_x, size_y, background);
        }
      }
    }
    if (background != color) {
      fillRect(x + 5 * size_x, y, size_x, 8 * size_y, background);
    }
  }

  void drawCircleHelper(std::int16_t x0, std::int16_t y0,
                        std::int16_t radius, std::uint8_t corners,
                        std::uint16_t color) {
    std::int16_t f = static_cast<std::int16_t>(1 - radius);
    std::int16_t ddf_x = 1;
    std::int16_t ddf_y = static_cast<std::int16_t>(-2 * radius);
    std::int16_t x = 0;
    std::int16_t y = radius;
    while (x < y) {
      if (f >= 0) {
        --y;
        ddf_y = static_cast<std::int16_t>(ddf_y + 2);
        f = static_cast<std::int16_t>(f + ddf_y);
      }
      ++x;
      ddf_x = static_cast<std::int16_t>(ddf_x + 2);
      f = static_cast<std::int16_t>(f + ddf_x);
      if ((corners & 0x4U) != 0) {
        drawPixel(x0 + x, y0 + y, color);
        drawPixel(x0 + y, y0 + x, color);
      }
      if ((corners & 0x2U) != 0) {
        drawPixel(x0 + x, y0 - y, color);
        drawPixel(x0 + y, y0 - x, color);
      }
      if ((corners & 0x8U) != 0) {
        drawPixel(x0 - y, y0 + x, color);
        drawPixel(x0 - x, y0 + y, color);
      }
      if ((corners & 0x1U) != 0) {
        drawPixel(x0 - y, y0 - x, color);
        drawPixel(x0 - x, y0 - y, color);
      }
    }
  }

  void fillCircleHelper(std::int16_t x0, std::int16_t y0,
                        std::int16_t radius, std::uint8_t corners,
                        std::int16_t delta, std::uint16_t color) {
    std::int16_t f = static_cast<std::int16_t>(1 - radius);
    std::int16_t ddf_x = 1;
    std::int16_t ddf_y = static_cast<std::int16_t>(-2 * radius);
    std::int16_t x = 0;
    std::int16_t y = radius;
    std::int16_t previous_x = x;
    std::int16_t previous_y = y;
    ++delta;
    while (x < y) {
      if (f >= 0) {
        --y;
        ddf_y = static_cast<std::int16_t>(ddf_y + 2);
        f = static_cast<std::int16_t>(f + ddf_y);
      }
      ++x;
      ddf_x = static_cast<std::int16_t>(ddf_x + 2);
      f = static_cast<std::int16_t>(f + ddf_x);
      if (x < y + 1) {
        if ((corners & 1U) != 0) drawFastVLine(x0 + x, y0 - y, 2 * y + delta, color);
        if ((corners & 2U) != 0) drawFastVLine(x0 - x, y0 - y, 2 * y + delta, color);
      }
      if (y != previous_y) {
        if ((corners & 1U) != 0) {
          drawFastVLine(x0 + previous_y, y0 - previous_x,
                        2 * previous_x + delta, color);
        }
        if ((corners & 2U) != 0) {
          drawFastVLine(x0 - previous_y, y0 - previous_x,
                        2 * previous_x + delta, color);
        }
        previous_y = y;
      }
      previous_x = x;
    }
  }

  inline static constexpr std::uint8_t kClassicFont[] = {
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5F, 0x00, 0x00, 0x00, 0x07, 0x00, 0x07, 0x00, 0x14,
      0x7F, 0x14, 0x7F, 0x14, 0x24, 0x2A, 0x7F, 0x2A, 0x12, 0x23, 0x13, 0x08, 0x64, 0x62, 0x36, 0x49,
      0x56, 0x20, 0x50, 0x00, 0x08, 0x07, 0x03, 0x00, 0x00, 0x1C, 0x22, 0x41, 0x00, 0x00, 0x41, 0x22,
      0x1C, 0x00, 0x2A, 0x1C, 0x7F, 0x1C, 0x2A, 0x08, 0x08, 0x3E, 0x08, 0x08, 0x00, 0x80, 0x70, 0x30,
      0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x00, 0x60, 0x60, 0x00, 0x20, 0x10, 0x08, 0x04, 0x02,
      0x3E, 0x51, 0x49, 0x45, 0x3E, 0x00, 0x42, 0x7F, 0x40, 0x00, 0x72, 0x49, 0x49, 0x49, 0x46, 0x21,
      0x41, 0x49, 0x4D, 0x33, 0x18, 0x14, 0x12, 0x7F, 0x10, 0x27, 0x45, 0x45, 0x45, 0x39, 0x3C, 0x4A,
      0x49, 0x49, 0x31, 0x41, 0x21, 0x11, 0x09, 0x07, 0x36, 0x49, 0x49, 0x49, 0x36, 0x46, 0x49, 0x49,
      0x29, 0x1E, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x40, 0x34, 0x00, 0x00, 0x00, 0x08, 0x14, 0x22,
      0x41, 0x14, 0x14, 0x14, 0x14, 0x14, 0x00, 0x41, 0x22, 0x14, 0x08, 0x02, 0x01, 0x59, 0x09, 0x06,
      0x3E, 0x41, 0x5D, 0x59, 0x4E, 0x7C, 0x12, 0x11, 0x12, 0x7C, 0x7F, 0x49, 0x49, 0x49, 0x36, 0x3E,
      0x41, 0x41, 0x41, 0x22, 0x7F, 0x41, 0x41, 0x41, 0x3E, 0x7F, 0x49, 0x49, 0x49, 0x41, 0x7F, 0x09,
      0x09, 0x09, 0x01, 0x3E, 0x41, 0x41, 0x51, 0x73, 0x7F, 0x08, 0x08, 0x08, 0x7F, 0x00, 0x41, 0x7F,
      0x41, 0x00, 0x20, 0x40, 0x41, 0x3F, 0x01, 0x7F, 0x08, 0x14, 0x22, 0x41, 0x7F, 0x40, 0x40, 0x40,
      0x40, 0x7F, 0x02, 0x1C, 0x02, 0x7F, 0x7F, 0x04, 0x08, 0x10, 0x7F, 0x3E, 0x41, 0x41, 0x41, 0x3E,
      0x7F, 0x09, 0x09, 0x09, 0x06, 0x3E, 0x41, 0x51, 0x21, 0x5E, 0x7F, 0x09, 0x19, 0x29, 0x46, 0x26,
      0x49, 0x49, 0x49, 0x32, 0x03, 0x01, 0x7F, 0x01, 0x03, 0x3F, 0x40, 0x40, 0x40, 0x3F, 0x1F, 0x20,
      0x40, 0x20, 0x1F, 0x3F, 0x40, 0x38, 0x40, 0x3F, 0x63, 0x14, 0x08, 0x14, 0x63, 0x03, 0x04, 0x78,
      0x04, 0x03, 0x61, 0x59, 0x49, 0x4D, 0x43, 0x00, 0x7F, 0x41, 0x41, 0x41, 0x02, 0x04, 0x08, 0x10,
      0x20, 0x00, 0x41, 0x41, 0x41, 0x7F, 0x04, 0x02, 0x01, 0x02, 0x04, 0x40, 0x40, 0x40, 0x40, 0x40,
      0x00, 0x03, 0x07, 0x08, 0x00, 0x20, 0x54, 0x54, 0x78, 0x40, 0x7F, 0x28, 0x44, 0x44, 0x38, 0x38,
      0x44, 0x44, 0x44, 0x28, 0x38, 0x44, 0x44, 0x28, 0x7F, 0x38, 0x54, 0x54, 0x54, 0x18, 0x00, 0x08,
      0x7E, 0x09, 0x02, 0x18, 0xA4, 0xA4, 0x9C, 0x78, 0x7F, 0x08, 0x04, 0x04, 0x78, 0x00, 0x44, 0x7D,
      0x40, 0x00, 0x20, 0x40, 0x40, 0x3D, 0x00, 0x7F, 0x10, 0x28, 0x44, 0x00, 0x00, 0x41, 0x7F, 0x40,
      0x00, 0x7C, 0x04, 0x78, 0x04, 0x78, 0x7C, 0x08, 0x04, 0x04, 0x78, 0x38, 0x44, 0x44, 0x44, 0x38,
      0xFC, 0x18, 0x24, 0x24, 0x18, 0x18, 0x24, 0x24, 0x18, 0xFC, 0x7C, 0x08, 0x04, 0x04, 0x08, 0x48,
      0x54, 0x54, 0x54, 0x24, 0x04, 0x04, 0x3F, 0x44, 0x24, 0x3C, 0x40, 0x40, 0x20, 0x7C, 0x1C, 0x20,
      0x40, 0x20, 0x1C, 0x3C, 0x40, 0x30, 0x40, 0x3C, 0x44, 0x28, 0x10, 0x28, 0x44, 0x4C, 0x90, 0x90,
      0x90, 0x7C, 0x44, 0x64, 0x54, 0x4C, 0x44, 0x00, 0x08, 0x36, 0x41, 0x00, 0x00, 0x00, 0x77, 0x00,
      0x00, 0x00, 0x41, 0x36, 0x08, 0x00, 0x02, 0x01, 0x02, 0x04, 0x02, 0x3C, 0x26, 0x23, 0x26, 0x3C,
  };

  std::uint16_t width_;
  std::uint16_t height_;
  std::vector<std::uint16_t> buffer_;
  std::int16_t cursor_x_ = 0;
  std::int16_t cursor_y_ = 0;
  std::uint16_t text_color_ = 0xFFFF;
  std::uint16_t text_background_ = 0xFFFF;
  std::uint8_t text_size_x_ = 1;
  std::uint8_t text_size_y_ = 1;
  bool wrap_ = true;
  const GFXfont* gfx_font_ = nullptr;
};
