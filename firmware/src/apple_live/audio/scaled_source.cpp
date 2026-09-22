#include "apple_live/audio/scaled_source.hpp"

namespace apple::live {

volatile std::uint32_t audio_short_read_at = 0;  // where the card last returned nothing mid-file
volatile std::uint32_t audio_fade_at_ms = 0;
volatile bool audio_faded_out = false;

}  // namespace apple::live
