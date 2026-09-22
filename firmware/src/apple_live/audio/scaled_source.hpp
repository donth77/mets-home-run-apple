#pragma once

// The reader behind every track that plays, with the fade the main loop asks
// for before the Apple comes down.

#include "apple_live/audio/card.hpp"
#include "apple_live/audio/wav.hpp"
#include "apple_live/owner/settings.hpp"

#include <Arduino.h>
#include <AudioFileSource.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace apple::live {

// Where the card last returned nothing mid-file.
extern volatile std::uint32_t audio_short_read_at;
// The track fades out over the last seconds before the Apple comes down
// instead of being cut. The main loop sets when the fade should start (0 =
// none); the audio task applies it and stops the track once it is silent.
constexpr std::uint32_t kAudioFadeMs = 3000;
extern volatile std::uint32_t audio_fade_at_ms;
extern volatile bool audio_faded_out;

// Wraps a streamed WAV and applies the volume as bytes pass through, so a
// track played straight off the card is scaled the same way as one held in
// memory. Only bytes from the data chunk onward are touched; a read that ends
// halfway through a sample carries the odd byte to the next call.
//
// A track on the card, read ahead in one piece and scaled for volume from
// where the samples begin. This replaces the library's buffered reader, which
// loses its place after the header's seek: it hands the decoder bytes from
// 8 KB into the song where the data size belongs, so a track that opens with
// silence reports zero bytes of music and never plays.
class AudioFileSourceScaled : public AudioFileSource {
 public:
  static constexpr std::size_t kBufferBytes = 16 * 1024;
  static constexpr std::size_t kLowWater = 4 * 1024;  // refill once this little is left

  AudioFileSourceScaled(AudioFileSource* inner, std::uint32_t data_at, std::uint8_t percent, bool scale_volume = true)
      : inner_(inner), data_at_(data_at), scale_((static_cast<std::int32_t>(percent) * 4096) / 100),
        bypass_(percent >= 100), scale_volume_(scale_volume),
        buffer_(static_cast<std::uint8_t*>(malloc(kBufferBytes))) {}
  ~AudioFileSourceScaled() override { free(buffer_); }
  bool open(const char*) override { return true; }
  bool isOpen() override { return inner_ != nullptr && inner_->isOpen(); }
  bool close() override { return inner_ != nullptr && inner_->close(); }
  bool seek(int32_t pos, int dir) override {
    uint32_t target = 0;
    if (dir == SEEK_SET) target = static_cast<uint32_t>(pos);
    else if (dir == SEEK_CUR) target = static_cast<uint32_t>(static_cast<int32_t>(pos_) + pos);
    else target = inner_->getSize() + pos;
    // Forward within what is already read: just skip it.
    if (target >= pos_ && target - pos_ <= held_) {
      const uint32_t skip = target - pos_;
      head_ += skip;
      held_ -= skip;
      pos_ = target;
      have_carry_ = false;
      return true;
    }
    CardLock lock;
    if (!inner_->seek(static_cast<int32_t>(target), SEEK_SET)) return false;
    head_ = held_ = 0;
    pos_ = target;
    have_carry_ = false;
    return true;
  }
  uint32_t getSize() override { return inner_->getSize(); }
  uint32_t getPos() override { return pos_; }
  bool loop() override {
    if (held_ < kLowWater) refill();
    return inner_->loop();
  }
  uint32_t read(void* data, uint32_t len) override {
    if (buffer_ == nullptr) return 0;
    if (held_ < len) refill();
    const uint32_t got = static_cast<uint32_t>(std::min<std::size_t>(len, held_));
    std::memcpy(data, buffer_ + head_, got);
    head_ += got;
    held_ -= got;
    // The owner may move the volume while the song plays; a held copy was
    // scaled when it was loaded, so only the fade applies to it.
    scale_ = scale_volume_ ? (static_cast<std::int32_t>(settings.volume) * 4096) / 100 : 4096;
    std::int32_t fade = 4096;
    const std::uint32_t fade_at = audio_fade_at_ms;
    if (fade_at != 0) {
      const std::int32_t into = static_cast<std::int32_t>(millis() - fade_at);
      if (into >= static_cast<std::int32_t>(kAudioFadeMs)) {
        fade = 0;
        audio_faded_out = true;
      } else if (into > 0) {
        fade = 4096 - (into * 4096) / static_cast<std::int32_t>(kAudioFadeMs);
      }
    }
    const std::int32_t effective = (scale_ * fade) >> 12;
    bypass_ = effective >= 4096;
    const uint32_t start = pos_;  // where these bytes sit in the file
    if (got == 0 && len > 0 && pos_ + 1 < inner_->getSize()) audio_short_read_at = pos_;
    pos_ += got;
    if (bypass_ || got == 0) return got;
    const std::int32_t scale_now = effective;
    auto* bytes = static_cast<std::uint8_t*>(data);
    uint32_t first = start < data_at_ ? data_at_ - start : 0;  // header bytes pass untouched
    if (first >= got) return got;
    if (have_carry_) {
      // finish the sample split across the previous read
      std::int16_t sample = static_cast<std::int16_t>(carry_ | (bytes[first] << 8));
      scale_samples(&sample, 1, scale_now);
      bytes[first] = static_cast<std::uint8_t>(sample >> 8);
      have_carry_ = false;
      ++first;
    }
    const uint32_t count = (got - first) / 2;
    scale_samples(reinterpret_cast<std::int16_t*>(bytes + first), count, scale_now);
    if ((got - first) & 1) {
      carry_ = bytes[got - 1];
      have_carry_ = true;
    }
    return got;
  }

 private:
  // Move what is left to the front and top the buffer up from the card.
  void refill() {
    if (buffer_ == nullptr || eof_) return;
    if (held_ > 0 && head_ > 0) std::memmove(buffer_, buffer_ + head_, held_);
    head_ = 0;
    CardLock lock;
    const uint32_t got = inner_->read(buffer_ + held_, static_cast<uint32_t>(kBufferBytes - held_));
    if (got == 0) eof_ = true;
    held_ += got;
  }
  AudioFileSource* inner_;
  std::uint32_t data_at_;
  std::int32_t scale_;
  bool bypass_;
  bool scale_volume_;
  std::uint8_t* buffer_;
  std::size_t head_{0};  // next unread byte in buffer_
  std::size_t held_{0};  // unread bytes in buffer_
  bool eof_{false};
  std::uint8_t carry_{0};
  bool have_carry_{false};
  uint32_t pos_{0};
};

}  // namespace apple::live
