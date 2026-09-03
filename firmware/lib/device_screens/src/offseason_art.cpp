#include "apple/firmware/offseason_art.hpp"

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace apple::firmware {

namespace {

constexpr std::int16_t kWidth = 320;
constexpr std::int16_t kStaticHeight = 220;
constexpr std::uint16_t kFooterBackground = 0x08E7;  // #0B1C3D in RGB565
constexpr std::uint16_t kFooterText = 0xFAC2;        // #FF5910 in RGB565

// Row-bounded runs encoded as [count, RGB565 high byte, RGB565 low byte].
// Base64 keeps the generated include compact while still allowing both the
// C++ renderer and Apple Lab to consume the exact same export.
constexpr char kStaticArtworkBase64[] =
#include "../assets/offseason-320x220.rgb565.rle.inc"
    ;

constexpr std::uint8_t decode_base64(char value) {
  return value >= 'A' && value <= 'Z'
             ? static_cast<std::uint8_t>(value - 'A')
         : value >= 'a' && value <= 'z'
             ? static_cast<std::uint8_t>(value - 'a' + 26)
         : value >= '0' && value <= '9'
             ? static_cast<std::uint8_t>(value - '0' + 52)
         : value == '+' ? 62
                        : 63;
}

constexpr std::size_t decoded_pixel_count() {
  std::size_t pixels = 0;
  for (std::size_t index = 0; index + 3 < sizeof(kStaticArtworkBase64) - 1;
       index += 4) {
    const auto first = decode_base64(kStaticArtworkBase64[index]);
    const auto second = decode_base64(kStaticArtworkBase64[index + 1]);
    pixels += static_cast<std::uint8_t>((first << 2U) | (second >> 4U));
  }
  return pixels;
}

static_assert((sizeof(kStaticArtworkBase64) - 1) % 4 == 0);
static_assert(decoded_pixel_count() ==
              static_cast<std::size_t>(kWidth) * kStaticHeight);

struct Glyph {
  char character;
  std::uint8_t rows[7];
};

// The footer uses the same hand-authored 5x7 panel glyphs as offseason.png.
constexpr Glyph kFooterGlyphs[] = {
    {' ', {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}},
    {'0', {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E}},
    {'1', {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E}},
    {'2', {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F}},
    {'3', {0x1E, 0x01, 0x01, 0x0E, 0x01, 0x01, 0x1E}},
    {'4', {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02}},
    {'5', {0x1F, 0x10, 0x10, 0x1E, 0x01, 0x01, 0x1E}},
    {'6', {0x0E, 0x10, 0x10, 0x1E, 0x11, 0x11, 0x0E}},
    {'7', {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08}},
    {'8', {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E}},
    {'9', {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x01, 0x0E}},
    {'A', {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}},
    {'E', {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F}},
    {'N', {0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11}},
    {'O', {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E}},
    {'S', {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E}},
    {'T', {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04}},
    {'X', {0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11}},
};

constexpr std::uint8_t kFallbackGlyph[] = {0x0E, 0x11, 0x01, 0x02,
                                            0x04, 0x00, 0x04};

const std::uint8_t* glyph_rows(char character) {
  if (character >= 'a' && character <= 'z') {
    character = static_cast<char>(character - 'a' + 'A');
  }
  for (const auto& glyph : kFooterGlyphs) {
    if (glyph.character == character) return glyph.rows;
  }
  return kFallbackGlyph;
}

void draw_footer_label(GFXcanvas16& canvas, const char* label) {
  const auto length = std::strlen(label);
  if (length == 0) return;
  const auto width = static_cast<std::int16_t>(length * 6U - 1U);
  std::int16_t cursor_x = static_cast<std::int16_t>((kWidth - width) / 2);
  for (std::size_t index = 0; index < length; ++index) {
    const auto* rows = glyph_rows(label[index]);
    for (std::uint8_t row = 0; row < 7; ++row) {
      for (std::uint8_t column = 0; column < 5; ++column) {
        if ((rows[row] & (0x10U >> column)) != 0) {
          canvas.drawPixel(cursor_x + column, 227 + row, kFooterText);
        }
      }
    }
    cursor_x += 6;
  }
}

}  // namespace

void draw_offseason_art(GFXcanvas16& canvas, const char* season_label) {
  std::size_t pixel = 0;
  for (std::size_t index = 0; index + 3 < sizeof(kStaticArtworkBase64) - 1;
       index += 4) {
    const auto first = decode_base64(kStaticArtworkBase64[index]);
    const auto second = decode_base64(kStaticArtworkBase64[index + 1]);
    const auto third = decode_base64(kStaticArtworkBase64[index + 2]);
    const auto fourth = decode_base64(kStaticArtworkBase64[index + 3]);
    std::uint16_t remaining =
        static_cast<std::uint8_t>((first << 2U) | (second >> 4U));
    const std::uint16_t color = static_cast<std::uint16_t>(
        ((second & 0x0FU) << 12U) | (third << 6U) | fourth);

    while (remaining > 0) {
      const auto x = static_cast<std::int16_t>(pixel % kWidth);
      const auto y = static_cast<std::int16_t>(pixel / kWidth);
      const auto available = static_cast<std::uint16_t>(kWidth - x);
      const auto span = remaining < available ? remaining : available;
      canvas.drawFastHLine(x, y, static_cast<std::int16_t>(span), color);
      pixel += span;
      remaining -= span;
    }
  }

  canvas.fillRect(0, kStaticHeight, kWidth, 20, kFooterBackground);
  draw_footer_label(canvas, season_label);
}

}  // namespace apple::firmware
