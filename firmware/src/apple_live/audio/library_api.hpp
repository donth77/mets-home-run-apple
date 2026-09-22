#pragma once

// The track library, as the Manager sees it: uploads, edits, the up-next
// lines, and playing a track in the browser.

#include "apple/firmware/manager.hpp"

#include <Arduino.h>
#include <SD.h>

#include <cstddef>
#include <cstdint>

namespace apple::live {

String begin_audio_upload(const String& filename);
bool write_audio_upload(const std::uint8_t* data, std::size_t length);
String end_audio_upload(bool keep);
String open_audio_file(const String& name, File& out);
String change_audio(const apple::firmware::AudioChange& change);
void write_audio_library(Print& out);

}  // namespace apple::live
