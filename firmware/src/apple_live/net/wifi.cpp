#include "apple_live/net/wifi.hpp"

#include "apple_live/display/display.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/live_feed.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/https.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/net/updates.hpp"
#include "apple_live/owner/owner_settings.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/trace.hpp"
#include "apple_live/version.hpp"

#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <WiFi.h>

#include <cstdint>
#include <cstdio>
#include <ctime>

// Optional developer convenience: a local header can seed the stored
// credentials on a bench board. Owners never need it; they use the setup
// network and the Apple Manager page instead.
#if __has_include("apple/firmware/secrets.local.hpp")
#include "apple/firmware/secrets.local.hpp"
#else
namespace apple::firmware::secrets {
inline constexpr char kWifiSsid[] = "";
inline constexpr char kWifiPassword[] = "";
}  // namespace apple::firmware::secrets
#endif

namespace apple::live {

using apple::firmware::copy_text;

namespace {

constexpr std::uint32_t kWifiRetryMs = 15'000;
constexpr std::uint32_t kNtpRekickMs = 25'000;  // re-issue NTP while the clock is still unset
// Credentials that do not connect within this window reopen the setup network
// so the owner can fix a changed password without touching the board.
constexpr std::uint32_t kJoinTimeoutMs = 45'000;
constexpr std::uint32_t kJoinGraceMs = 10'000;
// The setup network stays up this long after a successful join so the phone
// that entered the password can read the result.
constexpr std::uint32_t kSetupNetworkLingerMs = 20'000;

}  // namespace

apple::firmware::WifiCredentials credentials;
NetState net_state = NetState::NoCredentials;

namespace {

std::uint32_t next_wifi_attempt_ms = 0;
std::uint32_t join_started_ms = 0;
std::uint32_t setup_network_close_ms = 0;
bool setup_network_closing = false;
bool time_synced = false;
std::uint32_t next_ntp_kick_ms = 0;   // re-issue NTP while the clock is unset

void open_setup_network(const char* reason) {
  if (manager.setup_network_active()) return;
  manager.start_setup_network(credentials.setup_key());
  setup_network_closing = false;
  char detail[72];
  std::snprintf(detail, sizeof(detail), "open: %s", reason);
  publish_trace("SETUP_NETWORK", detail);
  if (net_state != NetState::Connected) show_setup_screen();
}

void begin_station() {
  WiFi.persistent(false);
  WiFi.mode(manager.setup_network_active() ? WIFI_AP_STA : WIFI_STA);
  WiFi.setHostname(kHostname);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(credentials.ssid().c_str(), credentials.password().c_str());
  net_state = NetState::Connecting;
  join_started_ms = now32();
  next_wifi_attempt_ms = now32() + kWifiRetryMs;
}

}  // namespace

const char* net_state_name() {
  switch (net_state) {
    case NetState::Connecting:
      return "CONNECTING";
    case NetState::Connected:
      return "CONNECTED";
    case NetState::Lost:
      return "LOST";
    case NetState::Failed:
      return "FAILED";
    case NetState::NoCredentials:
    default:
      return "NO_CREDENTIALS";
  }
}

void on_join_request(const String& ssid, const String& password, const String& time_zone) {
  model.setup_banner[0] = '\0';
  // The first setup device decides the zone unless an owner already chose one.
  if (!settings.tz_chosen && time_zone.length() > 0 && set_time_zone(time_zone.c_str())) {
    settings.tz_chosen = true;
    save_settings();
    apply_time_zone();
    publish_trace("SETTINGS", "time zone taken from the setup device");
  }
  credentials.save(ssid, password);
  WiFi.disconnect(false, false);
  begin_station();
  publish_trace("WIFI", "join requested from the manager page");
  if (!manager.setup_network_active()) show_joining_screen();
}

void on_forget_request() {
  model.setup_banner[0] = '\0';
  credentials.forget();
  WiFi.disconnect(false, false);
  net_state = NetState::NoCredentials;
  time_synced = false;
  game.reset();
  tracker.reset();
  publish_trace("WIFI", "credentials forgotten");
  open_setup_network("credentials forgotten");
  show_setup_screen();
}

void start_wifi() {
  credentials.begin();
  if (!credentials.configured() && apple::firmware::secrets::kWifiSsid[0] != '\0') {
    credentials.save(apple::firmware::secrets::kWifiSsid, apple::firmware::secrets::kWifiPassword);
    publish_trace("WIFI", "seeded credentials from secrets.local.hpp");
  }
  // The web server needs the TCP/IP stack, which WiFi.mode() brings up.
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  start_manager();
  if (credentials.configured()) {
    begin_station();
    show_joining_screen();
    publish_trace("WIFI", "connecting");
  } else {
    net_state = NetState::NoCredentials;
    open_setup_network("no credentials");
  }
}

void service_wifi() {
  manager.loop();
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && net_state != NetState::Connected) {
    net_state = NetState::Connected;
    // Anycast services first: they answer from a nearby machine in
    // milliseconds. pool.ntp.org is the fallback because its name resolves to
    // a random volunteer server that may be slow or silent, and the client
    // waits out a retry before moving on. The Apple has no battery-backed
    // clock, so this wait is the whole of the SYNCING CLOCK screen.
    configTzTime(settings.posix_tz, "time.google.com", "time.cloudflare.com", "pool.ntp.org");
    next_ntp_kick_ms = now32() + kNtpRekickMs;
    configure_mlb_client();
    manager.start_mdns(kHostname);
    next_schedule_ms = now32();
    release.next_check_ms = now32() + kReleaseFirstCheckMs;
    char detail[48];
    std::snprintf(detail, sizeof(detail), "connected rssi=%d ip=%s", WiFi.RSSI(), WiFi.localIP().toString().c_str());
    publish_trace("WIFI", detail);
    if (manager.setup_network_active()) {
      setup_network_closing = true;
      setup_network_close_ms = now32() + kSetupNetworkLingerMs;
    }
    copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
    model.waiting_note[0] = '\0';
    if (settings.follow) {
      show_waiting("SYNCING CLOCK", apple::firmware::kMetsOrange, apple::firmware::WaitingIcon::Clock);
    } else {
      show_paused_screen();
    }
    return;
  }
  if (!connected && net_state == NetState::Connected) {
    net_state = NetState::Lost;
    next_wifi_attempt_ms = now32() + kWifiRetryMs;
    publish_trace("WIFI", "lost");
    if (motion_idle()) {
      copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
      copy_text(model.waiting_note, sizeof(model.waiting_note), "RETRYING");
      show_waiting("WI-FI LOST", apple::firmware::kDelayYellow, apple::firmware::WaitingIcon::WifiLost);
    }
    return;
  }
  if (!connected && net_state == NetState::Connecting) {
    // The radio reports "not found" or "failed" for a moment while it is
    // still associating, so a failure only counts after a grace period.
    const wl_status_t status = WiFi.status();
    const bool failed_status = (status == WL_CONNECT_FAILED || status == WL_NO_SSID_AVAIL) &&
                               due(join_started_ms + kJoinGraceMs);
    if (failed_status || due(join_started_ms + kJoinTimeoutMs)) {
      net_state = NetState::Failed;
      publish_trace("WIFI", status == WL_NO_SSID_AVAIL ? "join failed: network not found"
                            : status == WL_CONNECT_FAILED ? "join failed: rejected"
                                                          : "join failed: timeout");
      copy_text(model.setup_banner, sizeof(model.setup_banner),
                status == WL_NO_SSID_AVAIL ? "NETWORK NOT FOUND" : "WRONG PASSWORD - TRY AGAIN");
      open_setup_network("join failed");
      show_setup_screen();
    }
  }
  if (!connected && credentials.configured() && due(next_wifi_attempt_ms)) {
    next_wifi_attempt_ms = now32() + kWifiRetryMs;
    WiFi.disconnect(false, false);
    WiFi.begin(credentials.ssid().c_str(), credentials.password().c_str());
    publish_trace("WIFI", "retrying");
  }
  // Close even if the phone is still attached: that is what sends it back
  // to the home network, where the Apple now answers.
  if (setup_network_closing && connected && due(setup_network_close_ms)) {
    setup_network_closing = false;
    manager.stop_setup_network();
    publish_trace("SETUP_NETWORK", "closed");
  }
  if (connected && !time_synced && clock_valid()) {
    time_synced = true;
    char detail[40];
    const time_t at = time(nullptr);
    struct tm local;
    localtime_r(&at, &local);
    strftime(detail, sizeof(detail), "%Y-%m-%d %H:%M:%S %Z", &local);
    publish_trace("CLOCK", detail);
  }
  // On a weak link the first NTP burst can be lost. Re-issue it periodically
  // until the clock is valid so a marginal signal still recovers instead of
  // sitting on SYNCING CLOCK indefinitely.
  if (connected && !clock_valid() && due(next_ntp_kick_ms)) {
    next_ntp_kick_ms = now32() + kNtpRekickMs;
    configTzTime(settings.posix_tz, "time.google.com", "time.cloudflare.com", "pool.ntp.org");
    publish_trace("CLOCK", "still syncing; retrying ntp");
  }
}

}  // namespace apple::live
