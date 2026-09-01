#include "apple/display/display_grid.hpp"

#include <algorithm>
#include <cstring>

namespace apple::display {

void FrameDiff::remember(const std::uint8_t *frame) {
  if (valid_)
    std::memcpy(prev_, frame, kLogicalPixels);
}

DirtyRect FrameDiff::changed(const std::uint8_t *frame, bool force_full) {
  const bool full = !valid_ || force_full;
  valid_ = true;
  if (full)
    return kWholePanel;
  constexpr int kW = kLogicalWidth;
  constexpr int kH = kLogicalHeight;
  int x0 = kW, x1 = -1, y0 = kH, y1 = -1;
  for (int y = 0; y < kH; ++y) {
    const std::uint8_t *a = frame + y * kW;
    const std::uint8_t *b = prev_ + y * kW;
    if (std::memcmp(a, b, kW) == 0)
      continue;
    int l = 0;
    while (a[l] == b[l])
      ++l;
    int r = kW - 1;
    while (a[r] == b[r])
      --r;
    x0 = std::min(x0, l);
    x1 = std::max(x1, r);
    y0 = std::min(y0, y);
    y1 = y;
  }
  if (y1 < 0)
    return DirtyRect{};
  return DirtyRect{2 * x0, 2 * y0, 2 * (x1 - x0 + 1), 2 * (y1 - y0 + 1)};
}

void blit_2x(const std::uint8_t *logical, std::uint16_t *rgb565,
             const std::uint16_t *map) {
  for (int y = 0; y < kLogicalHeight; ++y) {
    std::uint16_t *row0 = rgb565 + (2 * y) * kPanelWidth;
    std::uint16_t *row1 = row0 + kPanelWidth;
    const std::uint8_t *src = logical + y * kLogicalWidth;
    for (int x = 0; x < kLogicalWidth; ++x) {
      const std::uint16_t c = map[src[x]];
      row0[2 * x] = c;
      row0[2 * x + 1] = c;
      row1[2 * x] = c;
      row1[2 * x + 1] = c;
    }
  }
}

}  // namespace apple::display
