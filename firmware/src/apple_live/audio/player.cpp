#include "apple_live/audio/player.hpp"

#include "apple_live/audio/card.hpp"
#include "apple_live/audio/scaled_source.hpp"
#include "apple_live/audio/track_library.hpp"
#include "apple_live/audio/wav.hpp"
#include "apple_live/display/celebration.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/pins.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <AudioFileSourcePROGMEM.h>
#include <AudioFileSourceSD.h>
#include <AudioGeneratorWAV.h>
#include <AudioOutputI2S.h>
#include <SD.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace apple::live {

using apple::firmware::copy_text;
using apple::game_state::GameSnapshot;

namespace {

// About 190 ms of queued audio, at 16 KB of DMA memory. Playback has a core to
// itself, so the queue only has to absorb Wi-Fi bursts rather than the
// celebration display, which occupies its own core for ~24 ms a frame. A
// 740 ms queue was tried while playback still shared that core and did not
// help, because the generator cannot refill it in the gaps between frames.
constexpr int kI2sDmaBuffers = 32;
// A celebration runs about 46 s, so there is no point holding more of a track
// than that. Two of these live in PSRAM at once, one per list.
constexpr std::uint32_t kResidentTrackBytes = 50UL * 22050 * 2 + 64;

AudioOutputI2S* audio_out = nullptr;
AudioGeneratorWAV* audio_gen = nullptr;
AudioFileSource* audio_file = nullptr;
AudioFileSourceScaled* audio_scaled = nullptr;
// Playback runs in its own task on the second core, out of reach of the
// display's timing.
TaskHandle_t audio_task = nullptr;

}  // namespace

char audio_playing[40] = "";
// Whoever is at the plate, so their track can be brought into memory before
// they swing. Empty between batters.
char current_batter[40] = "";
ResidentTrack resident_home_run;
ResidentTrack resident_win;
bool resident_refresh_wanted = false;
// Core 1 asks for a track; the audio task builds, plays and tears down
// everything itself. Installing the I2S driver also registers its interrupt on
// the calling core, and that interrupt is what hands recycled DMA buffers back
// to the writer. Registered on the display's core it cannot run while a frame
// is drawing, so the queue stalls however deep it is. It must be installed
// from the audio task.
volatile bool audio_task_should_play = false;

namespace {

// Set by the audio task when a track streamed off the card stopped early
// and the held copy took over; the main loop shortens the raised dwell.
volatile bool audio_stream_broke = false;
std::uint32_t audio_stream_size = 0;      // the streamed file's length, noted while it is still open
volatile bool audio_task_playing = false;
volatile bool audio_request_is_win = false;

}  // namespace

// A win with the whole-track setting streams its file off the card rather
// than playing the 50 s copy in memory. The card has its own SPI bus, so the
// audio task's blocking reads touch nothing the display uses.
volatile bool audio_request_stream = false;
char win_stream_file[32] = "";
std::uint32_t win_stream_data_at = 44;

namespace {

std::uint32_t audio_bytes_read = 0;
std::uint32_t audio_started_ms = 0;
std::int32_t audio_depth_min = 0;
std::uint32_t audio_burst_max = 0;
std::uint32_t audio_bursts = 0;
// How long the audio goes unattended. The celebration animation pushes whole
// frames while it plays, so this is the number that decides whether playback
// survives it.
std::uint32_t audio_gap_worst_us = 0;
std::uint32_t audio_gap_last_us = 0;
std::uint32_t audio_service_calls = 0;

// ESP8266Audio passes pin numbers straight to the ESP-IDF I2S driver, which
// wants GPIO numbers rather than Arduino pin numbers.
int gpio_of(std::uint8_t pin) {
#if defined(BOARD_HAS_PIN_REMAP) && !defined(BOARD_USES_HW_GPIO_NUMBERS)
  return digitalPinToGPIONumber(pin);
#else
  return pin;
#endif
}

// Runs only on the audio task, because AudioOutputI2S::stop() uninstalls the
// I2S driver and frees the interrupt that was allocated on this core.
void teardown_audio() {
  if (audio_gen != nullptr) {
    if (audio_gen->isRunning()) audio_gen->stop();
    delete audio_gen;
    audio_gen = nullptr;
  }
  delete audio_scaled;
  audio_scaled = nullptr;
  delete audio_file;
  audio_file = nullptr;
  if (audio_playing[0] != '\0') {
    char detail[112];
    std::snprintf(detail, sizeof(detail),
                  "stopped; %lu KB read, biggest refill %lu bytes, %lu bursts",
                  static_cast<unsigned long>(audio_bytes_read / 1024),
                  static_cast<unsigned long>(audio_burst_max),
                  static_cast<unsigned long>(audio_bursts));
    publish_trace("AUDIO", detail);
  }
  audio_playing[0] = '\0';
}

// Playback runs here, on whichever core the Arduino loop is not using. The
// celebration display holds its core in a hard-timed loop for about 24 ms a
// frame to stay tear-free, and anything sharing that core goes unserviced for
// as long. Audio cannot survive that, so it is moved out of reach.
void audio_task_main(void*) {
  for (;;) {
    if (!audio_task_should_play) {
      if (audio_gen != nullptr) teardown_audio();
      audio_task_playing = false;
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }
    if (audio_gen == nullptr) {
      const bool stream = audio_request_is_win && audio_request_stream;
      const ResidentTrack& track =
          audio_request_is_win ? resident_win : resident_home_run;
      if (audio_out == nullptr || (!stream && (track.data == nullptr || track.bytes == 0))) {
        audio_task_should_play = false;
        continue;
      }
      AudioFileSource* source = nullptr;
      const char* name = track.name;
      if (stream) {
        CardLock lock;
        audio_file = new AudioFileSourceSD(win_stream_file);
        audio_scaled = new AudioFileSourceScaled(audio_file, win_stream_data_at, settings.volume);
        source = audio_scaled;
        name = win_stream_file;
      } else {
        audio_file = new AudioFileSourcePROGMEM(track.data, track.bytes);
        std::uint32_t at = 44, length = 0;
        if (!find_wav_data(track.data, track.bytes, at, length)) at = 44;
        audio_scaled = new AudioFileSourceScaled(audio_file, at, 100, false);
        source = audio_scaled;
      }
      audio_gen = new AudioGeneratorWAV();
      audio_out->SetGain(1.0F);  // never anything else; see player.hpp
      audio_gap_worst_us = 0;
      audio_gap_last_us = 0;
      audio_service_calls = 0;
      audio_bytes_read = 0;
      if (!audio_gen->begin(source, audio_out)) {
        publish_trace("AUDIO", "track would not start");
        audio_task_should_play = false;
        teardown_audio();
        continue;
      }
      copy_text(audio_playing, sizeof(audio_playing), name);
      audio_stream_size = stream ? audio_file->getSize() : 0;
      audio_short_read_at = 0;
      audio_started_ms = millis();
      audio_depth_min = 0x7FFFFFFF;
      audio_burst_max = 0;
      audio_bursts = 0;
      audio_task_playing = true;
      publish_trace("AUDIO", name);
    }
    const std::uint32_t now_us = micros();
    if (audio_gap_last_us != 0) {
      const std::uint32_t gap = now_us - audio_gap_last_us;
      if (gap > audio_gap_worst_us) audio_gap_worst_us = gap;
    }
    ++audio_service_calls;
    if (audio_faded_out) {
      publish_trace("AUDIO", "faded out");
      audio_task_should_play = false;
      continue;
    }
    if (!audio_gen->loop()) {
      // The player has closed the file by now, so judge by what was read.
      const std::uint32_t at = audio_bytes_read;
      const std::uint32_t size = audio_stream_size;
      const bool stream = audio_request_is_win && audio_request_stream;
      if (stream && size > 0 && at + 4096 < size) {
        // The card stopped delivering long before the end of the track. A
        // silent win is worse than a shorter song, so play the copy in memory.
        char detail[112];
        std::snprintf(detail, sizeof(detail), "stream broke at %lu of %lu KB (card gave nothing at %lu); playing the held copy",
                      static_cast<unsigned long>(at / 1024), static_cast<unsigned long>(size / 1024),
                      static_cast<unsigned long>(audio_short_read_at));
        publish_trace("AUDIO", detail);
        teardown_audio();
        audio_request_stream = false;
        audio_stream_broke = true;
        if (resident_win.data == nullptr || resident_win.bytes == 0) audio_task_should_play = false;
        continue;
      }
      audio_task_should_play = false;  // track finished
    }
    const std::uint32_t pos = audio_file->getPos();
    if (pos > audio_bytes_read) {
      const std::uint32_t delta = pos - audio_bytes_read;
      audio_bytes_read = pos;
      const std::uint32_t since_start = millis() - audio_started_ms;
      if (since_start > 1000) {
        if (delta > audio_burst_max) audio_burst_max = delta;
        if (delta > 1000) ++audio_bursts;
      }
    }
    const std::uint32_t played_ms = millis() - audio_started_ms;
    if (played_ms > 500 && pos > 0) {
      const std::int32_t consumed =
          static_cast<std::int32_t>(static_cast<std::uint64_t>(played_ms) * 44100ULL / 1000ULL);
      const std::int32_t depth = static_cast<std::int32_t>(pos) - consumed;
      if (depth < audio_depth_min) audio_depth_min = depth;
    }
    audio_gap_last_us = micros();
    vTaskDelay(1);
  }
}

}  // namespace

void begin_audio_output() {
  audio_out = new AudioOutputI2S(0, AudioOutputI2S::EXTERNAL_I2S, kI2sDmaBuffers);
  audio_out->SetPinout(gpio_of(kI2sBitClockPin), gpio_of(kI2sWordSelectPin),
                       gpio_of(kI2sDataPin));
  audio_out->SetOutputModeMono(true);
  audio_out->SetGain(1.0F);
}

void start_audio_task() {
  // Deliberately the other core from this one, which is where loop() and the
  // celebration display run.
  const BaseType_t audio_core = xPortGetCoreID() == 0 ? 1 : 0;
  xTaskCreatePinnedToCore(audio_task_main, "audio", 8192, nullptr, 2, &audio_task,
                          audio_core);
}

std::uint32_t audio_task_stack_free() {
  return audio_task != nullptr ? static_cast<std::uint32_t>(uxTaskGetStackHighWaterMark(audio_task)) : 0;
}

// Asks the audio task to stop, then waits for it to finish tearing down.
void stop_audio() {
  audio_task_should_play = false;
  for (int i = 0; i < 200 && audio_task_playing; ++i) vTaskDelay(pdMS_TO_TICKS(2));
}

// Reads up to kResidentTrackBytes of a track into PSRAM. Only ever called
// while the Apple is idle: it overwrites the copy the audio task plays from.
void load_resident(ResidentTrack& slot, const char* path) {
  CardLock lock;
  if (slot.data == nullptr) {
    slot.data = static_cast<std::uint8_t*>(ps_malloc(kResidentTrackBytes));
    if (slot.data == nullptr) {
      publish_trace("AUDIO", "no PSRAM for a resident track");
      return;
    }
  }
  File file = SD.open(path, FILE_READ);
  if (!file) {
    slot.bytes = 0;
    slot.name[0] = '\0';
    return;
  }
  const std::uint32_t want =
      std::min<std::uint32_t>(file.size(), kResidentTrackBytes);
  const std::uint32_t started = millis();
  slot.bytes = file.read(slot.data, want);
  file.close();
  apply_volume(slot.data, slot.bytes, settings.volume);
  copy_text(slot.name, sizeof(slot.name), path);
  char detail[96];
  std::snprintf(detail, sizeof(detail), "held %s, %lu KB in %lu ms", path,
                static_cast<unsigned long>(slot.bytes / 1024),
                static_cast<unsigned long>(millis() - started));
  publish_trace("AUDIO", detail);
}

// Called when a celebration is accepted. Never blocks the caller for long and
// never reports failure upward: silence is an acceptable celebration.
// The display core only chooses the track and raises the request. Everything
// that touches the I2S driver happens on the audio task; see the note above.
void start_celebration_audio(bool is_win) {
  stop_audio();
  audio_fade_at_ms = 0;
  audio_faded_out = false;
  if (audio_out == nullptr) return;
  // Always the resident copy in PSRAM. The display holds the SPI bus in a
  // hard-timed loop while it draws, so a celebration never reads the card.
  if (!(is_win && audio_request_stream)) {
    const ResidentTrack& track = is_win ? resident_win : resident_home_run;
    if (track.data == nullptr || track.bytes == 0) return;
  }
  audio_request_is_win = is_win;
  audio_task_should_play = true;
}

// The display core only tidies up after a finished track and reloads the
// resident copies while nothing is celebrating. It never feeds the generator.
void service_audio() {
  if (audio_stream_broke) {
    audio_stream_broke = false;
    if (engine && celebration_active) {
      engine->set_raised_dwell_ms(static_cast<std::uint64_t>(settings.raised_seconds) * 1000);
    }
  }
  // Never while a track is playing or being torn down: the refresh overwrites
  // the very buffer the audio task reads from.
  if (resident_refresh_wanted && !celebration_active && audio_gen == nullptr &&
      !audio_task_should_play) {
    refresh_resident_tracks();
  }
  if (manifest_save_wanted && !celebration_active && audio_gen == nullptr && !audio_task_should_play) {
    manifest_save_wanted = false;
    save_audio_manifest();
  }
}

// Watches who is at the plate. When the hitter changes, the next celebration's
// audio is fetched again, which is how a player with their own track gets it
// loaded before they swing rather than after.
void note_batter(const GameSnapshot& snapshot) {
  const char* batter = "";
  if (snapshot.at_bat.has_value() && snapshot.at_bat->batter.has_value()) {
    batter = snapshot.at_bat->batter->c_str();
  }
  if (strcmp(batter, current_batter) == 0) return;
  copy_text(current_batter, sizeof(current_batter), batter);
  resident_refresh_wanted = true;
}

}  // namespace apple::live
