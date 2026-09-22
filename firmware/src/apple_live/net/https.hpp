#pragma once

// Certificate-checked HTTPS to the MLB Stats API, with bounded waits so a
// weak link cannot hold the main loop.

#include <Arduino.h>
#include <ArduinoJson.h>

#include <cstdint>

namespace apple::live {

constexpr char kMlbOrigin[] = "https://statsapi.mlb.com";
constexpr std::uint32_t kHttpTimeoutMs = 20'000;

struct FetchStats {
  int http_status{0};
  std::uint32_t bytes{0};
  std::uint32_t elapsed_ms{0};
  char error[64] = "";  // why it failed, in words the Manager can show
};

// Pins the MLB client to MLB's root certificate and sets its timeouts.
void configure_mlb_client();
bool fetch_json(const String& url, JsonDocument& doc, const char* filter_json, FetchStats& stats);

}  // namespace apple::live
