#pragma once

// Apple Manager, the owner's local interface served by the Nano itself.
//
// First boot: the Apple opens its own setup network, the owner joins it from
// a phone, and a captive page lists nearby networks and takes the password.
// Credentials live in the board's flash (Preferences namespace "wifi"), so one
// firmware binary serves every unit and nobody edits a source file. Afterwards
// the same server answers on the home network at http://home-run-apple.local
// with status, the owner settings, and signed wireless firmware updates. It
// exposes no motion control of any kind.

#include <Arduino.h>

#include "apple/firmware/firmware_update.hpp"
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <WebServer.h>

#include <functional>
#include <vector>

namespace apple::firmware {

/// Persistent Wi-Fi credentials plus the per-unit setup-network key.
class WifiCredentials {
 public:
  void begin();
  bool configured() const { return ssid_.length() > 0; }
  const String& ssid() const { return ssid_; }
  const String& password() const { return password_; }
  /// Eight digits generated once per unit; shown on the display so only
  /// someone standing at the Apple can join its setup network.
  const String& setup_key() const { return setup_key_; }
  void save(const String& ssid, const String& password);
  void forget();

 private:
  String ssid_;
  String password_;
  String setup_key_;
};

struct NetworkEntry {
  String ssid;
  int rssi{0};
  bool secure{true};
};

/// One settings change from the page; fields left empty were not sent.
struct SettingsUpdate {
  int raised_seconds{-1};
  int motor{-1};   ///< -1 unchanged, 0 off, 1 on
  int follow{-1};  ///< -1 unchanged, 0 paused, 1 auto
  int sleep{-1};   ///< -1 unchanged, 0 keep the screen on, 1 sleep between games
  int lock{-1};    ///< -1 unchanged, 0 no password for changes, 1 ask for the password
  String time_zone;  ///< IANA id from the Manager's table, empty when unchanged
  int brightness{-1};  ///< -1 unchanged, else 10..100 percent
  int auto_update{-1};  ///< -1 unchanged, 0 only check, 1 install new firmware on its own
  int beta{-1};         ///< -1 unchanged, 1 also take pre-releases (developer setting)
  bool token_given{false};  ///< `github_token` was sent (empty clears it)
  String github_token;      ///< read-only token for a private repository (developer setting)
};

class ManagerServer {
 public:
  using StatusFn = std::function<void(JsonDocument&)>;
  /// `time_zone` is the IANA id the setup device reported, or empty.
  using JoinFn =
      std::function<void(const String& ssid, const String& password, const String& time_zone)>;
  using ForgetFn = std::function<void()>;
  /// Returns an empty string when applied, otherwise a short error code.
  using SettingsFn = std::function<String(const SettingsUpdate&)>;

  static constexpr char kSetupNetworkName[] = "Home Run Apple";

  void begin(StatusFn status, JoinFn join, ForgetFn forget, SettingsFn settings = nullptr);

  /// Wireless updates: `gate` returns an empty string when an install may
  /// start now (else a short reason); `done` runs once a signed image is in
  /// the spare slot and should schedule the restart.
  using UpdateGateFn = std::function<String()>;
  using UpdateDoneFn = std::function<void()>;
  void set_update_hooks(UpdateGateFn gate, UpdateDoneFn done) {
    update_gate_ = std::move(gate);
    update_done_ = std::move(done);
  }
  bool update_in_progress() const { return updater_.active(); }
  /// Restart from the page: returns an empty string when scheduled, else a reason.
  using RestartFn = std::function<String()>;
  void set_restart_hook(RestartFn restart) { restart_ = std::move(restart); }
  /// Release checks the Apple runs itself: `check` asks for a check now and
  /// `install` asks to fetch and install the release it found. Each returns
  /// an empty string when accepted, else a short reason.
  using ActionFn = std::function<String()>;
  void set_release_hooks(ActionFn check, ActionFn install) {
    release_check_ = std::move(check);
    release_install_ = std::move(install);
  }
  void loop();

  /// Opens the WPA2 setup network with a captive DNS so phones show the page
  /// automatically. Keeps the station radio active so the page can scan.
  void start_setup_network(const String& key);
  void stop_setup_network();
  bool setup_network_active() const { return ap_active_; }
  IPAddress setup_ip() const { return IPAddress(192, 168, 4, 1); }
  int setup_clients() const;

  void start_mdns(const char* hostname);

  /// Changes from the home network must carry this code (the setup key) in
  /// the X-Apple-Code header or a `code` field. Requests that arrive over the
  /// setup network are trusted: joining it already required the code.
  void set_admin_code(const String& code) { admin_code_ = code; }
  /// Off by default; the owner turns it on from the settings card.
  void set_code_required(bool required) { code_required_ = required; }

  /// Asks for a scan on the next loop; results appear in `networks()`.
  void request_scan();
  bool scanning() const { return scan_pending_; }
  std::size_t network_count() const { return networks_.size(); }
  const std::vector<NetworkEntry>& networks() const { return networks_; }

 private:
  void handle_root();
  void handle_status();
  void handle_networks();
  void handle_join();
  void handle_forget();
  void handle_settings();
  void handle_time_zones();
  void handle_update_upload();
  void handle_update_done();
  /// 0 when the request may proceed, else the HTTP status to answer with.
  int auth_status();

  FirmwareUpdater updater_;
  String update_error_;
  bool update_ok_{false};
  UpdateGateFn update_gate_;
  UpdateDoneFn update_done_;
  RestartFn restart_;
  ActionFn release_check_;
  ActionFn release_install_;
  void handle_restart();
  void handle_release_action(const ActionFn& action);
  void handle_not_found();
  bool redirect_to_portal();
  bool authorized();
  void collect_scan(int count);
  void run_scan();

  WebServer server_{80};
  DNSServer dns_;
  std::vector<NetworkEntry> networks_;
  StatusFn status_;
  JoinFn join_;
  ForgetFn forget_;
  SettingsFn settings_;
  String admin_code_;
  bool code_required_{false};
  bool forget_pending_{false};
  std::uint32_t forget_at_ms_{0};
  std::uint8_t failed_codes_{0};
  std::uint32_t lockout_until_ms_{0};
  bool ap_active_{false};
  bool mdns_started_{false};
  bool scan_pending_{false};
  bool scanned_once_{false};
  bool server_started_{false};
};

}  // namespace apple::firmware
