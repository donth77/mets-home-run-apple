// Track C bench diagnostic: microSD on the shared SPI bus with its own chip
// select on A0, and the MAX98357A I2S amplifier on A1/A2/A3. Motion pins are
// held low for the whole session; keep the 12 V supply unplugged. Software gain
// starts at 10 % and is capped at 35 % until the accessory rail is qualified.

#include "apple/firmware/board_pins.hpp"

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <AudioFileSourcePROGMEM.h>
#include <AudioFileSourceSD.h>
#include <AudioGeneratorWAV.h>
#include <AudioOutputI2S.h>
#include <SD.h>
#include <SPI.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using apple::firmware::kDisplayChipSelectPin;
using apple::firmware::kDisplayDataCommandPin;
using apple::firmware::kDisplayResetPin;

constexpr std::uint8_t kSdChipSelectPin = A0;
constexpr std::uint8_t kI2sBitClockPin = A1;
constexpr std::uint8_t kI2sWordSelectPin = A2;
constexpr std::uint8_t kI2sDataPin = A3;
constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr char kFirmwareVersion[] = "0.1.0";
constexpr char kProfileName[] = "audio_test";
constexpr char kFixturePath[] = "/tone.wav";

constexpr float kGainSteps[] = {0.10F, 0.20F, 0.35F};
constexpr std::uint8_t kGainPercents[] = {10, 20, 35};

constexpr std::uint32_t kToneSampleRate = 22'050;
constexpr std::uint32_t kToneSeconds = 1;
constexpr std::uint32_t kToneFrames = kToneSampleRate * kToneSeconds;
constexpr std::uint32_t kToneBytes = 44 + kToneFrames * 2;

constexpr std::uint16_t kMetsBlue = 0x016E;
constexpr std::uint16_t kMetsOrange = 0xFAC2;
constexpr std::uint16_t kDarkBlue = 0x0008;
constexpr std::uint16_t kMutedBlue = 0x5B2E;

// ESP8266Audio hands pin numbers straight to the ESP-IDF I2S driver, which
// wants GPIO numbers. With the Nano's Arduino pin numbering active, translate.
int gpio_of(std::uint8_t pin) {
#if defined(BOARD_HAS_PIN_REMAP) && !defined(BOARD_USES_HW_GPIO_NUMBERS)
  return digitalPinToGPIONumber(pin);
#else
  return pin;
#endif
}

Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin,
                      kDisplayResetPin);
AudioOutputI2S* output = nullptr;
AudioGeneratorWAV* generator = nullptr;
AudioFileSource* source = nullptr;
std::uint8_t tone_wav[kToneBytes];
std::size_t gain_index = 0;
bool sd_mounted = false;
std::uint64_t sd_card_bytes = 0;
char playing[24] = "";
char last_status[32] = "IDLE";

void set_text(std::uint16_t color, std::uint8_t size) {
  panel.setTextColor(color);
  panel.setTextSize(size);
  panel.setTextWrap(false);
}

void draw_centered(const char* text, std::int16_t center_x, std::int16_t y,
                   std::uint8_t size, std::uint16_t color) {
  std::int16_t bounds_x = 0;
  std::int16_t bounds_y = 0;
  std::uint16_t bounds_width = 0;
  std::uint16_t bounds_height = 0;
  set_text(color, size);
  panel.getTextBounds(text, 0, y, &bounds_x, &bounds_y, &bounds_width,
                      &bounds_height);
  panel.setCursor(center_x - static_cast<std::int16_t>(bounds_width / 2), y);
  panel.print(text);
}

void draw_state() {
  panel.fillScreen(kDarkBlue);
  panel.fillRect(0, 0, 320, 54, kMetsBlue);
  panel.fillRect(0, 50, 320, 4, kMetsOrange);
  draw_centered("AUDIO / SD TEST", 160, 17, 2, ST77XX_WHITE);

  char line[72];
  snprintf(line, sizeof(line), "SD %s", sd_mounted ? "MOUNTED" : "NOT MOUNTED");
  draw_centered(line, 160, 76, 2, sd_mounted ? ST77XX_WHITE : kMutedBlue);
  snprintf(line, sizeof(line), "%s %s", last_status, playing);
  draw_centered(line, 160, 110, 2,
                generator != nullptr ? kMetsOrange : kMutedBlue);
  snprintf(line, sizeof(line), "GAIN %u%%", kGainPercents[gain_index]);
  draw_centered(line, 160, 144, 2, ST77XX_WHITE);

  draw_centered("m=MOUNT k=CRC t=TONE p=PLAY s=STOP", 160, 195, 1, kMutedBlue);
  draw_centered("1/2/3=GAIN 10/20/35  a=ALTERNATE", 160, 210, 1, kMutedBlue);
  draw_centered("MOTOR PINS LOW - 12V UNPLUGGED", 160, 225, 1, kMutedBlue);
}

void publish_hello() {
  Serial.printf(
      "APPLE_AUDIO:{\"type\":\"hello\",\"profile\":\"%s\","
      "\"firmwareVersion\":\"%s\",\"sdChipSelect\":\"A0\",\"i2s\":{\"bclk\":\"A1\","
      "\"lrc\":\"A2\",\"din\":\"A3\"},\"gainPercent\":%u,\"gainCapPercent\":%u,"
      "\"fixture\":\"%s\"}\n",
      kProfileName, kFirmwareVersion, kGainPercents[gain_index],
      kGainPercents[2], kFixturePath);
}

void publish_state() {
  Serial.printf(
      "APPLE_AUDIO:{\"type\":\"state\",\"sdMounted\":%s,\"cardMb\":%lu,"
      "\"playing\":\"%s\",\"status\":\"%s\",\"gainPercent\":%u}\n",
      sd_mounted ? "true" : "false",
      static_cast<unsigned long>(sd_card_bytes / (1024ULL * 1024ULL)), playing,
      last_status, kGainPercents[gain_index]);
}

void publish_play(const char* status, const char* what) {
  snprintf(last_status, sizeof(last_status), "%s", status);
  Serial.printf("APPLE_AUDIO:{\"type\":\"play\",\"status\":\"%s\",\"source\":\"%s\"}\n",
                status, what);
}

void build_tone() {
  // 44-byte PCM WAV header followed by one second of a 440 Hz sine at 30 %.
  const std::uint32_t data_bytes = kToneFrames * 2;
  std::uint8_t* h = tone_wav;
  auto put32 = [](std::uint8_t* at, std::uint32_t v) {
    at[0] = v & 0xFF; at[1] = (v >> 8) & 0xFF; at[2] = (v >> 16) & 0xFF; at[3] = (v >> 24) & 0xFF;
  };
  auto put16 = [](std::uint8_t* at, std::uint16_t v) {
    at[0] = v & 0xFF; at[1] = (v >> 8) & 0xFF;
  };
  std::memcpy(h, "RIFF", 4); put32(h + 4, 36 + data_bytes);
  std::memcpy(h + 8, "WAVE", 4);
  std::memcpy(h + 12, "fmt ", 4); put32(h + 16, 16); put16(h + 20, 1); put16(h + 22, 1);
  put32(h + 24, kToneSampleRate); put32(h + 28, kToneSampleRate * 2);
  put16(h + 32, 2); put16(h + 34, 16);
  std::memcpy(h + 36, "data", 4); put32(h + 40, data_bytes);
  const std::uint32_t fade = kToneSampleRate / 50;
  for (std::uint32_t n = 0; n < kToneFrames; ++n) {
    float envelope = 1.0F;
    if (n < fade) envelope = static_cast<float>(n) / fade;
    else if (n >= kToneFrames - fade) envelope = static_cast<float>(kToneFrames - n) / fade;
    const float sample = 0.30F * envelope *
                         sinf(2.0F * static_cast<float>(M_PI) * 440.0F * n / kToneSampleRate);
    const std::int16_t value = static_cast<std::int16_t>(sample * 32767.0F);
    put16(h + 44 + n * 2, static_cast<std::uint16_t>(value));
  }
}

std::uint32_t crc32_update(std::uint32_t crc, const std::uint8_t* data, std::size_t len) {
  crc = ~crc;
  for (std::size_t i = 0; i < len; ++i) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; ++bit) {
      crc = (crc >> 1) ^ (0xEDB88320U & (0U - (crc & 1U)));
    }
  }
  return ~crc;
}

void stop_playback(const char* status) {
  if (generator != nullptr) {
    if (generator->isRunning()) generator->stop();
    delete generator;
    generator = nullptr;
  }
  delete source;
  source = nullptr;
  if (status != nullptr) publish_play(status, playing);
  playing[0] = '\0';
  draw_state();
  publish_state();
}

void mount_sd() {
  if (sd_mounted) {
    SD.end();
    sd_mounted = false;
  }
  sd_mounted = SD.begin(kSdChipSelectPin, SPI);
  sd_card_bytes = sd_mounted ? SD.cardSize() : 0;
  Serial.printf("APPLE_AUDIO:{\"type\":\"sd\",\"status\":\"%s\",\"cardMb\":%lu,\"files\":[",
                sd_mounted ? "MOUNTED" : "MISSING",
                static_cast<unsigned long>(sd_card_bytes / (1024ULL * 1024ULL)));
  if (sd_mounted) {
    File root = SD.open("/");
    bool first = true;
    for (File entry = root.openNextFile(); entry; entry = root.openNextFile()) {
      if (!entry.isDirectory()) {
        Serial.printf("%s{\"name\":\"%s\",\"bytes\":%lu}", first ? "" : ",",
                      entry.name(), static_cast<unsigned long>(entry.size()));
        first = false;
      }
      entry.close();
    }
    root.close();
  }
  Serial.println("]}");
  draw_state();
  publish_state();
}

void checksum_fixture() {
  if (!sd_mounted) {
    Serial.println("APPLE_AUDIO:{\"type\":\"checksum\",\"status\":\"NO_CARD\"}");
    return;
  }
  File file = SD.open(kFixturePath, FILE_READ);
  if (!file) {
    Serial.printf("APPLE_AUDIO:{\"type\":\"checksum\",\"status\":\"MISSING\",\"file\":\"%s\"}\n",
                  kFixturePath);
    return;
  }
  std::uint8_t buffer[512];
  std::uint32_t crc = 0;
  std::uint32_t bytes = 0;
  while (file.available()) {
    const int got = file.read(buffer, sizeof(buffer));
    if (got <= 0) break;
    crc = crc32_update(crc, buffer, static_cast<std::size_t>(got));
    bytes += static_cast<std::uint32_t>(got);
  }
  file.close();
  Serial.printf("APPLE_AUDIO:{\"type\":\"checksum\",\"status\":\"OK\",\"file\":\"%s\","
                "\"bytes\":%lu,\"crc32\":\"%08lx\"}\n",
                kFixturePath, static_cast<unsigned long>(bytes),
                static_cast<unsigned long>(crc));
}

void start_playback(bool from_sd) {
  stop_playback(nullptr);
  if (from_sd) {
    if (!sd_mounted) {
      publish_play("FAILED", "SD not mounted");
      return;
    }
    source = new AudioFileSourceSD(kFixturePath);
    snprintf(playing, sizeof(playing), "SD %s", kFixturePath);
  } else {
    source = new AudioFileSourcePROGMEM(tone_wav, kToneBytes);
    snprintf(playing, sizeof(playing), "TONE 440 Hz");
  }
  generator = new AudioGeneratorWAV();
  output->SetGain(kGainSteps[gain_index]);
  if (!generator->begin(source, output)) {
    publish_play("FAILED", playing);
    stop_playback(nullptr);
    return;
  }
  publish_play("STARTED", playing);
  draw_state();
  publish_state();
}

void set_gain(std::size_t index) {
  gain_index = index;
  if (output != nullptr) output->SetGain(kGainSteps[gain_index]);
  Serial.printf("APPLE_AUDIO:{\"type\":\"gain\",\"percent\":%u}\n", kGainPercents[gain_index]);
  draw_state();
  publish_state();
}

// Track C1 exit gate: alternate display writes with SD reads and prove the
// two chip selects never fight over the bus.
void alternation_test() {
  if (!sd_mounted) {
    Serial.println("APPLE_AUDIO:{\"type\":\"test\",\"name\":\"display_sd_alternation\",\"status\":\"NO_CARD\"}");
    return;
  }
  File file = SD.open(kFixturePath, FILE_READ);
  if (!file) {
    Serial.println("APPLE_AUDIO:{\"type\":\"test\",\"name\":\"display_sd_alternation\",\"status\":\"MISSING_FIXTURE\"}");
    return;
  }
  std::uint8_t reference[256];
  const int reference_len = file.read(reference, sizeof(reference));
  unsigned passes = 0;
  unsigned fails = 0;
  for (unsigned i = 0; i < 100; ++i) {
    panel.fillRect(20 + (i % 10) * 28, 160, 24, 12, (i % 2) ? kMetsOrange : kMetsBlue);
    file.seek(0);
    std::uint8_t again[256];
    const int got = file.read(again, sizeof(again));
    if (got == reference_len && std::memcmp(again, reference, static_cast<std::size_t>(got)) == 0) {
      ++passes;
    } else {
      ++fails;
    }
  }
  file.close();
  Serial.printf("APPLE_AUDIO:{\"type\":\"test\",\"name\":\"display_sd_alternation\","
                "\"status\":\"%s\",\"passes\":%u,\"fails\":%u}\n",
                fails == 0 ? "PASSED" : "FAILED", passes, fails);
  draw_state();
}

}  // namespace

void setup() {
  apple::firmware::disarm_motion_outputs();

  Serial.begin(115200);
  const std::uint32_t serial_wait_started_ms = millis();
  while (!Serial && millis() - serial_wait_started_ms < kSerialWaitTimeoutMs) {
    delay(10);
  }

  SPI.begin();
  panel.init(240, 320);
  panel.setRotation(1);
  panel.invertDisplay(true);

  build_tone();
  output = new AudioOutputI2S();
  output->SetPinout(gpio_of(kI2sBitClockPin), gpio_of(kI2sWordSelectPin),
                    gpio_of(kI2sDataPin));
  output->SetOutputModeMono(true);
  output->SetGain(kGainSteps[gain_index]);

  draw_state();
  publish_hello();
  publish_state();
  Serial.println("AUDIO_TEST=READY COMMANDS=m:mount_sd k:checksum t:tone p:play_sd "
                 "s:stop 1/2/3:gain a:alternation ?:status");
  Serial.println("MOTOR_PINS=LOW KEEP_12V=UNPLUGGED");
}

void loop() {
  if (generator != nullptr && generator->isRunning()) {
    if (!generator->loop()) {
      stop_playback("FINISHED");
    }
  }

  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    switch (command) {
      case 'm': case 'M': mount_sd(); break;
      case 'k': case 'K': checksum_fixture(); break;
      case 't': case 'T': start_playback(false); break;
      case 'p': case 'P': start_playback(true); break;
      case 's': case 'S': stop_playback("STOPPED"); break;
      case '1': set_gain(0); break;
      case '2': set_gain(1); break;
      case '3': set_gain(2); break;
      case 'a': case 'A': alternation_test(); break;
      case '?': publish_hello(); publish_state(); break;
      default: break;
    }
  }
}
