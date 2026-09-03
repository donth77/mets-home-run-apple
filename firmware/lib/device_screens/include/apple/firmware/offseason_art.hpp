#pragma once

#include <Adafruit_GFX.h>

namespace apple::firmware {

// Draw the approved 320 x 240 offseason design. The artwork is stored as a
// compact RGB565 export of the manually maintained Aseprite source; the footer
// stays dynamic so the device can advance the season year without a new asset.
void draw_offseason_art(GFXcanvas16& canvas, const char* season_label);

}  // namespace apple::firmware
