#pragma once

// Mono 16-bit PCM WAV: where the samples begin, and scaling them for volume.

#include <SD.h>

#include <cstdint>

namespace apple::live {

void scale_samples(std::int16_t* samples, std::uint32_t count, std::int32_t scale);
bool find_wav_data(const std::uint8_t* wav, std::uint32_t bytes, std::uint32_t& at,
                   std::uint32_t& length);
bool find_wav_data_in_file(File& file, std::uint32_t& at, std::uint32_t& length);
void apply_volume(std::uint8_t* wav, std::uint32_t bytes, std::uint8_t percent);

}  // namespace apple::live
