#include "apple_live/audio/wav.hpp"

#include <algorithm>
#include <cstdint>
#include <cstring>

namespace apple::live {

// The same rounded fixed-point scaling as apply_volume, on a run of samples.
void scale_samples(std::int16_t* samples, std::uint32_t count, std::int32_t scale) {
  for (std::uint32_t i = 0; i < count; ++i) {
    samples[i] = static_cast<std::int16_t>((static_cast<std::int32_t>(samples[i]) * scale + 2048) >> 12);
  }
}

// Walks a WAV's chunks to find where the samples actually begin. A file is not
// simply a 44 byte header and then audio: encoders routinely write an extra
// information chunk first, and assuming otherwise means writing over the header
// instead of the music. Returns false when there is no data chunk.
bool find_wav_data(const std::uint8_t* wav, std::uint32_t bytes, std::uint32_t& at,
                   std::uint32_t& length) {
  if (bytes < 44 || std::memcmp(wav, "RIFF", 4) != 0 || std::memcmp(wav + 8, "WAVE", 4) != 0) {
    return false;
  }
  std::uint32_t offset = 12;
  while (offset + 8 <= bytes) {
    const std::uint8_t* header = wav + offset;
    const std::uint32_t size = static_cast<std::uint32_t>(header[4]) |
                               (static_cast<std::uint32_t>(header[5]) << 8) |
                               (static_cast<std::uint32_t>(header[6]) << 16) |
                               (static_cast<std::uint32_t>(header[7]) << 24);
    if (std::memcmp(header, "data", 4) == 0) {
      at = offset + 8;
      // A track longer than the buffer is cut short, so trust what is here.
      length = std::min<std::uint32_t>(size, bytes - at);
      return length > 0;
    }
    offset += 8 + size + (size & 1);  // chunks are padded to even lengths
  }
  return false;
}

// The same walk over a file on the card, for tracks that are streamed rather
// than held in memory. Reads only the chunk headers, so a track whose encoder
// wrote kilobytes of tags before the samples is handled the same as a bare
// one. Leaves the file positioned wherever it last read.
bool find_wav_data_in_file(File& file, std::uint32_t& at, std::uint32_t& length) {
  std::uint8_t head[12];
  if (!file.seek(0) || file.read(head, sizeof(head)) != sizeof(head)) return false;
  if (std::memcmp(head, "RIFF", 4) != 0 || std::memcmp(head + 8, "WAVE", 4) != 0) return false;
  const std::uint32_t total = file.size();
  std::uint32_t offset = 12;
  for (int chunk = 0; chunk < 32 && offset + 8 <= total; ++chunk) {
    std::uint8_t header[8];
    if (!file.seek(offset) || file.read(header, sizeof(header)) != sizeof(header)) return false;
    const std::uint32_t size = static_cast<std::uint32_t>(header[4]) |
                               (static_cast<std::uint32_t>(header[5]) << 8) |
                               (static_cast<std::uint32_t>(header[6]) << 16) |
                               (static_cast<std::uint32_t>(header[7]) << 24);
    if (std::memcmp(header, "data", 4) == 0) {
      at = offset + 8;
      length = std::min<std::uint32_t>(size, total - at);
      return length > 0;
    }
    offset += 8 + size + (size & 1);
  }
  return false;
}

// Volume is applied here, once, as the track is read into memory, rather than
// at playback. The output stage's own gain control quantises to a sixth of a
// bit and truncates, which is audible on music at every setting below full;
// see public/AUDIO_PLAN.md. Scaling the stored copy costs nothing at play time
// and keeps the output at unity forever.
void apply_volume(std::uint8_t* wav, std::uint32_t bytes, std::uint8_t percent) {
  if (percent >= 100) return;
  std::uint32_t at = 0, length = 0;
  if (!find_wav_data(wav, bytes, at, length)) return;
  // Rounded, not truncated. Truncation is what makes quiet playback grainy.
  scale_samples(reinterpret_cast<std::int16_t*>(wav + at), length / 2,
                (static_cast<std::int32_t>(percent) * 4096) / 100);
}

}  // namespace apple::live
