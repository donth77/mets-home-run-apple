#include "apple_live/net/updates.hpp"

#include "apple_live/display/celebration.hpp"
#include "apple_live/display/display.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/https.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/boot_guard.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/psram.hpp"
#include "apple_live/system/trace.hpp"
#include "apple_live/version.hpp"

#include "apple/firmware/firmware_update.hpp"
#include "apple/firmware/screens.hpp"
#include "apple/firmware/update_roots.hpp"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <ctime>

// Releases on GitHub: the Apple checks for itself and installs between games.
//
// The releases list and the signed .bin come from GitHub over TLS pinned to
// the roots in update_roots.hpp. Asset downloads answer with a redirect to a
// separate host, followed by hand so the token never leaves api.github.com.
// A private repository needs the developer token; a public one needs none.

namespace apple::live {

using apple::firmware::ScreenState;
using apple::firmware::copy_text;

namespace {

// Release checks against GitHub: shortly after joining Wi-Fi, then daily;
// sooner after a failure. Installs wait for the quiet window between games.
constexpr std::uint32_t kReleaseCheckPeriodMs = 24UL * 60 * 60 * 1000;
constexpr std::uint32_t kReleaseRetryMs = 60UL * 60 * 1000;
constexpr int kInstallWindowStartHour = 3;  // local time, inclusive
constexpr int kInstallWindowEndHour = 6;    // exclusive
constexpr char kReleasesUrl[] = "https://api.github.com/repos/donth77/mets-home-run-apple/releases?per_page=10";

}  // namespace

ReleaseStatus release;

namespace {

void release_failed(const char* code) {
  copy_text(release.error, sizeof(release.error), code);
  release.state = ReleaseState::Failed;
  release.next_check_ms = now32() + kReleaseRetryMs;
  char detail[64];
  std::snprintf(detail, sizeof(detail), "failed: %s", code);
  publish_trace("RELEASE", detail);
}

void prepare_github_client(WiFiClientSecure& client) {
  client.setCACert(apple::firmware::kUpdateRootsPem);
  client.setHandshakeTimeout(kHttpTimeoutMs / 1000);
  client.setTimeout(kHttpTimeoutMs / 1000);
}

// A GET against GitHub; the token goes only to api.github.com.
int github_get(HTTPClient& http, WiFiClientSecure& client, const char* url, const char* accept, bool with_token) {
  http.setReuse(false);
  http.setTimeout(kHttpTimeoutMs);
  http.setConnectTimeout(kHttpTimeoutMs);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.setUserAgent((String("HomeRunApple/") + kFirmwareVersion + " (Arduino Nano ESP32)").c_str());
  if (!http.begin(client, url)) return -1000;
  http.addHeader("Accept", accept);
  http.addHeader("X-GitHub-Api-Version", "2022-11-28");
  if (with_token && settings.github_token[0] != '\0') {
    http.addHeader("Authorization", String("Bearer ") + settings.github_token);
  }
  esp_task_wdt_reset();
  return http.GET();
}

void describe_http_failure(int code, WiFiClientSecure& client, HTTPClient& http, char* out, std::size_t capacity) {
  if (code == -1000) {
    std::snprintf(out, capacity, "HTTP_BEGIN");
  } else if (code < 0) {
    char tls[40] = "";
    client.lastError(tls, sizeof(tls));
    std::snprintf(out, capacity, "%s", tls[0] ? "TLS_HANDSHAKE" : http.errorToString(code).c_str());
  } else {
    std::snprintf(out, capacity, "HTTP_%d", code);
  }
}

void check_for_release() {
  release.state = ReleaseState::Checking;
  release.error[0] = '\0';
  publish_trace("RELEASE", settings.beta ? "checking GitHub (pre-releases included)" : "checking GitHub");
  WiFiClientSecure client;
  prepare_github_client(client);
  HTTPClient http;
  const int code = github_get(http, client, kReleasesUrl, "application/vnd.github+json", true);
  if (code != HTTP_CODE_OK) {
    char why[40];
    describe_http_failure(code, client, http, why, sizeof(why));
    http.end();
    release_failed(code == HTTP_CODE_NOT_FOUND && settings.github_token[0] == '\0' ? "PRIVATE_REPOSITORY" : why);
    return;
  }
  JsonDocument filter;
  deserializeJson(filter, apple::firmware::releases_filter_json());
  JsonDocument doc(&json_allocator);
  const ArduinoJson::DeserializationError error =
      deserializeJson(doc, http.getStream(), ArduinoJson::DeserializationOption::Filter(filter),
                      ArduinoJson::DeserializationOption::NestingLimit(8));
  http.end();
  if (error != ArduinoJson::DeserializationError::Ok) {
    release_failed("JSON");
    return;
  }
  release.pick = apple::firmware::pick_release(doc.as<JsonArrayConst>(), kFirmwareVersion, settings.beta);
  release.checked_at = wall_epoch();
  release.next_check_ms = now32() + kReleaseCheckPeriodMs;
  if (!release.pick.found) {
    release.state = ReleaseState::UpToDate;
    publish_trace("RELEASE", "up to date");
    return;
  }
  release.state = ReleaseState::Available;
  char detail[96];
  std::snprintf(detail, sizeof(detail), "%s available (%ld bytes)%s", release.pick.version.c_str(),
                release.pick.asset_size, release.pick.prerelease ? " pre-release" : "");
  publish_trace("RELEASE", detail);
}

// Streams one HTTP body into the spare slot; true once it is verified.
bool stream_release_image(HTTPClient& http) {
  apple::firmware::FirmwareUpdater updater;
  if (!updater.begin()) {
    release_failed(updater.error());
    return false;
  }
  WiFiClient* stream = http.getStreamPtr();
  int remaining = http.getSize();
  std::uint32_t last_data_ms = now32();
  std::uint32_t total = 0;
  static std::uint8_t buffer[2048];
  while (http.connected() && (remaining > 0 || remaining == -1)) {
    const std::size_t available = stream->available();
    if (available > 0) {
      const int n = stream->readBytes(buffer, std::min(available, sizeof(buffer)));
      if (n <= 0) break;
      updater.write(buffer, static_cast<std::size_t>(n));
      total += static_cast<std::uint32_t>(n);
      if (remaining > 0) remaining -= n;
      last_data_ms = now32();
    } else {
      if (static_cast<std::int32_t>(now32() - last_data_ms) > static_cast<std::int32_t>(kHttpTimeoutMs)) break;
      delay(1);
    }
    esp_task_wdt_reset();
  }
  if (remaining > 0 || (release.pick.asset_size > 0 && total != static_cast<std::uint32_t>(release.pick.asset_size))) {
    updater.abort();
    release_failed("SHORT_DOWNLOAD");
    return false;
  }
  if (!updater.end()) {
    release_failed(updater.error());
    return false;
  }
  return true;
}

void download_release() {
  release.state = ReleaseState::Downloading;
  release.error[0] = '\0';
  char detail[96];
  std::snprintf(detail, sizeof(detail), "downloading %s", release.pick.asset_name.c_str());
  publish_trace("RELEASE", detail);
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  copy_text(model.waiting_note, sizeof(model.waiting_note), release.pick.version.c_str());
  show_waiting("DOWNLOADING UPDATE", apple::firmware::kMetsOrange, apple::firmware::WaitingIcon::Update);
  render_if_needed();

  WiFiClientSecure client;
  prepare_github_client(client);
  bool installed = false;
  String location;
  {
    HTTPClient http;
    const int code = github_get(http, client, release.pick.asset_url.c_str(), "application/octet-stream", true);
    if (code == HTTP_CODE_OK) {
      installed = stream_release_image(http);
    } else if (code == HTTP_CODE_FOUND || code == HTTP_CODE_MOVED_PERMANENTLY ||
               code == HTTP_CODE_TEMPORARY_REDIRECT || code == HTTP_CODE_SEE_OTHER || code == 308) {
      location = http.getLocation();
    } else {
      char why[40];
      describe_http_failure(code, client, http, why, sizeof(why));
      release_failed(why);
    }
    http.end();
  }
  if (!installed && location.length() > 0) {
    // The download host takes no token; the URL itself carries a short-lived signature.
    HTTPClient http;
    const int code = github_get(http, client, location.c_str(), "application/octet-stream", false);
    if (code == HTTP_CODE_OK) {
      installed = stream_release_image(http);
    } else {
      char why[40];
      describe_http_failure(code, client, http, why, sizeof(why));
      release_failed(why);
    }
    http.end();
  }
  if (!installed) {
    if (release.state != ReleaseState::Failed) release_failed("NO_LOCATION");
    request_redraw();
    return;
  }
  publish_trace("RELEASE", "installed; restarting");
  on_update_done();
}

}  // namespace

String update_gate() {
  if (safe_mode) return String();
  if (!boot_settled) return "BUSY";
  if (celebration_active || !motion_idle()) return "CELEBRATING";
  if (model.state == ScreenState::Game) return "GAME_IN_PROGRESS";
  return String();
}

// The new image is verified and bootable. Remember where to fall back to,
// show a card, and restart shortly after the reply has gone out.
void on_update_done() {
  note_update_installed();
  publish_trace("UPDATE", "installed; restarting into the new firmware");
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  copy_text(model.waiting_note, sizeof(model.waiting_note), "RESTARTING");
  show_waiting("UPDATING", apple::firmware::kMetsOrange, apple::firmware::WaitingIcon::Update);
  render_if_needed();
  request_restart(1500);
}

// Restart from the page, once nothing is moving.
String on_restart_request() {
  if (celebration_active || !motion_idle()) return "CELEBRATING";
  publish_trace("RESET", "restart requested from the manager page");
  request_restart(1000);
  return String();
}

const char* release_state_name(ReleaseState state) {
  switch (state) {
    case ReleaseState::Checking: return "CHECKING";
    case ReleaseState::UpToDate: return "UP_TO_DATE";
    case ReleaseState::Available: return "AVAILABLE";
    case ReleaseState::Downloading: return "DOWNLOADING";
    case ReleaseState::Failed: return "FAILED";
    case ReleaseState::Idle:
    default: return "IDLE";
  }
}

// Installs happen in the early morning between games, never mid-game.
bool install_window_open() {
  if (!clock_valid()) return false;
  const time_t at = static_cast<time_t>(wall_epoch());
  struct tm local;
  localtime_r(&at, &local);
  if (local.tm_hour < kInstallWindowStartHour || local.tm_hour >= kInstallWindowEndHour) return false;
  if (game && apple::mlb_feed::should_poll(*game, wall_epoch(), kPregameLeadSeconds)) return false;
  return update_gate().length() == 0;
}

void service_release() {
  if (safe_mode || !boot_settled || net_state != NetState::Connected || !clock_valid()) return;
  if (manager.update_in_progress() || replay_active) return;
  if (release.install_requested) {
    release.install_requested = false;
    if (release.state == ReleaseState::Available && update_gate().length() == 0) download_release();
    return;
  }
  if (release.state == ReleaseState::Available && settings.auto_update && install_window_open()) {
    download_release();
    return;
  }
  const bool check_due = release.next_check_ms != 0 && due(release.next_check_ms);
  if (release.check_requested || check_due) {
    release.check_requested = false;
    if (celebration_active || !motion_idle()) {
      release.next_check_ms = now32() + 60 * 1000;
      return;
    }
    check_for_release();
  }
}

String on_check_request() {
  if (net_state != NetState::Connected) return "OFFLINE";
  if (release.state == ReleaseState::Downloading || release.state == ReleaseState::Checking) return "BUSY";
  release.check_requested = true;
  return String();
}

String on_install_request() {
  if (release.state != ReleaseState::Available) return "NO_UPDATE";
  const String why = update_gate();
  if (why.length() > 0) return why;
  release.install_requested = true;
  return String();
}

}  // namespace apple::live
