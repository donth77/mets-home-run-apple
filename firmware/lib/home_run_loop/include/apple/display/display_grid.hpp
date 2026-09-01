#pragma once

#include <cstddef>
#include <cstdint>

// The celebration loops draw on a 160 x 120 grid of colour roles and double it
// onto the 320 x 240 RGB565 panel. This header holds what every loop shares:
// the grid, the rectangle a caller must push, and the frame-to-frame diff
// behind it.
namespace apple::display {

inline constexpr std::uint16_t kPanelWidth = 320;
inline constexpr std::uint16_t kPanelHeight = 240;
inline constexpr std::uint16_t kLogicalWidth = 160;
inline constexpr std::uint16_t kLogicalHeight = 120;
inline constexpr std::size_t kLogicalPixels =
    static_cast<std::size_t>(kLogicalWidth) * kLogicalHeight;

// What a caller must push to the panel after render(): the bounding box (panel
// pixels) of everything that differs from the previous render, or the whole
// panel after begin() / invalidate(). Pushing only this keeps the SPI transfer
// short.
struct DirtyRect {
  int x{0};
  int y{0};
  int w{0};
  int h{0};
  bool empty() const { return w <= 0 || h <= 0; }
};

inline constexpr DirtyRect kWholePanel{0, 0, kPanelWidth, kPanelHeight};

// Remembers the previous role frame and reports what changed.
class FrameDiff {
public:
  // Forget the previous frame; the next changed() reports the whole panel.
  void invalidate() { valid_ = false; }
  // Call before drawing the next frame, while `frame` still holds the previous one.
  void remember(const std::uint8_t *frame);
  // Panel-space bounding box of the pixels that differ from the remembered
  // frame (whole panel when nothing is remembered or `force_full` is set).
  DirtyRect changed(const std::uint8_t *frame, bool force_full);

private:
  std::uint8_t prev_[kLogicalPixels]{};
  bool valid_{false};
};

// Double the role frame onto the RGB565 panel buffer through a colour map
// indexed by role.
void blit_2x(const std::uint8_t *logical, std::uint16_t *rgb565,
             const std::uint16_t *map);

}  // namespace apple::display
