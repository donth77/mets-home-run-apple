#include "apple_live/net/https.hpp"

#include "apple_live/system/clock.hpp"

#include "apple/firmware/mlb_root_ca.hpp"
#include "apple/firmware/screens.hpp"
#include "apple/mlb_feed/feed.hpp"

#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>

#include <cstdint>
#include <cstdio>

namespace apple::live {

using apple::firmware::copy_text;

namespace {

// A response body that trickles in on weak Wi-Fi must not hold the main loop
// (display, button, web server, watchdog) hostage: give up on it after this.
constexpr std::uint32_t kHttpBodyMs = 30'000;

WiFiClientSecure secure_client;

// The TLS library is built without its error-string table, so name the
// failures weak Wi-Fi actually produces; anything else keeps its code.
const char* describe_tls_error(int code) {
  switch (-code) {
    case 0x0042: return "could not open a connection";
    case 0x0044: return "connection failed";
    case 0x004C: return "connection dropped while receiving";
    case 0x004E: return "connection dropped while sending";
    case 0x0050: return "connection reset by the network";
    case 0x0052: return "DNS lookup failed";
    case 0x2700: return "certificate check failed";
    case 0x6800: return "connection timed out";
    case 0x7780: return "server closed the connection";
    default: return nullptr;
  }
}

const char* describe_json_error(ArduinoJson::DeserializationError error) {
  switch (error.code()) {
    case ArduinoJson::DeserializationError::IncompleteInput: return "reply cut short";
    case ArduinoJson::DeserializationError::EmptyInput: return "empty reply";
    case ArduinoJson::DeserializationError::InvalidInput: return "reply was not valid JSON";
    case ArduinoJson::DeserializationError::NoMemory: return "reply too large for memory";
    case ArduinoJson::DeserializationError::TooDeep: return "reply nested too deeply";
    default: return error.c_str();
  }
}

// The response body, watched: feeds the watchdog while bytes arrive and ends
// the stream at a deadline, which the parser then reports as incomplete input
// so the caller retries instead of the watchdog rebooting the Apple.
class WatchedBody : public Stream {
 public:
  WatchedBody(Stream& inner, std::uint32_t deadline_ms) : inner_(inner), deadline_ms_(deadline_ms) {}
  int available() override { return expired() ? 0 : inner_.available(); }
  int read() override {
    if (expired()) return -1;
    const int c = inner_.read();
    esp_task_wdt_reset();
    return c;
  }
  int peek() override { return expired() ? -1 : inner_.peek(); }
  size_t write(std::uint8_t) override { return 0; }
  size_t readBytes(char* buffer, size_t length) override {
    if (expired()) return 0;
    const size_t n = inner_.readBytes(buffer, length);
    esp_task_wdt_reset();
    return n;
  }

 private:
  bool expired() const { return static_cast<std::int32_t>(now32() - deadline_ms_) >= 0; }
  Stream& inner_;
  std::uint32_t deadline_ms_;
};

}  // namespace

void configure_mlb_client() {
  secure_client.setCACert(apple::firmware::kMlbRootCaPem);
  secure_client.setHandshakeTimeout(kHttpTimeoutMs / 1000);
  secure_client.setTimeout(kHttpTimeoutMs / 1000);
}

bool fetch_json(const String& url, JsonDocument& doc, const char* filter_json, FetchStats& stats) {
  JsonDocument filter;
  deserializeJson(filter, filter_json);
  const std::uint32_t started = now32();
  HTTPClient http;
  http.setReuse(false);
  http.setTimeout(kHttpTimeoutMs);
  http.setConnectTimeout(kHttpTimeoutMs);
  http.useHTTP10(true);
  http.setUserAgent("HomeRunApple/0.1 (Arduino Nano ESP32)");
  if (!http.begin(secure_client, url)) {
    copy_text(stats.error, sizeof(stats.error), "could not start the request");
    return false;
  }
  http.addHeader("Accept", "application/json");
  esp_task_wdt_reset();
  stats.http_status = http.GET();
  if (stats.http_status != HTTP_CODE_OK) {
    if (stats.http_status < 0) {
      char tls[40] = "";
      const int tls_code = secure_client.lastError(tls, sizeof(tls));
      const char* words = tls_code ? describe_tls_error(tls_code) : nullptr;
      if (words) {
        copy_text(stats.error, sizeof(stats.error), words);
      } else if (tls_code) {
        std::snprintf(stats.error, sizeof(stats.error), "TLS error %04X", static_cast<unsigned>(-tls_code) & 0xFFFFU);
      } else {
        copy_text(stats.error, sizeof(stats.error), http.errorToString(stats.http_status).c_str());
      }
    } else {
      std::snprintf(stats.error, sizeof(stats.error), "MLB answered HTTP %d", stats.http_status);
    }
    http.end();
    return false;
  }
  stats.bytes = http.getSize() > 0 ? static_cast<std::uint32_t>(http.getSize()) : 0;
  esp_task_wdt_reset();
  WatchedBody body(http.getStream(), now32() + kHttpBodyMs);
  const ArduinoJson::DeserializationError error = deserializeJson(
      doc, body, ArduinoJson::DeserializationOption::Filter(filter),
      ArduinoJson::DeserializationOption::NestingLimit(apple::mlb_feed::kLiveFeedNestingLimit));
  http.end();
  stats.elapsed_ms = now32() - started;
  if (error != ArduinoJson::DeserializationError::Ok) {
    copy_text(stats.error, sizeof(stats.error), describe_json_error(error));
    return false;
  }
  if (doc.overflowed()) {
    copy_text(stats.error, sizeof(stats.error), "reply too large for memory");
    return false;
  }
  return true;
}

}  // namespace apple::live
