#include "apple/firmware/manager.hpp"
#include "apple/firmware/time_zones.hpp"

#include "apple/firmware/manager_logo.hpp"
#include "apple/firmware/manager_page.hpp"

#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

#include <algorithm>

namespace apple::firmware {
namespace {

constexpr char kNamespace[] = "wifi";
constexpr std::size_t kMaxSsid = 32;
constexpr std::size_t kMaxPassword = 63;

String generated_setup_key() {
  char digits[9];
  for (char& digit : digits) digit = static_cast<char>('0' + (esp_random() % 10));
  digits[8] = '\0';
  return String(digits);
}

}  // namespace

constexpr char ManagerServer::kSetupNetworkName[];

void WifiCredentials::begin() {
  Preferences preferences;
  preferences.begin(kNamespace, false);
  ssid_ = preferences.getString("ssid", "");
  password_ = preferences.getString("pass", "");
  setup_key_ = preferences.getString("setupkey", "");
  if (setup_key_.length() != 8) {
    setup_key_ = generated_setup_key();
    preferences.putString("setupkey", setup_key_);
  }
  preferences.end();
}

void WifiCredentials::save(const String& ssid, const String& password) {
  Preferences preferences;
  preferences.begin(kNamespace, false);
  preferences.putString("ssid", ssid);
  preferences.putString("pass", password);
  preferences.end();
  ssid_ = ssid;
  password_ = password;
}

void WifiCredentials::forget() {
  Preferences preferences;
  preferences.begin(kNamespace, false);
  preferences.remove("ssid");
  preferences.remove("pass");
  preferences.end();
  ssid_ = "";
  password_ = "";
}

void ManagerServer::begin(StatusFn status, JoinFn join, ForgetFn forget, SettingsFn settings) {
  status_ = std::move(status);
  join_ = std::move(join);
  forget_ = std::move(forget);
  settings_ = std::move(settings);
  server_.on("/", HTTP_GET, [this] { handle_root(); });
  server_.on("/index.html", HTTP_GET, [this] { handle_root(); });
  server_.on("/logo.png", HTTP_GET, [this] {
    server_.sendHeader("Cache-Control", "max-age=86400");
    server_.send_P(200, "image/png", reinterpret_cast<PGM_P>(kManagerLogoPng), kManagerLogoPngSize);
  });
  server_.on("/api/status", HTTP_GET, [this] { handle_status(); });
  server_.on("/api/networks", HTTP_GET, [this] { handle_networks(); });
  server_.on("/api/wifi", HTTP_POST, [this] { handle_join(); });
  server_.on("/api/wifi/forget", HTTP_POST, [this] { handle_forget(); });
  server_.on("/api/settings", HTTP_POST, [this] { handle_settings(); });
  server_.on("/api/timezones", HTTP_GET, [this] { handle_time_zones(); });
  server_.on("/api/update", HTTP_POST, [this] { handle_update_done(); }, [this] { handle_update_upload(); });
  server_.on("/api/audio/set", HTTP_POST, [this] { handle_audio_set(); });
  server_.on("/api/audio/file", HTTP_GET, [this] { handle_audio_file(); });
  server_.on("/api/audio/upload", HTTP_POST, [this] { handle_audio_done(); },
             [this] { handle_audio_upload(); });
  server_.on("/api/restart", HTTP_POST, [this] { handle_restart(); });
  server_.on("/api/update/check", HTTP_POST, [this] { handle_release_action(release_check_); });
  server_.on("/api/update/install", HTTP_POST, [this] { handle_release_action(release_install_); });
  server_.on("/api/replay", HTTP_POST, [this] { handle_replay(); });
  server_.on("/api/events", HTTP_GET, [this] { handle_events(); });
  server_.on("/api/audio/library", HTTP_GET, [this] { handle_library(); });
  server_.on("/api/maintenance", HTTP_POST, [this] { handle_maintenance(); });
  server_.on("/api/fixture", HTTP_POST, [this] { handle_fixture(); });
  server_.on("/api/fixture/stop", HTTP_POST, [this] { handle_fixture_stop(); });
  // Captive-portal probes from phones and laptops.
  for (const char* probe : {"/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
                            "/connecttest.txt", "/ncsi.txt", "/fwlink", "/success.txt", "/canonical.html"}) {
    server_.on(probe, [this] {
      if (!redirect_to_portal()) server_.send(204);
    });
  }
  server_.onNotFound([this] { handle_not_found(); });
  const char* headers[] = {"X-Apple-Code", "X-Apple-Maintenance", "Range"};
  server_.collectHeaders(headers, 3);
  server_.begin();
  server_started_ = true;
}

void ManagerServer::loop() {
  maintenance_.expire(millis());
  if (ap_active_) dns_.processNextRequest();
  if (server_started_) server_.handleClient();
  if (forget_pending_ && static_cast<std::int32_t>(millis() - forget_at_ms_) >= 0) {
    forget_pending_ = false;
    if (forget_) forget_();
  }
  // A scan while the access point is up came back empty on this core, so
  // scans run blocking on the station radio, outside any request handler.
  if (scan_pending_) {
    scan_pending_ = false;
    run_scan();
  }
}

void ManagerServer::run_scan() {
  const int count = WiFi.scanNetworks(false, false);
  if (count >= 0) collect_scan(count);
  WiFi.scanDelete();
  scanned_once_ = true;
}

void ManagerServer::start_setup_network(const String& key) {
  if (ap_active_) return;
  // Scan first, on the plain station radio, so the page has a list to show
  // the moment it opens.
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  run_scan();
  WiFi.mode(WIFI_AP_STA);
  // Modem power saving on the station side slows every answer from the
  // access point; keep the radio awake while the setup network is open.
  WiFi.setSleep(false);
  WiFi.softAPConfig(setup_ip(), setup_ip(), IPAddress(255, 255, 255, 0));
  WiFi.softAP(kSetupNetworkName, key.c_str(), 1, 0, 4);
  dns_.setErrorReplyCode(DNSReplyCode::NoError);
  dns_.start(53, "*", setup_ip());
  ap_active_ = true;
}

void ManagerServer::stop_setup_network() {
  if (!ap_active_) return;
  dns_.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  ap_active_ = false;
}

int ManagerServer::setup_clients() const { return ap_active_ ? WiFi.softAPgetStationNum() : 0; }

void ManagerServer::start_mdns(const char* hostname) {
  if (mdns_started_) return;
  if (MDNS.begin(hostname)) {
    MDNS.addService("http", "tcp", 80);
    mdns_started_ = true;
  }
}

void ManagerServer::request_scan() { scan_pending_ = true; }

void ManagerServer::collect_scan(int count) {
  networks_.clear();
  for (int index = 0; index < count; ++index) {
    const String ssid = WiFi.SSID(static_cast<std::uint8_t>(index));
    if (ssid.length() == 0) continue;
    const int rssi = WiFi.RSSI(static_cast<std::uint8_t>(index));
    const bool secure = WiFi.encryptionType(static_cast<std::uint8_t>(index)) != WIFI_AUTH_OPEN;
    auto existing = std::find_if(networks_.begin(), networks_.end(),
                                 [&](const NetworkEntry& entry) { return entry.ssid == ssid; });
    if (existing != networks_.end()) {
      if (rssi > existing->rssi) {
        existing->rssi = rssi;
        existing->secure = secure;
      }
      continue;
    }
    networks_.push_back(NetworkEntry{ssid, rssi, secure});
  }
  std::sort(networks_.begin(), networks_.end(),
            [](const NetworkEntry& a, const NetworkEntry& b) { return a.rssi > b.rssi; });
}

bool ManagerServer::redirect_to_portal() {
  if (!ap_active_) return false;
  const String host = server_.hostHeader();
  if (host == setup_ip().toString()) return false;
  server_.sendHeader("Location", String("http://") + setup_ip().toString() + "/", true);
  server_.send(302, "text/plain", "");
  return true;
}

void ManagerServer::handle_root() {
  server_.sendHeader("Cache-Control", "no-store");
  server_.send_P(200, "text/html", kManagerPage);
}

namespace {

// Status answers grow with the track library and the up-next lines. Both the
// document and its text go to PSRAM when the board has it, leaving internal
// RAM for Wi-Fi and TLS.
struct SpiRamJsonAllocator final : ArduinoJson::Allocator {
  void* allocate(size_t size) override {
    void* memory = psramFound() ? heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) : nullptr;
    return memory != nullptr ? memory : malloc(size);
  }
  void deallocate(void* pointer) override { free(pointer); }
  void* reallocate(void* pointer, size_t size) override {
    if (psramFound()) return heap_caps_realloc(pointer, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    return realloc(pointer, size);
  }
};
SpiRamJsonAllocator json_allocator;

// Gathers what the library writer prints and hands it to the client in
// chunks, so only this much of the answer exists at any one time. The buffer
// lives in PSRAM when there is some; without one, every write goes straight
// out as its own chunk.
class ChunkSink final : public Print {
 public:
  explicit ChunkSink(WebServer& server)
      : server_(server), buffer_(static_cast<char*>(json_allocator.allocate(kSize))) {}
  ~ChunkSink() {
    drain();
    json_allocator.deallocate(buffer_);
  }
  size_t write(uint8_t byte) override { return write(&byte, 1); }
  size_t write(const uint8_t* data, size_t length) override {
    if (buffer_ == nullptr) {
      server_.sendContent(reinterpret_cast<const char*>(data), length);
      return length;
    }
    size_t done = 0;
    while (done < length) {
      const size_t take = std::min(kSize - used_, length - done);
      memcpy(buffer_ + used_, data + done, take);
      used_ += take;
      done += take;
      if (used_ == kSize) drain();
    }
    return length;
  }
  void drain() {
    if (buffer_ == nullptr || used_ == 0) return;
    server_.sendContent(buffer_, used_);
    used_ = 0;
  }

 private:
  static constexpr size_t kSize = 1024;
  WebServer& server_;
  char* buffer_;
  size_t used_ = 0;
};

}  // namespace

void ManagerServer::send_json(JsonDocument& doc) {
  const std::size_t length = measureJson(doc);
  char* body = static_cast<char*>(json_allocator.allocate(length + 1));
  if (body == nullptr) {
    server_.send(500, "application/json", "{\"error\":\"NO_MEMORY\"}");
    return;
  }
  serializeJson(doc, body, length + 1);
  server_.sendHeader("Cache-Control", "no-store");
  server_.setContentLength(length);
  server_.send(200, "application/json", "");
  WiFiClient client = server_.client();
  std::size_t sent = 0;
  while (sent < length && client.connected()) {
    const std::size_t wrote = client.write(reinterpret_cast<const std::uint8_t*>(body) + sent, length - sent);
    if (wrote == 0) break;
    sent += wrote;
  }
  json_allocator.deallocate(body);
}

void ManagerServer::handle_status() {
  JsonDocument doc(&json_allocator);
  if (status_) status_(doc);
  send_json(doc);
}

void ManagerServer::handle_events() {
  JsonDocument doc(&json_allocator);
  if (events_) events_(doc);
  send_json(doc);
}

// Chunked, because the length is not known until the last track is written.
void ManagerServer::handle_library() {
  if (!library_) {
    server_.send(404, "application/json", "{\"ok\":false,\"error\":\"NO_AUDIO\"}");
    return;
  }
  server_.sendHeader("Cache-Control", "no-store");
  server_.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server_.send(200, "application/json", "");
  {
    ChunkSink sink(server_);
    library_(sink);
  }
  server_.sendContent("");  // the empty chunk ends the answer
}

void ManagerServer::handle_networks() {
  // Scanning makes the access point stall for a few seconds, so only the
  // first request and an explicit "rescan" start one.
  if (server_.hasArg("rescan") || (!scanned_once_ && !scan_pending_)) request_scan();
  JsonDocument doc;
  doc["scanning"] = scan_pending_;
  JsonArray list = doc["networks"].to<JsonArray>();
  for (const NetworkEntry& entry : networks_) {
    JsonObject item = list.add<JsonObject>();
    item["ssid"] = entry.ssid;
    item["rssi"] = entry.rssi;
    item["secure"] = entry.secure;
  }
  String body;
  serializeJson(doc, body);
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "application/json", body);
}

int ManagerServer::auth_status(bool require_code) {
  if (!require_code && !code_required_) return 0;
  if (admin_code_.length() == 0) return 401;
  // The setup network hands out 192.168.4.x; a client there proved presence.
  const IPAddress client = server_.client().remoteIP();
  if (!require_code && ap_active_ && client[0] == 192 && client[1] == 168 && client[2] == 4) return 0;
  const std::uint32_t now = millis();
  if (lockout_until_ms_ != 0 && static_cast<std::int32_t>(now - lockout_until_ms_) < 0) return 429;
  String code = server_.header("X-Apple-Code");
  if (code.length() == 0) code = server_.arg("code");
  code.trim();
  if (code == admin_code_) {
    failed_codes_ = 0;
    return 0;
  }
  if (++failed_codes_ >= 5) {
    failed_codes_ = 0;
    lockout_until_ms_ = now + 60'000;
  }
  return 401;
}

bool ManagerServer::authorized() {
  const int status = auth_status();
  if (status == 0) return true;
  server_.send(status, "application/json",
               status == 429 ? "{\"ok\":false,\"error\":\"LOCKED\"}" : "{\"ok\":false,\"error\":\"CODE\"}");
  return false;
}

// The upload streams straight into the spare slot. A refusal (password,
// game in progress, bad file) is remembered and answered once the body has
// finished arriving, since the browser sends it all either way.
void ManagerServer::handle_update_upload() {
  HTTPUpload& up = server_.upload();
  if (up.status == UPLOAD_FILE_START) {
    update_ok_ = false;
    update_error_ = "";
    const int auth = auth_status();
    if (auth != 0) {
      update_error_ = auth == 429 ? "LOCKED" : "CODE";
      return;
    }
    if (update_gate_) {
      const String why = update_gate_();
      if (why.length() > 0) {
        update_error_ = why;
        return;
      }
    }
    if (!updater_.begin()) update_error_ = updater_.error();
  } else if (up.status == UPLOAD_FILE_WRITE) {
    // Bytes are arriving, so this is progress, however slow the link: a
    // 2 MB upload on weak Wi-Fi can outlast the watchdog otherwise.
    esp_task_wdt_reset();
    if (update_error_.length() == 0) updater_.write(up.buf, up.currentSize);
  } else if (up.status == UPLOAD_FILE_END) {
    if (update_error_.length() == 0) {
      update_ok_ = updater_.end();
      if (!update_ok_) update_error_ = updater_.error();
    }
  } else if (up.status == UPLOAD_FILE_ABORTED) {
    updater_.abort();
    if (update_error_.length() == 0) update_error_ = "ABORTED";
  }
}

void ManagerServer::handle_update_done() {
  if (update_ok_) {
    server_.send(200, "application/json", "{\"ok\":true}");
    update_ok_ = false;
    if (update_done_) update_done_();
    return;
  }
  const String& e = update_error_;
  const int status = e == "CODE" ? 401 : e == "LOCKED" ? 429
                     : (e == "GAME_IN_PROGRESS" || e == "CELEBRATING" || e == "BUSY") ? 409 : 400;
  server_.send(status, "application/json", String("{\"ok\":false,\"error\":\"") + (e.length() ? e : "FAILED") + "\"}");
}

void ManagerServer::handle_join() {
  if (!authorized()) return;
  const String ssid = server_.arg("ssid");
  const String password = server_.arg("password");
  if (ssid.length() == 0 || ssid.length() > kMaxSsid || password.length() > kMaxPassword ||
      (password.length() > 0 && password.length() < 8)) {
    server_.send(400, "application/json", "{\"ok\":false,\"error\":\"INVALID_CREDENTIALS\"}");
    return;
  }
  server_.send(200, "application/json", "{\"ok\":true}");
  if (join_) join_(ssid, password, server_.arg("tz"));
}

void ManagerServer::handle_forget() {
  if (!authorized()) return;
  server_.send(200, "application/json", "{\"ok\":true}");
  // Dropping Wi-Fi at once would kill the reply in flight; act shortly after.
  forget_at_ms_ = millis() + 1500;
  forget_pending_ = true;
}

namespace {
int on_off(const String& value) {
  if (value == "on" || value == "1" || value == "true" || value == "auto") return 1;
  if (value == "off" || value == "0" || value == "false" || value == "paused") return 0;
  return -1;
}
}  // namespace

void ManagerServer::handle_settings() {
  if (!settings_) {
    server_.send(404, "application/json", "{\"ok\":false,\"error\":\"NO_SETTINGS\"}");
    return;
  }
  if (!authorized()) return;
  SettingsUpdate update;
  if (server_.hasArg("raised")) update.raised_seconds = server_.arg("raised").toInt();
  if (server_.hasArg("motor")) update.motor = on_off(server_.arg("motor"));
  if (server_.hasArg("follow")) update.follow = on_off(server_.arg("follow"));
  if (server_.hasArg("sleep")) update.sleep = on_off(server_.arg("sleep"));
  if (server_.hasArg("lock")) update.lock = on_off(server_.arg("lock"));
  if (server_.hasArg("tz")) update.time_zone = server_.arg("tz");
  if (server_.hasArg("bright")) update.brightness = server_.arg("bright").toInt();
  if (server_.hasArg("volume")) update.volume = server_.arg("volume").toInt();
  if (server_.hasArg("winfull")) update.win_full = on_off(server_.arg("winfull"));
  if (server_.hasArg("auto")) update.auto_update = on_off(server_.arg("auto"));
  if (server_.hasArg("beta")) update.beta = on_off(server_.arg("beta"));
  if (server_.hasArg("token")) {
    update.token_given = true;
    update.github_token = server_.arg("token");
  }
  const String error = settings_(update);
  if (error.length() > 0) {
    server_.send(400, "application/json", String("{\"ok\":false,\"error\":\"") + error + "\"}");
    return;
  }
  server_.send(200, "application/json", "{\"ok\":true}");
}

void ManagerServer::handle_time_zones() {
  // The page builds its Time zone list from this and matches the browser's
  // own zone against the ids and aliases.
  std::size_t count = 0;
  const TimeZoneInfo* zones = time_zones(count);
  JsonDocument doc;
  JsonArray list = doc.to<JsonArray>();
  for (std::size_t i = 0; i < count; ++i) {
    JsonObject item = list.add<JsonObject>();
    item["id"] = zones[i].id;
    item["label"] = zones[i].label;
    item["aliases"] = zones[i].aliases;
  }
  String body;
  serializeJson(doc, body);
  server_.sendHeader("Cache-Control", "max-age=86400");
  server_.send(200, "application/json", body);
}

// One change to the track library: rename, pool membership, a player's track,
// deleting a file, or playing one so the owner can hear it in place.
void ManagerServer::handle_audio_set() {
  if (!audio_change_) {
    server_.send(404, "application/json", "{\"ok\":false,\"error\":\"NO_AUDIO\"}");
    return;
  }
  if (!authorized()) return;
  AudioChange change;
  change.action = server_.arg("action");
  change.file = server_.arg("file");
  change.text = server_.arg("text");
  if (server_.hasArg("id")) change.number = server_.arg("id").toInt();
  if (server_.hasArg("at")) change.position = server_.arg("at").toInt();
  if (server_.hasArg("from")) change.index = server_.arg("from").toInt();
  if (server_.hasArg("hr")) change.home_run = on_off(server_.arg("hr"));
  if (server_.hasArg("win")) change.win = on_off(server_.arg("win"));
  const String failed = audio_change_(change);
  if (failed.length() > 0) {
    const int status = failed == "CELEBRATING" || failed == "BUSY" ? 409
                       : failed == "NO_CARD"                       ? 503
                                                                   : 400;
    server_.send(status, "application/json",
                 String("{\"ok\":false,\"error\":\"") + failed + "\"}");
    return;
  }
  server_.send(200, "application/json", "{\"ok\":true}");
}

// A track off the card, for the page's preview player.
void ManagerServer::handle_audio_file() {
  if (!audio_file_) {
    server_.send(404, "application/json", "{\"ok\":false,\"error\":\"NO_AUDIO\"}");
    return;
  }
  File file;
  const String failed = audio_file_(server_.arg("file"), file);
  if (failed.length() > 0) {
    const int status = failed == "CELEBRATING" || failed == "GAME_IN_PROGRESS" ? 409
                       : failed == "NO_CARD"                                    ? 503
                                                                                : 404;
    server_.send(status, "application/json",
                 String("{\"ok\":false,\"error\":\"") + failed + "\"}");
    return;
  }
  // Serve byte ranges. Phones ask for the head of a track first and play it
  // while the rest arrives; without ranges Safari waits for the whole file,
  // which over this Wi-Fi and the card's read speed is many seconds.
  const std::size_t total = file.size();
  std::size_t start = 0;
  std::size_t end = total == 0 ? 0 : total - 1;
  bool partial = false;
  const String range = server_.header("Range");
  if (range.startsWith("bytes=") && total > 0) {
    const int dash = range.indexOf('-', 6);
    if (dash > 6) {
      start = static_cast<std::size_t>(range.substring(6, dash).toInt());
      const String tail = range.substring(dash + 1);
      if (tail.length() > 0) end = static_cast<std::size_t>(tail.toInt());
      if (end >= total) end = total - 1;
      if (start > end) {
        server_.sendHeader("Content-Range", String("bytes */") + total);
        server_.send(416, "text/plain", "");
        file.close();
        return;
      }
      partial = true;
    }
  }
  server_.sendHeader("Accept-Ranges", "bytes");
  server_.sendHeader("Cache-Control", "max-age=3600");
  if (partial) server_.sendHeader("Content-Range", String("bytes ") + start + "-" + end + "/" + total);
  const std::size_t length = total == 0 ? 0 : end - start + 1;
  server_.setContentLength(length);
  server_.send(partial ? 206 : 200, "audio/wav", "");
  if (length > 0 && file.seek(start)) {
    WiFiClient client = server_.client();
    std::uint8_t chunk[1024];
    std::size_t left = length;
    while (left > 0 && client.connected()) {
      const std::size_t want = left < sizeof(chunk) ? left : sizeof(chunk);
      const std::size_t got = file.read(chunk, want);
      if (got == 0) break;
      const std::size_t sent = client.write(chunk, got);
      if (sent != got) break;
      left -= got;
    }
  }
  file.close();
}

// A track streams straight to the card in ~1.4 KB pieces. As with firmware, a
// refusal is remembered and answered once the body has finished arriving,
// because the browser sends it all either way.
void ManagerServer::handle_audio_upload() {
  HTTPUpload& up = server_.upload();
  if (up.status == UPLOAD_FILE_START) {
    audio_ok_ = false;
    audio_error_ = "";
    if (!audio_begin_) {
      audio_error_ = "NO_AUDIO";
      return;
    }
    const int auth = auth_status();
    if (auth != 0) {
      audio_error_ = auth == 429 ? "LOCKED" : "CODE";
      return;
    }
    audio_error_ = audio_begin_(up.filename);
  } else if (up.status == UPLOAD_FILE_WRITE) {
    if (audio_error_.length() == 0 && audio_write_) {
      if (!audio_write_(up.buf, up.currentSize)) audio_error_ = "WRITE_FAILED";
    }
  } else if (up.status == UPLOAD_FILE_END) {
    if (audio_end_) {
      const String failed = audio_end_(audio_error_.length() == 0);
      if (audio_error_.length() == 0) audio_error_ = failed;
    }
    audio_ok_ = audio_error_.length() == 0;
  } else if (up.status == UPLOAD_FILE_ABORTED) {
    if (audio_end_) audio_end_(false);
    if (audio_error_.length() == 0) audio_error_ = "ABORTED";
  }
}

void ManagerServer::handle_audio_done() {
  if (audio_ok_) {
    audio_ok_ = false;
    server_.send(200, "application/json", "{\"ok\":true}");
    return;
  }
  const String& e = audio_error_;
  const int status = e == "CODE"       ? 401
                     : e == "LOCKED"   ? 429
                     : e == "NO_AUDIO" ? 404
                     : (e == "CELEBRATING" || e == "BUSY") ? 409
                     : e == "NO_CARD"                      ? 503
                                                           : 400;
  server_.send(status, "application/json",
               String("{\"ok\":false,\"error\":\"") + (e.length() ? e : "FAILED") + "\"}");
}

void ManagerServer::handle_restart() {
  if (!authorized()) return;
  String why = restart_ ? restart_() : String("NO_RESTART");
  if (why.length() > 0) {
    server_.send(why == "NO_RESTART" ? 404 : 409, "application/json", String("{\"ok\":false,\"error\":\"") + why + "\"}");
    return;
  }
  server_.send(200, "application/json", "{\"ok\":true}");
}

void ManagerServer::handle_release_action(const ActionFn& action) {
  if (!authorized()) return;
  const String why = action ? action() : String("NO_RELEASES");
  if (why.length() > 0) {
    server_.send(why == "NO_RELEASES" ? 404 : 409, "application/json", String("{\"ok\":false,\"error\":\"") + why + "\"}");
    return;
  }
  server_.send(200, "application/json", "{\"ok\":true}");
}

void ManagerServer::fill_maintenance_status(JsonObject out) const {
  const auto now = static_cast<std::uint32_t>(millis());
  out["supported"] = static_cast<bool>(maintenance_gate_);
  out["pending"] = maintenance_.pending(now);
  out["armed"] = maintenance_.armed(now);
  out["remainingMs"] = maintenance_.remaining_ms(now);
}

void ManagerServer::handle_maintenance() {
  const int auth = auth_status(true);  // Required even with the owner lock off.
  if (auth != 0) {
    server_.send(auth, "application/json", auth == 429 ?
        "{\"ok\":false,\"error\":\"LOCKED\"}" : "{\"ok\":false,\"error\":\"CODE\"}");
    return;
  }
  const String why = maintenance_gate_ ? maintenance_gate_() : String("NO_MAINTENANCE");
  if (why.length()) {
    server_.send(409, "application/json", String("{\"ok\":false,\"error\":\"") + why + "\"}");
    return;
  }
  char token[33];
  for (int i = 0; i < 4; ++i) std::snprintf(token + i * 8, 9, "%08lx", static_cast<unsigned long>(esp_random()));
  maintenance_.request(true, token, millis());
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "application/json", String("{\"ok\":true,\"token\":\"") + token + "\",\"expiresInMs\":90000}");
}

void ManagerServer::handle_replay() {
  const String kind = server_.arg("kind");
  if (kind != "hr" && kind != "win") {
    server_.send(400, "application/json", "{\"ok\":false,\"error\":\"BAD_KIND\"}");
    return;
  }
  if (!maintenance_.consume(server_.header("X-Apple-Maintenance").c_str(), millis())) {
    server_.send(403, "application/json", "{\"ok\":false,\"error\":\"MAINTENANCE_REQUIRED\"}");
    return;
  }
  ReplayRequest request;
  request.kind = kind;
  request.away = server_.arg("away");
  request.home = server_.arg("home");
  request.away_runs = server_.hasArg("awayRuns") ? server_.arg("awayRuns").toInt() : -1;
  request.home_runs = server_.hasArg("homeRuns") ? server_.arg("homeRuns").toInt() : -1;
  request.mets_home = server_.arg("metsHome") == "1" || server_.arg("metsHome") == "true";
  request.venue = server_.arg("venue");
  request.away_name = server_.arg("awayName");
  request.home_name = server_.arg("homeName");
  const String why = replay_ ? replay_(request) : String("NO_REPLAY");
  if (why.length() > 0) {
    server_.send(why == "NO_REPLAY" ? 404 : 409, "application/json",
                 String("{\"ok\":false,\"error\":\"") + why + "\"}");
    return;
  }
  server_.send(200, "application/json", "{\"ok\":true}");
}

void ManagerServer::handle_fixture() {
  const String token = server_.header("X-Apple-Maintenance");
  if (!maintenance_.consume(token.c_str(), millis())) {
    server_.send(403, "application/json", "{\"ok\":false,\"error\":\"MAINTENANCE_REQUIRED\"}");
    return;
  }
  const String why = fixture_run_ ? fixture_run_(server_.arg("scenario")) : String("BAD_FIXTURE");
  if (why.length()) {
    server_.send(409, "application/json", String("{\"ok\":false,\"error\":\"") + why + "\"}");
    return;
  }
  fixture_stop_token_ = token;
  server_.send(200, "application/json", "{\"ok\":true}");
}

void ManagerServer::handle_fixture_stop() {
  const String token = server_.header("X-Apple-Maintenance");
  // A Stop can overtake a delayed Start. Retire its approval in that case so
  // the late Start cannot move hardware after the operator has switched off.
  const bool cancelled_pending = maintenance_.cancel(token.c_str());
  const bool owns_fixture = token.length() > 0 && token == fixture_stop_token_;
  if (!cancelled_pending && !owns_fixture) {
    server_.send(403, "application/json", "{\"ok\":false,\"error\":\"MAINTENANCE_REQUIRED\"}");
    return;
  }
  if (owns_fixture) {
    if (fixture_stop_) fixture_stop_();
  }
  // Keep cancellation idempotent if its response was lost. A later Start
  // replaces this token before exposing a new test.
  fixture_stop_token_ = token;
  server_.send(200, "application/json", "{\"ok\":true}");
}

void ManagerServer::handle_not_found() {
  if (redirect_to_portal()) return;
  server_.send(404, "text/plain", "Not found");
}

}  // namespace apple::firmware
