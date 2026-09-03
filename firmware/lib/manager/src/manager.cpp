#include "apple/firmware/manager.hpp"
#include "apple/firmware/time_zones.hpp"

#include "apple/firmware/manager_logo.hpp"
#include "apple/firmware/manager_page.hpp"

#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_system.h>

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
  server_.on("/api/restart", HTTP_POST, [this] { handle_restart(); });
  server_.on("/api/update/check", HTTP_POST, [this] { handle_release_action(release_check_); });
  server_.on("/api/update/install", HTTP_POST, [this] { handle_release_action(release_install_); });
  // Captive-portal probes from phones and laptops.
  for (const char* probe : {"/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
                            "/connecttest.txt", "/ncsi.txt", "/fwlink", "/success.txt", "/canonical.html"}) {
    server_.on(probe, [this] {
      if (!redirect_to_portal()) server_.send(204);
    });
  }
  server_.onNotFound([this] { handle_not_found(); });
  const char* headers[] = {"X-Apple-Code"};
  server_.collectHeaders(headers, 1);
  server_.begin();
  server_started_ = true;
}

void ManagerServer::loop() {
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

void ManagerServer::handle_status() {
  JsonDocument doc;
  if (status_) status_(doc);
  String body;
  serializeJson(doc, body);
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "application/json", body);
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

int ManagerServer::auth_status() {
  if (!code_required_ || admin_code_.length() == 0) return 0;
  // The setup network hands out 192.168.4.x; a client there proved presence.
  const IPAddress client = server_.client().remoteIP();
  if (ap_active_ && client[0] == 192 && client[1] == 168 && client[2] == 4) return 0;
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

void ManagerServer::handle_not_found() {
  if (redirect_to_portal()) return;
  server_.send(404, "text/plain", "Not found");
}

}  // namespace apple::firmware
