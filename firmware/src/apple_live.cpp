// Autonomous Home Run Apple target.
//
// On first boot it opens its own setup network; the owner joins it from a
// phone and the captive Apple Manager page takes the home Wi-Fi credentials,
// which live in the board's flash from then on. The Apple then polls the MLB
// Stats API over certificate-validated HTTPS and runs the shared C++ pipeline
// on the board: feed adapter -> game-state projector -> decision core ->
// screens, celebration animations, and the timed motion model. Without
// APPLE_MOTION_DRIVE the motion adapter only records: the model runs and
// reports positions, but the L298N pins never leave LOW.
//
// Serial keys: `?` status, `x` stop motion and reset the sequence, `r` replay
// the recorded Mets at Rays game from fixtures/mlb (no network needed),
// `s` refresh the schedule now, `p` poll the feed now, `w` forget the saved
// Wi-Fi network and reopen the setup network.

#include "apple/core/engine.hpp"
#include "apple/core/evidence_bridge.hpp"
#include "apple/display/home_run_loop.hpp"
#include "apple/display/mets_win_loop.hpp"
#include "apple/firmware/board_pins.hpp"
#include "apple/firmware/manager.hpp"
#include "apple/firmware/release_pick.hpp"
#include "apple/firmware/update_roots.hpp"
#include "apple/firmware/time_zones.hpp"
#include "apple/firmware/firmware_update.hpp"
#include "apple/firmware/mlb_root_ca.hpp"
#include "apple/firmware/scan_lock.hpp"
#include "apple/firmware/screens.hpp"
#include "apple/game_state/projector.hpp"
#include "apple/mlb_feed/feed.hpp"
#include "apple/mlb_feed/schedule.hpp"
#include "apple/motion/timed_actuator.hpp"
#include "../fixtures/mlb/fixtures.hpp"

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

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <qrcode.h>

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <new>
#include <optional>
#include <string>
#include <vector>

namespace {

using apple::core::Command;
using apple::core::CommandType;
using apple::core::Engine;
using apple::core::EngineOutput;
using apple::core::EventLedger;
using apple::core::LedgerLookup;
using apple::core::SequenceState;
using apple::firmware::FinalScreen;
using apple::firmware::GameScreen;
using apple::firmware::ScreenModel;
using apple::firmware::ScreenPainter;
using apple::firmware::ScreenState;
using apple::firmware::UpcomingScreen;
using apple::firmware::copy_text;
using apple::firmware::kDarkBlue;
using apple::firmware::kDisplayBacklightPin;
using apple::firmware::kDisplayChipSelectPin;
using apple::firmware::kDisplayDataCommandPin;
using apple::firmware::kDisplayHeight;
using apple::firmware::kDisplayResetPin;
using apple::firmware::kDisplayWidth;
using apple::game_state::GameSnapshot;
using apple::game_state::Half;
using apple::game_state::Phase;
using apple::mlb_feed::Extraction;
using apple::mlb_feed::FeedTracker;
using apple::mlb_feed::ScheduleGame;
using apple::motion::Drive;
using apple::motion::Rejection;
using apple::motion::Step;
using apple::motion::TimedActuator;

constexpr char kProfileName[] = "apple_live";
#ifdef APPLE_UPDATE_CRASH_TEST
constexpr char kFirmwareVersion[] = "0.2.2-crashtest";
#else
constexpr char kFirmwareVersion[] = "0.3.0-rc.4";
#endif
constexpr char kHostname[] = "home-run-apple";
constexpr char kEasternTz[] = "EST5EDT,M3.2.0,M11.1.0";
constexpr char kMlbOrigin[] = "https://statsapi.mlb.com";
constexpr std::uint8_t kMotorIn1Pin = D4;
constexpr std::uint8_t kMotorIn2Pin = D5;
constexpr std::uint8_t kMotorEnablePin = D6;
// Owner reset button to ground (internal pull-up). Hold clears Wi-Fi and
// settings; a short press shows the address and the code.
constexpr std::uint8_t kResetButtonPin = D3;
constexpr std::uint32_t kResetHoldMs = 10'000;
constexpr std::uint32_t kResetShortPressMaxMs = 1'000;
constexpr std::uint32_t kInfoScreenMs = 60'000;
constexpr std::uint32_t kSerialWaitTimeoutMs = 3'000;
constexpr std::uint32_t kLoopPeriodMs = 10;
constexpr std::uint32_t kWatchdogSeconds = 90;
constexpr std::uint32_t kHttpTimeoutMs = 20'000;
constexpr std::uint32_t kWifiRetryMs = 15'000;
// Credentials that do not connect within this window reopen the setup network
// so the owner can fix a changed password without touching the board.
constexpr std::uint32_t kJoinTimeoutMs = 45'000;
constexpr std::uint32_t kJoinGraceMs = 10'000;
// The setup network stays up this long after a successful join so the phone
// that entered the password can read the result.
constexpr std::uint32_t kSetupNetworkLingerMs = 20'000;
// The setup display alternates between the QR code and the typed details.
constexpr std::uint32_t kSetupScreenFlipMs = 10'000;
constexpr std::uint32_t kScheduleRefreshMs = 10 * 60 * 1000;
constexpr std::uint32_t kScheduleRetryMs = 60 * 1000;
constexpr std::uint32_t kPollRetryMs = 30 * 1000;
constexpr std::uint32_t kPollRetryMaxMs = 5 * 60 * 1000;
constexpr std::uint32_t kPregamePollMs = 60 * 1000;
constexpr std::uint32_t kFinalPollMs = 60 * 1000;
constexpr std::uint32_t kStandardFinalHoldMs = 20 * 60 * 1000;
constexpr std::uint32_t kDoubleheaderFinalHoldMs = 10'000;
constexpr std::int64_t kPregameLeadSeconds = 60 * 60;
constexpr std::uint32_t kRainFrameDurationMs = 150;
constexpr std::uint8_t kRainFrameCount = 6;
constexpr std::uint32_t kStatusPeriodMs = 30'000;
constexpr std::size_t kLedgerCapacity = 24;
constexpr std::uint16_t kRaisedSecondsMin = 5;
constexpr std::uint16_t kRaisedSecondsMax = 120;
// Three boots in a row that die before this many seconds pass means the
// network or Manager startup is crashing; the next boot skips them so the
// USB flasher (which runs inside this app) stays reachable.
constexpr std::uint32_t kBootSettleMs = 30'000;
// A freshly installed firmware counts as proven once it has fetched the
// schedule, or after this long without one (no Wi-Fi is not its fault).
constexpr std::uint32_t kBootConfirmMaxMs = 5 * 60 * 1000;
// Release checks against GitHub: shortly after joining Wi-Fi, then daily;
// sooner after a failure. Installs wait for the quiet window between games.
constexpr std::uint32_t kReleaseFirstCheckMs = 90 * 1000;
constexpr std::uint32_t kReleaseCheckPeriodMs = 24UL * 60 * 60 * 1000;
constexpr std::uint32_t kReleaseRetryMs = 60UL * 60 * 1000;
constexpr int kInstallWindowStartHour = 3;  // local time, inclusive
constexpr int kInstallWindowEndHour = 6;    // exclusive
constexpr char kReleasesUrl[] = "https://api.github.com/repos/donth77/mets-home-run-apple/releases?per_page=10";
constexpr std::uint8_t kBacklightChannel = 4;  // LEDC channel for dimming the display
constexpr std::uint8_t kBrightnessMin = 10;   // percent
constexpr std::uint32_t kEarlyCrashLimit = 3;
constexpr std::int64_t kReplayGamePk = 822929;
#if defined(APPLE_MOTION_DRIVE)
constexpr bool kMotionDrive = true;
#else
constexpr bool kMotionDrive = false;
#endif

// ---------------------------------------------------------------------------
// Memory helpers: the celebration renderers and the scan-locked panel carry
// large frame buffers. Placing them in PSRAM leaves internal RAM for Wi-Fi
// and TLS.

template <typename T, typename... Args>
T* make_in_psram(Args&&... args) {
  void* memory = nullptr;
  if (psramFound()) memory = heap_caps_malloc(sizeof(T), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (memory == nullptr) memory = malloc(sizeof(T));
  return new (memory) T(static_cast<Args&&>(args)...);
}

struct SpiRamAllocator final : ArduinoJson::Allocator {
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

// ---------------------------------------------------------------------------
// Persistent ledger of accepted celebration keys. The decision core asks it
// before starting a celebration, so a reboot mid-game never repeats one.

class NvsLedger final : public EventLedger {
 public:
  void begin() {
    preferences_.begin("ledger", false);
    next_ = preferences_.getUInt("i", 0) % kLedgerCapacity;
    for (std::size_t index = 0; index < kLedgerCapacity; ++index) {
      const String value = preferences_.getString(slot(index).c_str(), "");
      keys_[index] = value.c_str();
    }
  }

  LedgerLookup lookup(std::string_view key) const override {
    for (const std::string& stored : keys_) {
      if (!stored.empty() && stored == key) return LedgerLookup::Present;
    }
    return LedgerLookup::Missing;
  }

  bool persist(std::string_view key) override {
    if (lookup(key) == LedgerLookup::Present) return true;
    keys_[next_] = std::string(key);
    const bool wrote = preferences_.putString(slot(next_).c_str(), keys_[next_].c_str()) > 0;
    next_ = (next_ + 1) % kLedgerCapacity;
    preferences_.putUInt("i", static_cast<std::uint32_t>(next_));
    return wrote;
  }

  std::size_t count() const {
    std::size_t total = 0;
    for (const std::string& stored : keys_) total += stored.empty() ? 0 : 1;
    return total;
  }

 private:
  static std::string slot(std::size_t index) { return "k" + std::to_string(index); }

  Preferences preferences_;
  std::string keys_[kLedgerCapacity];
  std::size_t next_{0};
};

class MemoryLedger final : public EventLedger {
 public:
  LedgerLookup lookup(std::string_view key) const override {
    for (const std::string& stored : keys_) {
      if (stored == key) return LedgerLookup::Present;
    }
    return LedgerLookup::Missing;
  }
  bool persist(std::string_view key) override {
    keys_.emplace_back(key);
    return true;
  }
  void clear() { keys_.clear(); }

 private:
  std::vector<std::string> keys_;
};

// ---------------------------------------------------------------------------
// State

enum class NetState : std::uint8_t { NoCredentials, Connecting, Connected, Lost, Failed };

Adafruit_ST7789 panel(kDisplayChipSelectPin, kDisplayDataCommandPin, kDisplayResetPin);
GFXcanvas16 display(kDisplayWidth, kDisplayHeight);
ScreenModel model;
ScreenPainter painter(display);
apple::firmware::ScanLockedPanel* scan_lock = nullptr;
apple::display::HomeRunLoop* home_run_loop = nullptr;
apple::display::MetsWinLoop* mets_win_loop = nullptr;

NvsLedger nvs_ledger;
MemoryLedger replay_ledger;
std::optional<Engine> engine;
apple::game_state::Projector projector;
FeedTracker tracker;
TimedActuator actuator(apple::motion::kReferenceProfile);
Drive applied_drive = Drive::Off;
SequenceState shown_sequence = SequenceState::Idle;
SpiRamAllocator json_allocator;
WiFiClientSecure secure_client;

apple::firmware::WifiCredentials credentials;
apple::firmware::ManagerServer manager;
// Owner settings, stored in flash and changed from the Manager page.
struct Settings {
  std::uint16_t raised_seconds{static_cast<std::uint16_t>(apple::core::kRaisedDwellMs / 1000)};
  bool motor{true};  // the Apple is built to move; the Manager switch can turn it off
  bool follow{true};
  bool sleep_display{false};
  bool require_code{false};  // ask for the setup key before changes from the home network
  char time_zone[40]{"America/New_York"};  // IANA id from the Manager table
  const char* posix_tz{kEasternTz};        // rule handed to the clock library
  bool tz_chosen{false};  // set once an owner or their setup device picked a zone
  std::uint8_t brightness{100};  // display backlight, percent
  bool auto_update{true};   // install a new release on its own, between games
  bool beta{false};         // developer: also take pre-releases
  char github_token[128]{""};  // developer: read-only token while the repository is private
};

// The most recent real celebration, kept in flash for the Manager's status.
struct LastCelebration {
  char kind[8] = "";      // "HR" or "WIN"
  char subject[40] = "";  // batter, or the final score
  std::int64_t at{0};     // epoch seconds
  bool moved{false};      // the motor was on at the time
};
LastCelebration last_celebration;
Preferences history_store;
Settings settings;

// Resolves an IANA id through the Manager's table; false leaves the zone as is.
bool set_time_zone(const char* iana_id) {
  const apple::firmware::TimeZoneInfo* zone = apple::firmware::find_time_zone(iana_id);
  if (zone == nullptr) return false;
  std::snprintf(settings.time_zone, sizeof(settings.time_zone), "%s", zone->id);
  settings.posix_tz = zone->posix;
  return true;
}
Preferences settings_store;
bool backlight_on = true;
Preferences boot_guard;
bool safe_mode = false;
bool boot_settled = false;
bool update_pending_boot = false;  // a wireless update has not proven itself yet
bool schedule_ok_since_boot = false;  // the network path works on this firmware
std::uint32_t restart_at_ms = 0;   // set after an update is written
NetState net_state = NetState::NoCredentials;
std::uint32_t next_wifi_attempt_ms = 0;
std::uint32_t join_started_ms = 0;
std::uint32_t setup_network_close_ms = 0;
bool setup_network_closing = false;
std::uint32_t next_setup_flip_ms = 0;
std::uint32_t button_down_since_ms = 0;
bool button_was_down = false;
std::int32_t reset_countdown_shown = -1;
std::uint32_t info_screen_until_ms = 0;
bool time_synced = false;

std::vector<ScheduleGame> schedule;
std::optional<ScheduleGame> game;
std::uint32_t next_schedule_ms = 0;
std::uint32_t next_poll_ms = 0;
std::uint32_t poll_backoff_ms = kPollRetryMs;
std::uint32_t polls_ok = 0;
std::uint32_t polls_failed = 0;
std::uint32_t last_poll_duration_ms = 0;
std::uint32_t last_poll_bytes = 0;
std::uint32_t final_card_started_ms = 0;
std::uint32_t regressed_in_a_row = 0;
constexpr std::uint32_t kRegressionsBeforeResync = 5;
bool final_seen = false;
bool final_card_visible = false;
bool final_handoff_requested = false;
bool final_has_game_two = false;
char last_error[64] = "";
std::uint32_t next_status_ms = 0;

bool celebration_active = false;
bool celebration_is_win = false;
std::uint32_t celebration_started_ms = 0;
std::uint32_t celebration_last_key = 0xFFFFFFFFU;
bool needs_redraw = true;
std::uint8_t last_rain_frame = 0xFF;

bool replay_active = false;
std::size_t replay_step = 0;
std::uint32_t next_replay_ms = 0;

struct ReplayStep {
  const char* name;
  const char* feed;
  std::uint32_t delay_ms;
};
const ReplayStep kReplay[] = {
    {"pregame", apple::fixtures::mlb::k_822929_pregame, 0},
    {"first pitch", apple::fixtures::mlb::k_822929_hr_pending, 4'000},
    {"Lindor home run", apple::fixtures::mlb::k_822929_hr, 4'000},
    {"fourth inning", apple::fixtures::mlb::k_822929_live_mid, 55'000},
    {"final", apple::fixtures::mlb::k_822929_final, 8'000},
};

std::uint64_t now_ms() { return static_cast<std::uint64_t>(esp_timer_get_time() / 1000); }
void show_paused_screen();
String on_settings(const apple::firmware::SettingsUpdate& update);
void save_settings();
void apply_time_zone();
String update_gate();
void on_update_done();
String on_restart_request();
String on_check_request();
String on_install_request();
bool install_window_open();
enum class ReleaseState : std::uint8_t { Idle, Checking, UpToDate, Available, Downloading, Failed };
const char* release_state_name(ReleaseState state);
struct ReleaseStatus {
  ReleaseState state{ReleaseState::Idle};
  apple::firmware::ReleasePick pick;
  std::int64_t checked_at{0};      // epoch seconds of the last completed check
  std::uint32_t next_check_ms{0};  // 0 until Wi-Fi is up
  bool check_requested{false};
  bool install_requested{false};
  char error[40] = "";
};
ReleaseStatus release;

// A celebration on screen can never outlive the engine's own bounds.
std::uint32_t celebration_display_max_ms() {
  return static_cast<std::uint32_t>(apple::core::kCelebrationLeadInMs + 2 * apple::core::kMotionDeadlineMs +
                                    static_cast<std::uint64_t>(settings.raised_seconds) * 1000 + 5'000);
}

void make_engine(EventLedger& ledger) {
  engine.emplace(ledger);
  engine->set_raised_dwell_ms(static_cast<std::uint64_t>(settings.raised_seconds) * 1000);
}
std::uint32_t now32() { return static_cast<std::uint32_t>(now_ms()); }
bool due(std::uint32_t at_ms) { return static_cast<std::int32_t>(now32() - at_ms) >= 0; }

std::int64_t wall_epoch() { return static_cast<std::int64_t>(time(nullptr)); }
bool clock_valid() { return wall_epoch() > 1'700'000'000; }

// ---------------------------------------------------------------------------
// Serial protocol

void publish_trace(const char* code, const char* detail) {
  Serial.printf("APPLE_LIVE:{\"type\":\"trace\",\"code\":\"%s\",\"detail\":\"%s\"}\n", code, detail);
}

void set_error(const char* code) {
  copy_text(last_error, sizeof(last_error), code);
  publish_trace("ERROR", code);
}

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

const char* phase_name(Phase phase) {
  switch (phase) {
    case Phase::Live:
      return "LIVE";
    case Phase::Review:
      return "REVIEW";
    case Phase::Delayed:
      return "DELAYED";
    case Phase::Final:
      return "FINAL";
    case Phase::Sleep:
      return "SLEEP";
    case Phase::Pregame:
    default:
      return "PREGAME";
  }
}

const char* half_name(Half half) {
  switch (half) {
    case Half::Bottom:
      return "BOTTOM";
    case Half::Middle:
      return "MIDDLE";
    case Half::End:
      return "END";
    case Half::Top:
    default:
      return "TOP";
  }
}

const char* device_mode() {
  if (safe_mode) return "SAFE_MODE";
  if (engine && engine->fault_latched()) return "SAFE_FAULT";
  if (!settings.follow && !replay_active) return "PAUSED";
  if (replay_active) return "REPLAY";
  if (celebration_active) return "CELEBRATING";
  if (!credentials.configured() || net_state == NetState::Failed) return "SETUP";
  if (net_state != NetState::Connected) return "OFFLINE";
  if (!game) return "BETWEEN_GAMES";
  if (!projector.has_projection()) {
    return apple::mlb_feed::should_poll(*game, wall_epoch(), kPregameLeadSeconds) ? "BOOTSTRAPPING" : "UPCOMING";
  }
  return phase_name(projector.snapshot().phase);
}

void publish_hello() {
  Serial.printf(
      "APPLE_LIVE:{\"type\":\"hello\",\"profile\":\"%s\",\"firmwareVersion\":\"%s\","
      "\"motion\":\"%s\",\"wifiConfigured\":%s,\"hostname\":\"%s\",\"psram\":%s,"
      "\"setupKey\":\"%s\","
      "\"leadInMs\":%lu,\"dwellMs\":%lu,\"deadlineMs\":%lu}\n",
      kProfileName, kFirmwareVersion, settings.motor ? "L298N" : "RECORDING",
      credentials.configured() ? "true" : "false", kHostname,
      psramFound() ? "true" : "false", credentials.setup_key().c_str(),
      static_cast<unsigned long>(apple::core::kCelebrationLeadInMs),
      static_cast<unsigned long>(settings.raised_seconds) * 1000UL,
      static_cast<unsigned long>(apple::core::kMotionDeadlineMs));
}

void fill_status(JsonDocument& doc) {
  const bool connected = WiFi.status() == WL_CONNECTED;
  const std::uint64_t now = now_ms();
  doc["type"] = "status";
  doc["mode"] = device_mode();
  doc["firmwareVersion"] = kFirmwareVersion;
  doc["hostname"] = kHostname;
  doc["motion"] = settings.motor ? "L298N" : "RECORDING";
  doc["firmwareSlot"] = apple::firmware::running_partition_label();
  doc["updatePending"] = update_pending_boot;
  JsonObject owner = doc["settings"].to<JsonObject>();
  owner["raisedSeconds"] = settings.raised_seconds;
  owner["motor"] = settings.motor;
  owner["follow"] = settings.follow;
  owner["sleepDisplay"] = settings.sleep_display;
  owner["requireCode"] = settings.require_code;
  owner["timeZone"] = settings.time_zone;
  const apple::firmware::TimeZoneInfo* zone = apple::firmware::find_time_zone(settings.time_zone);
  owner["timeZoneLabel"] = zone ? zone->label : "";
  owner["timeZoneChosen"] = settings.tz_chosen;
  owner["brightness"] = settings.brightness;
  owner["autoUpdate"] = settings.auto_update;
  owner["beta"] = settings.beta;
  owner["tokenSet"] = settings.github_token[0] != '\0';
  JsonObject rel = doc["update"].to<JsonObject>();
  rel["state"] = release_state_name(release.state);
  rel["version"] = release.pick.found ? release.pick.version.c_str() : "";
  rel["prerelease"] = release.pick.found && release.pick.prerelease;
  rel["size"] = release.pick.found ? release.pick.asset_size : 0;
  rel["checkedAt"] = release.checked_at;
  rel["nextCheckIn"] = release.next_check_ms == 0 ? -1 : std::max<std::int32_t>(0, static_cast<std::int32_t>(release.next_check_ms - now32())) / 1000;
  rel["error"] = release.error;
  rel["windowOpen"] = install_window_open();
  if (last_celebration.at != 0) {
    JsonObject last = doc["lastCelebration"].to<JsonObject>();
    last["kind"] = last_celebration.kind;
    last["subject"] = last_celebration.subject;
    last["at"] = last_celebration.at;
    last["moved"] = last_celebration.moved;
  }
  // The page shows the code once when the owner turns the lock on; with the
  // lock off anyone on the network could change settings anyway.
  owner["setupKey"] = settings.require_code ? String() : credentials.setup_key();
  owner["backlight"] = backlight_on;
  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["configured"] = credentials.configured();
  wifi["state"] = net_state_name();
  wifi["ssid"] = credentials.ssid();
  wifi["rssi"] = connected ? WiFi.RSSI() : 0;
  wifi["ip"] = connected ? WiFi.localIP().toString() : String("");
  wifi["setupNetwork"] = manager.setup_network_active();
  wifi["setupClients"] = manager.setup_clients();
  wifi["scanning"] = manager.scanning();
  wifi["networksFound"] = manager.network_count();
  doc["clock"] = clock_valid();
  doc["heapFree"] = ESP.getFreeHeap();
  doc["heapLargest"] = ESP.getMaxAllocHeap();
  doc["psramFree"] = ESP.getFreePsram();
  if (game) {
    JsonObject node = doc["game"].to<JsonObject>();
    node["gamePk"] = game->game_pk;
    node["gameNumber"] = game->game_number;
    node["away"] = game->away.abbreviation;
    node["home"] = game->home.abbreviation;
    node["scheduled"] = game->game_date;
    node["state"] = game->detailed_state;
  } else {
    doc["game"] = nullptr;
  }
  if (projector.has_projection()) {
    const GameSnapshot& snapshot = projector.snapshot();
    JsonObject node = doc["snapshot"].to<JsonObject>();
    node["phase"] = phase_name(snapshot.phase);
    node["label"] = snapshot.label;
    node["awayRuns"] = snapshot.away.runs;
    node["homeRuns"] = snapshot.home.runs;
    node["inning"] = snapshot.inning;
    node["half"] = half_name(snapshot.half);
    node["outs"] = snapshot.outs;
    node["cursor"] = tracker.cursor();
    node["awayId"] = snapshot.away.id;
    node["homeId"] = snapshot.home.id;
    node["lastEvent"] = snapshot.last_event;
    if (snapshot.at_bat) {
      const auto& at_bat = *snapshot.at_bat;
      JsonObject situation = node["atBat"].to<JsonObject>();
      situation["balls"] = at_bat.balls;
      situation["strikes"] = at_bat.strikes;
      situation["first"] = at_bat.bases.first;
      situation["second"] = at_bat.bases.second;
      situation["third"] = at_bat.bases.third;
      if (at_bat.batter) situation["batter"] = *at_bat.batter;
      if (at_bat.batter_line) situation["batterLine"] = *at_bat.batter_line;
      if (at_bat.pitcher) situation["pitcher"] = *at_bat.pitcher;
      if (at_bat.pitch_count) situation["pitchCount"] = *at_bat.pitch_count;
    }
  } else {
    doc["snapshot"] = nullptr;
  }
  JsonObject poll = doc["poll"].to<JsonObject>();
  poll["ok"] = polls_ok;
  poll["failed"] = polls_failed;
  poll["lastMs"] = last_poll_duration_ms;
  poll["lastBytes"] = last_poll_bytes;
  poll["nextInMs"] = static_cast<std::int32_t>(next_poll_ms - now32());
  poll["lastError"] = last_error;
  doc["ledger"] = nvs_ledger.count();
  doc["sequence"] = apple::core::sequence_state_name(engine ? engine->sequence_state() : SequenceState::Idle);
  doc["fault"] = engine && engine->fault_latched();
  doc["drive"] = apple::motion::drive_name(applied_drive);
  doc["positionMm"] = actuator.estimated_position_mm(now);
  doc["ena"] = settings.motor && applied_drive != Drive::Off ? 1 : 0;
  doc["in1"] = settings.motor && applied_drive == Drive::Extend ? 1 : 0;
  doc["in2"] = settings.motor && applied_drive == Drive::Retract ? 1 : 0;
}

void publish_status() {
  JsonDocument doc;
  fill_status(doc);
  Serial.print("APPLE_LIVE:");
  serializeJson(doc, Serial);
  Serial.println();
}

// ---------------------------------------------------------------------------
// Text helpers for the 5x7 panel font: fold accents and typographic dashes.

void ascii_fold(const char* source, char* destination, std::size_t capacity) {
  std::size_t written = 0;
  const auto put = [&](char c) {
    if (written + 1 < capacity) destination[written++] = c;
  };
  for (const unsigned char* at = reinterpret_cast<const unsigned char*>(source); *at != '\0';) {
    if (*at < 0x80) {
      put(static_cast<char>(*at));
      ++at;
      continue;
    }
    if (at[0] == 0xE2 && at[1] == 0x80 && (at[2] == 0x93 || at[2] == 0x94)) {
      put('-');
      at += 3;
      continue;
    }
    if (at[0] == 0xC2 && at[1] == 0xB7) {
      put('-');
      at += 2;
      continue;
    }
    if (at[0] == 0xC3 && at[1] != '\0') {
      static constexpr char kFold[] = "AAAAAAACEEEEIIIIDNOOOOOxOUUUUYTsaaaaaaaceeeeiiiidnooooo/ouuuuyty";
      const unsigned index = at[1] - 0x80;
      put(index < sizeof(kFold) - 1 ? kFold[index] : '?');
      at += 2;
      continue;
    }
    // Any other multi-byte sequence: skip it whole.
    put('?');
    ++at;
    while ((*at & 0xC0) == 0x80) ++at;
  }
  if (capacity > 0) destination[written] = '\0';
}

void upper(char* text) {
  for (; *text != '\0'; ++text) *text = static_cast<char>(std::toupper(static_cast<unsigned char>(*text)));
}

void collapse_spaces(char* text) {
  char* out = text;
  bool previous_space = false;
  for (const char* in = text; *in != '\0'; ++in) {
    const bool space = *in == ' ';
    if (space && previous_space) continue;
    *out++ = *in;
    previous_space = space;
  }
  *out = '\0';
}

// ---------------------------------------------------------------------------
// Screens

void request_redraw() { needs_redraw = true; }

void reset_final_tracking() {
  final_seen = false;
  final_card_visible = false;
  final_handoff_requested = false;
  final_has_game_two = false;
  final_card_started_ms = 0;
}

std::optional<ScheduleGame> doubleheader_game_two() {
  return game ? apple::mlb_feed::choose_doubleheader_game_two(schedule, *game)
              : std::nullopt;
}

std::uint32_t final_hold_ms() {
  return final_has_game_two ? kDoubleheaderFinalHoldMs : kStandardFinalHoldMs;
}

void mark_final_card_visible() {
  if (!final_seen || final_card_visible || model.state != ScreenState::Final)
    return;
  final_card_visible = true;
  final_card_started_ms = now32();
  final_handoff_requested = false;
  next_schedule_ms = now32();
}

void show_waiting(const char* status, std::uint16_t accent = apple::firmware::kMetsOrange,
                  apple::firmware::WaitingIcon icon = apple::firmware::WaitingIcon::None) {
  model.state = ScreenState::Waiting;
  model.waiting_accent = accent;
  model.waiting_icon = icon;
  copy_text(model.status_message, sizeof(model.status_message), status);
  request_redraw();
}

void show_upcoming(const ScheduleGame& next) {
  model.state = ScreenState::Upcoming;
  model.upcoming.game_number = static_cast<std::uint8_t>(next.game_number);
  ascii_fold(next.away.abbreviation.c_str(), model.upcoming.away, sizeof(model.upcoming.away));
  ascii_fold(next.home.abbreviation.c_str(), model.upcoming.home, sizeof(model.upcoming.home));
  ascii_fold(next.venue.c_str(), model.upcoming.venue, sizeof(model.upcoming.venue));
  copy_text(model.upcoming.date, sizeof(model.upcoming.date), "DATE TBD");
  copy_text(model.upcoming.time, sizeof(model.upcoming.time), "TIME TBD");
  copy_text(model.upcoming.timezone, sizeof(model.upcoming.timezone), "");
  const std::optional<std::int64_t> start = apple::mlb_feed::parse_iso8601_utc(next.game_date);
  if (start && clock_valid()) {
    const time_t at = static_cast<time_t>(*start);
    struct tm local;
    localtime_r(&at, &local);
    strftime(model.upcoming.date, sizeof(model.upcoming.date), "%a %b %e", &local);
    upper(model.upcoming.date);
    collapse_spaces(model.upcoming.date);
    strftime(model.upcoming.time, sizeof(model.upcoming.time), "%I:%M %p", &local);
    if (model.upcoming.time[0] == '0') memmove(model.upcoming.time, model.upcoming.time + 1, sizeof(model.upcoming.time) - 1);
    strftime(model.upcoming.timezone, sizeof(model.upcoming.timezone), "%Z", &local);
  }
  request_redraw();
}

void show_snapshot(const GameSnapshot& snapshot) {
  char label[48];
  ascii_fold(snapshot.label.c_str(), label, sizeof(label));
  upper(label);
  if (snapshot.phase == Phase::Live || snapshot.phase == Phase::Review ||
      snapshot.phase == Phase::Delayed) {
    ascii_fold(snapshot.away.abbreviation.c_str(), model.game.away,
               sizeof(model.game.away));
    ascii_fold(snapshot.home.abbreviation.c_str(), model.game.home,
               sizeof(model.game.home));
    model.game.away_score = static_cast<std::uint16_t>(snapshot.away.runs);
    model.game.home_score = static_cast<std::uint16_t>(snapshot.home.runs);
    model.game.valid = true;
  }
  switch (snapshot.phase) {
    case Phase::Live: {
      GameScreen& screen = model.game;
      const char* half = snapshot.half == Half::Top      ? "TOP"
                         : snapshot.half == Half::Bottom ? "BOT"
                         : snapshot.half == Half::Middle ? "MID"
                                                         : "END";
      std::snprintf(screen.inning, sizeof(screen.inning), "%s %ld", half, static_cast<long>(snapshot.inning));
      screen.outs = static_cast<std::uint8_t>(snapshot.outs);
      screen.balls = 0;
      screen.strikes = 0;
      screen.occupied_bases = 0;
      copy_text(screen.batter, sizeof(screen.batter), "-");
      copy_text(screen.batter_line, sizeof(screen.batter_line), "-");
      copy_text(screen.pitcher, sizeof(screen.pitcher), "-");
      screen.pitch_count = 0;
      if (snapshot.at_bat) {
        const auto& at_bat = *snapshot.at_bat;
        screen.balls = static_cast<std::uint8_t>(at_bat.balls);
        screen.strikes = static_cast<std::uint8_t>(at_bat.strikes);
        screen.occupied_bases = static_cast<std::uint8_t>((at_bat.bases.first ? 0x01 : 0) |
                                                          (at_bat.bases.second ? 0x02 : 0) |
                                                          (at_bat.bases.third ? 0x04 : 0));
        if (at_bat.batter) ascii_fold(at_bat.batter->c_str(), screen.batter, sizeof(screen.batter));
        if (at_bat.batter_line) {
          ascii_fold(at_bat.batter_line->c_str(), screen.batter_line, sizeof(screen.batter_line));
          collapse_spaces(screen.batter_line);
        }
        if (at_bat.pitcher) ascii_fold(at_bat.pitcher->c_str(), screen.pitcher, sizeof(screen.pitcher));
        screen.pitch_count = static_cast<std::uint16_t>(at_bat.pitch_count.value_or(0));
      }
      ascii_fold(snapshot.venue.value_or("").c_str(), screen.venue, sizeof(screen.venue));
      ascii_fold(snapshot.last_event.c_str(), screen.event, sizeof(screen.event));
      screen.valid = true;
      model.state = ScreenState::Game;
      break;
    }
    case Phase::Review:
      model.state = ScreenState::Review;
      copy_text(model.state_detail, sizeof(model.state_detail), label);
      break;
    case Phase::Delayed:
      if (snapshot.label == "RAIN DELAY") {
        model.state = ScreenState::RainDelay;
      } else if (std::strstr(label, "SUSPENDED") != nullptr) {
        model.state = ScreenState::Suspended;
        copy_text(model.state_detail, sizeof(model.state_detail), "WAITING FOR UPDATE");
      } else if (std::strstr(label, "POSTPONED") != nullptr) {
        model.state = ScreenState::Postponed;
        copy_text(model.state_detail, sizeof(model.state_detail), label);
      } else if (std::strstr(label, "CANCEL") != nullptr) {
        model.state = ScreenState::Cancelled;
        copy_text(model.state_detail, sizeof(model.state_detail), label);
      } else {
        model.state = ScreenState::GenericDelay;
        copy_text(model.delay_detail, sizeof(model.delay_detail), "WAITING FOR UPDATE");
      }
      break;
    case Phase::Final: {
      FinalScreen& screen = model.final_game;
      ascii_fold(snapshot.away.abbreviation.c_str(), screen.away, sizeof(screen.away));
      ascii_fold(snapshot.home.abbreviation.c_str(), screen.home, sizeof(screen.home));
      screen.away_score = static_cast<std::uint16_t>(snapshot.away.runs);
      screen.home_score = static_cast<std::uint16_t>(snapshot.home.runs);
      const bool mets_away = snapshot.away.id == apple::mlb_feed::kMetsTeamId;
      const std::int32_t mets_runs = mets_away ? snapshot.away.runs : snapshot.home.runs;
      const std::int32_t other_runs = mets_away ? snapshot.home.runs : snapshot.away.runs;
      copy_text(screen.result, sizeof(screen.result),
                mets_runs > other_runs ? "METS_WIN"
                : mets_runs < other_runs ? "METS_LOSS"
                                         : "TIE");
      ascii_fold(snapshot.venue.value_or("").c_str(), screen.venue, sizeof(screen.venue));
      model.state = ScreenState::Final;
      break;
    }
    case Phase::Pregame:
      if (game) {
        show_upcoming(*game);
        return;
      }
      show_waiting(label);
      return;
    case Phase::Sleep:
    default:
      show_waiting(label);
      return;
  }
  request_redraw();
}

void render_if_needed() {
  if (celebration_active) return;
  const std::uint8_t rain_frame = static_cast<std::uint8_t>((now32() / kRainFrameDurationMs) % kRainFrameCount);
  const bool rain_changed = model.state == ScreenState::RainDelay && rain_frame != last_rain_frame;
  if (!needs_redraw && !rain_changed) return;
  painter.draw(model, rain_frame);
  if (model.state == ScreenState::RainDelay) last_rain_frame = rain_frame;
  panel.drawRGBBitmap(0, 0, display.getBuffer(), kDisplayWidth, kDisplayHeight);
  needs_redraw = false;
}

// ---------------------------------------------------------------------------
// Celebration display

void end_celebration(const char* reason) {
  if (!celebration_active) return;
  celebration_active = false;
  scan_lock->leave();
  mark_final_card_visible();
  request_redraw();
  Serial.printf("APPLE_LIVE:{\"type\":\"celebration\",\"status\":\"ENDED\",\"reason\":\"%s\"}\n", reason);
}

void begin_celebration(const apple::core::CoreEvent& event) {
  end_celebration("REPLACED");
  const GameSnapshot& snapshot = projector.snapshot();
  celebration_is_win = event.celebration == apple::core::CelebrationKind::MetsWin;
  if (celebration_is_win) {
    char away[5];
    char home[5];
    ascii_fold(snapshot.away.abbreviation.c_str(), away, sizeof(away));
    ascii_fold(snapshot.home.abbreviation.c_str(), home, sizeof(home));
    mets_win_loop->begin(away, static_cast<unsigned>(snapshot.away.runs), home,
                         static_cast<unsigned>(snapshot.home.runs),
                         snapshot.home.id == apple::mlb_feed::kMetsTeamId, esp_random());
  } else {
    char name[apple::display::HomeRunLoop::kMaxNameLength + 1];
    ascii_fold(event.subject.c_str(), name, sizeof(name));
    home_run_loop->begin(event.celebration == apple::core::CelebrationKind::GrandSlam
                             ? apple::display::Headline::GrandSlam
                             : apple::display::Headline::HomeRun,
                         name, esp_random());
  }
  celebration_active = true;
  celebration_started_ms = now32();
  celebration_last_key = 0xFFFFFFFFU;
  scan_lock->enter(1);
  if (!replay_active && clock_valid()) {
    // Remember it for the Manager's status; replays are not history.
    copy_text(last_celebration.kind, sizeof(last_celebration.kind), celebration_is_win ? "WIN" : "HR");
    if (celebration_is_win) {
      char score[40];
      std::snprintf(score, sizeof(score), "%s %u, %s %u", snapshot.away.abbreviation.c_str(),
                    static_cast<unsigned>(snapshot.away.runs), snapshot.home.abbreviation.c_str(),
                    static_cast<unsigned>(snapshot.home.runs));
      ascii_fold(score, last_celebration.subject, sizeof(last_celebration.subject));
    } else {
      ascii_fold(event.subject.c_str(), last_celebration.subject, sizeof(last_celebration.subject));
    }
    last_celebration.at = wall_epoch();
    last_celebration.moved = settings.motor;
    history_store.putString("kind", last_celebration.kind);
    history_store.putString("subject", last_celebration.subject);
    history_store.putLong64("at", last_celebration.at);
    history_store.putBool("moved", last_celebration.moved);
  }
  Serial.printf("APPLE_LIVE:{\"type\":\"celebration\",\"status\":\"STARTED\",\"kind\":\"%s\","
                "\"subject\":\"%s\",\"eventKey\":\"%s\"}\n",
                celebration_is_win ? "METS_WIN"
                : event.celebration == apple::core::CelebrationKind::GrandSlam ? "GRAND_SLAM"
                                                                               : "HOME_RUN",
                event.subject.c_str(), event.event_key.c_str());
}

void service_celebration() {
  if (!celebration_active) return;
  const std::uint32_t elapsed_ms = now32() - celebration_started_ms;
  const SequenceState state = engine ? engine->sequence_state() : SequenceState::Idle;
  // The picture stays up through the raise and the dwell; it comes down with
  // the Apple, or at once on a fault, and never past the engine's bounds.
  if (state == SequenceState::Idle || state == SequenceState::Retracting ||
      state == SequenceState::Fault || elapsed_ms >= celebration_display_max_ms()) {
    end_celebration(state == SequenceState::Fault ? "FAULT" : "SEQUENCE");
    return;
  }
  const std::uint32_t key = celebration_is_win ? mets_win_loop->render_key(elapsed_ms)
                                               : home_run_loop->render_key(elapsed_ms);
  if (key == celebration_last_key) return;
  celebration_last_key = key;
  const apple::display::DirtyRect dirty =
      celebration_is_win
          ? mets_win_loop->render(elapsed_ms, display.getBuffer(), apple::display::default_mets_win_colors())
          : home_run_loop->render(elapsed_ms, display.getBuffer(), apple::display::default_colors());
  scan_lock->push(display.getBuffer(), kDisplayWidth, dirty);
}

// ---------------------------------------------------------------------------
// Motion

void apply_drive(Drive drive) {
  if (settings.motor) {
    if (drive == Drive::Off) {
      digitalWrite(kMotorEnablePin, LOW);
      digitalWrite(kMotorIn1Pin, LOW);
      digitalWrite(kMotorIn2Pin, LOW);
    } else {
      digitalWrite(kMotorIn1Pin, drive == Drive::Extend ? HIGH : LOW);
      digitalWrite(kMotorIn2Pin, drive == Drive::Retract ? HIGH : LOW);
      digitalWrite(kMotorEnablePin, HIGH);
    }
  } else {
    apple::firmware::disarm_motion_outputs();
  }
  applied_drive = drive;
}

void handle_output(const EngineOutput& output, std::uint64_t now) {
  for (const auto& trace : output.traces) publish_trace(trace.code.c_str(), trace.detail.c_str());
  for (const auto& event : output.events) {
    if (event.type == apple::core::EventType::CelebrationStarted) begin_celebration(event);
  }
  for (const Command& command : output.commands) {
    const Rejection rejection = actuator.accept(command, now);
    Serial.printf("APPLE_LIVE:{\"type\":\"trace\",\"code\":\"COMMAND\",\"detail\":\"%s deadline_ms=%lu required_ms=%lu\"}\n",
                  apple::core::command_type_name(command.type),
                  static_cast<unsigned long>(command.deadline_ms),
                  static_cast<unsigned long>(actuator.required_ms(command.type)));
    if (rejection != Rejection::None) publish_trace("COMMAND_REJECTED", apple::motion::rejection_name(rejection));
  }
}

void service_motion(std::uint64_t now) {
  if (engine) handle_output(engine->tick(now), now);
  const Step step = actuator.tick(now);
  if (step.stall && engine) handle_output(engine->report_motion_fault("MOTOR_STALL", now), now);
  if (step.drive_changed) {
    apply_drive(step.drive);
    publish_trace(step.drive == Drive::Off ? "DRIVE_OFF" : "DRIVE_ON", apple::motion::drive_name(step.drive));
  }
  if (step.report_position && engine) handle_output(engine->report_position(step.position_mm, now), now);
  const SequenceState state = engine ? engine->sequence_state() : SequenceState::Idle;
  if (state != shown_sequence) {
    shown_sequence = state;
    Serial.printf("APPLE_LIVE:{\"type\":\"sequence\",\"state\":\"%s\",\"fault\":%s}\n",
                  apple::core::sequence_state_name(state),
                  engine && engine->fault_latched() ? "true" : "false");
    if (engine && engine->fault_latched()) {
      apply_drive(Drive::Off);
      copy_text(model.waiting_title, sizeof(model.waiting_title), "MOTION DISABLED");
      copy_text(model.waiting_note, sizeof(model.waiting_note), "CHECK THE HARDWARE|THEN RESTART");
      show_waiting("MOTOR STOPPED", apple::firmware::kErrorRed, apple::firmware::WaitingIcon::Alert);
    }
  }
}

bool motion_idle() {
  return !celebration_active && (!engine || engine->sequence_state() == SequenceState::Idle);
}

void stop_motion(const char* reason) {
  const std::uint64_t now = now_ms();
  Command disable;
  disable.type = CommandType::MotionDisable;
  actuator.accept(disable, now);
  actuator.tick(now);
  apply_drive(Drive::Off);
  end_celebration(reason);
  make_engine(replay_active ? static_cast<EventLedger&>(replay_ledger) : static_cast<EventLedger&>(nvs_ledger));
  tracker.reset();
  shown_sequence = SequenceState::Idle;
  publish_trace("STOPPED", reason);
  request_redraw();
}

// ---------------------------------------------------------------------------
// Feed intake shared by the network path and the replay

void accept_feed(ArduinoJson::JsonVariantConst feed, std::int32_t game_number, const char* source) {
  Extraction extraction;
  std::string_view error;
  const FeedTracker::Outcome outcome = tracker.accept(feed, game_number, extraction, error);
  switch (outcome) {
    case FeedTracker::Outcome::Invalid: {
      char detail[64];
      std::snprintf(detail, sizeof(detail), "%.*s", static_cast<int>(error.size()), error.data());
      set_error(detail);
      return;
    }
    case FeedTracker::Outcome::Regressed:
      // A few stale copies from MLB's cache are normal; a run of them means
      // our cursor is ahead of what MLB now serves, so start over. The flash
      // ledger keeps a re-bootstrap from repeating any celebration.
      if (++regressed_in_a_row >= kRegressionsBeforeResync) {
        regressed_in_a_row = 0;
        tracker.reset();
        publish_trace("FEED_RESYNC", source);
      } else {
        publish_trace("FEED_REGRESSED", source);
      }
      return;
    case FeedTracker::Outcome::NoChange:
      regressed_in_a_row = 0;
      return;
    case FeedTracker::Outcome::Frame:
      regressed_in_a_row = 0;
      break;
  }
  if (!projector.replace(extraction.frame)) {
    char detail[64];
    std::snprintf(detail, sizeof(detail), "PROJECTOR %.*s",
                  static_cast<int>(projector.last_error().size()), projector.last_error().data());
    set_error(detail);
    return;
  }
  const GameSnapshot& snapshot = projector.snapshot();
  Serial.printf("APPLE_LIVE:{\"type\":\"frame\",\"source\":\"%s\",\"cursor\":\"%s\",\"phase\":\"%s\","
                "\"label\":\"%s\",\"away\":\"%s\",\"awayRuns\":%ld,\"home\":\"%s\",\"homeRuns\":%ld,"
                "\"inning\":%ld,\"half\":\"%s\",\"changedPlays\":%lu,\"plays\":%lu,\"waitMs\":%lu}\n",
                source, extraction.frame.cursor.c_str(), phase_name(snapshot.phase),
                snapshot.label.c_str(), snapshot.away.abbreviation.c_str(),
                static_cast<long>(snapshot.away.runs), snapshot.home.abbreviation.c_str(),
                static_cast<long>(snapshot.home.runs), static_cast<long>(snapshot.inning),
                half_name(snapshot.half), static_cast<unsigned long>(extraction.frame.changed_plays.size()),
                static_cast<unsigned long>(extraction.play_count),
                static_cast<unsigned long>(extraction.wait_ms));
  const std::uint64_t now = now_ms();
  if (engine) handle_output(engine->ingest(apple::core::to_input_envelope(projector.decision_evidence()), now), now);
  show_snapshot(snapshot);
  if (snapshot.phase == Phase::Final && !final_seen) {
    final_seen = true;
    final_has_game_two = doubleheader_game_two().has_value();
    if (!celebration_active) mark_final_card_visible();
  }
  next_poll_ms = now32() + (snapshot.phase == Phase::Final    ? kFinalPollMs
                            : snapshot.phase == Phase::Pregame ? kPregamePollMs
                                                               : extraction.wait_ms);
}

// ---------------------------------------------------------------------------
// Network

void build_setup_qr() {
  char text[80];
  std::snprintf(text, sizeof(text), "WIFI:T:WPA;S:%s;P:%s;;",
                apple::firmware::ManagerServer::kSetupNetworkName, credentials.setup_key().c_str());
  QRCode qr;
  std::uint8_t buffer[512];
  model.setup_qr_size = 0;
  if (qrcode_initText(&qr, buffer, 3, ECC_LOW, text) != 0 || qr.size > apple::firmware::kSetupQrMaxSize) return;
  for (std::uint8_t y = 0; y < qr.size; ++y) {
    for (std::uint8_t x = 0; x < qr.size; ++x) model.setup_qr[y * qr.size + x] = qrcode_getModule(&qr, x, y) ? 1 : 0;
  }
  model.setup_qr_size = qr.size;
}

void show_setup_screen() {
  copy_text(model.setup_network, sizeof(model.setup_network), apple::firmware::ManagerServer::kSetupNetworkName);
  copy_text(model.setup_key, sizeof(model.setup_key), credentials.setup_key().c_str());
  copy_text(model.setup_url, sizeof(model.setup_url), "http://192.168.4.1");
  if (model.setup_qr_size == 0) build_setup_qr();
  model.state = model.setup_qr_size > 0 ? ScreenState::SetupQr : ScreenState::Setup;
  next_setup_flip_ms = now32() + kSetupScreenFlipMs;
  request_redraw();
}

// While the setup network is open, alternate the QR screen and the typed
// details so both stay large enough to read.
void service_setup_screen() {
  if (model.state != ScreenState::Setup && model.state != ScreenState::SetupQr) return;
  if (model.setup_qr_size == 0 || !due(next_setup_flip_ms)) return;
  next_setup_flip_ms = now32() + kSetupScreenFlipMs;
  model.state = model.state == ScreenState::Setup ? ScreenState::SetupQr : ScreenState::Setup;
  request_redraw();
}

void show_joining_screen() {
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  model.waiting_note[0] = '\0';
  show_waiting("JOINING WI-FI", apple::firmware::kMetsOrange, apple::firmware::WaitingIcon::Wifi);
}

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
  manager.set_admin_code(credentials.setup_key());
  manager.begin(fill_status, on_join_request, on_forget_request, on_settings);
  manager.set_update_hooks(update_gate, on_update_done);
  manager.set_restart_hook(on_restart_request);
  manager.set_release_hooks(on_check_request, on_install_request);
  if (credentials.configured()) {
    begin_station();
    show_joining_screen();
    publish_trace("WIFI", "connecting");
  } else {
    net_state = NetState::NoCredentials;
    open_setup_network("no credentials");
  }
}

// Pushes the chosen zone into the C library and refreshes anything that
// printed a local time: the next-game card and the schedule day window.
void apply_time_zone() {
  setenv("TZ", settings.posix_tz, 1);
  tzset();
  if (game && model.state == ScreenState::Upcoming) show_upcoming(*game);
  if (net_state == NetState::Connected) next_schedule_ms = now32();
  request_redraw();
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
    secure_client.setCACert(apple::firmware::kMlbRootCaPem);
    secure_client.setHandshakeTimeout(kHttpTimeoutMs / 1000);
    secure_client.setTimeout(kHttpTimeoutMs / 1000);
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
}

struct FetchStats {
  int http_status{0};
  std::uint32_t bytes{0};
  std::uint32_t elapsed_ms{0};
};

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
    set_error("HTTP_BEGIN");
    return false;
  }
  http.addHeader("Accept", "application/json");
  esp_task_wdt_reset();
  stats.http_status = http.GET();
  if (stats.http_status != HTTP_CODE_OK) {
    char detail[64];
    if (stats.http_status < 0) {
      char tls[40] = "";
      secure_client.lastError(tls, sizeof(tls));
      std::snprintf(detail, sizeof(detail), "HTTP %d %s", stats.http_status, tls[0] ? tls : http.errorToString(stats.http_status).c_str());
    } else {
      std::snprintf(detail, sizeof(detail), "HTTP_%d", stats.http_status);
    }
    http.end();
    set_error(detail);
    return false;
  }
  stats.bytes = http.getSize() > 0 ? static_cast<std::uint32_t>(http.getSize()) : 0;
  esp_task_wdt_reset();
  const ArduinoJson::DeserializationError error = deserializeJson(
      doc, http.getStream(), ArduinoJson::DeserializationOption::Filter(filter),
      ArduinoJson::DeserializationOption::NestingLimit(apple::mlb_feed::kLiveFeedNestingLimit));
  http.end();
  stats.elapsed_ms = now32() - started;
  if (error != ArduinoJson::DeserializationError::Ok) {
    char detail[48];
    std::snprintf(detail, sizeof(detail), "JSON %s", error.c_str());
    set_error(detail);
    return false;
  }
  if (doc.overflowed()) {
    set_error("JSON_OVERFLOW");
    return false;
  }
  return true;
}

void local_date(int offset_days, char* out, std::size_t capacity) {
  const time_t at = static_cast<time_t>(wall_epoch() + static_cast<std::int64_t>(offset_days) * 86400);
  struct tm local;
  localtime_r(&at, &local);
  strftime(out, capacity, "%Y-%m-%d", &local);
}

// "NEXT CHECK IN N MIN" under the no-game screen, refreshed every minute.
void update_idle_note(bool force) {
  static std::int32_t shown_minutes = -1;
  if (game || model.state != ScreenState::Waiting || std::strcmp(model.status_message, "NO GAME THIS WEEK") != 0) {
    shown_minutes = -1;
    return;
  }
  const std::int32_t remaining_ms = static_cast<std::int32_t>(next_schedule_ms - now32());
  const std::int32_t minutes = remaining_ms <= 0 ? 1 : (remaining_ms + 59'999) / 60'000;
  if (!force && minutes == shown_minutes) return;
  shown_minutes = minutes;
  std::snprintf(model.waiting_note, sizeof(model.waiting_note), "NEXT CHECK IN %ld MIN", static_cast<long>(minutes));
  request_redraw();
}

void follow(const std::optional<ScheduleGame>& chosen) {
  const bool changed = chosen.has_value() != game.has_value() ||
                       (chosen && game && chosen->game_pk != game->game_pk);
  if (chosen && game && !changed) {
    game = chosen;  // refresh state text and start time
  }
  if (!changed) return;
  game = chosen;
  tracker.reset();
  reset_final_tracking();
  poll_backoff_ms = kPollRetryMs;
  next_poll_ms = now32();
  if (!game) {
    // Nothing scheduled from October through February is the offseason (a
    // Mets postseason run keeps games on the schedule, so an empty October
    // means the season is over); the sleeping-Apple card fits better than a
    // weekly countdown.
    const time_t at = static_cast<time_t>(wall_epoch());
    struct tm local;
    localtime_r(&at, &local);
    const int month = local.tm_mon + 1;
    if (clock_valid() && (month >= 10 || month <= 2)) {
      const int next_season = month >= 10 ? local.tm_year + 1901 : local.tm_year + 1900;
      std::snprintf(model.offseason_season, sizeof(model.offseason_season), "%04u SEASON",
                    static_cast<unsigned>(next_season % 10000));
      model.state = ScreenState::Offseason;
      request_redraw();
      publish_trace("SCHEDULE", "no followable game: offseason card");
      return;
    }
    show_waiting("NO GAME THIS WEEK");
    update_idle_note(true);
    publish_trace("SCHEDULE", "no followable game");
    return;
  }
  char detail[96];
  std::snprintf(detail, sizeof(detail), "following %lld %s at %s %s game %ld",
                static_cast<long long>(game->game_pk), game->away.abbreviation.c_str(),
                game->home.abbreviation.c_str(), game->game_date.c_str(),
                static_cast<long>(game->game_number));
  publish_trace("SCHEDULE", detail);
  show_upcoming(*game);
}

void refresh_schedule() {
  next_schedule_ms = now32() + kScheduleRetryMs;
  if (!clock_valid()) {
    publish_trace("SCHEDULE", "waiting for clock");
    return;
  }
  char start[12];
  char end[12];
  local_date(-1, start, sizeof(start));
  local_date(7, end, sizeof(end));
  String url = String(kMlbOrigin) + "/api/v1/schedule?sportId=1&teamId=121&startDate=" + start +
               "&endDate=" + end + "&hydrate=team&fields=" + apple::mlb_feed::schedule_fields();
  JsonDocument doc(&json_allocator);
  FetchStats stats;
  if (!fetch_json(url, doc, apple::mlb_feed::schedule_filter_json(), stats)) {
    ++polls_failed;
    if (!game) {
      copy_text(model.waiting_note, sizeof(model.waiting_note), "RETRYING");
      show_waiting("SCHEDULE UNAVAILABLE", apple::firmware::kDelayYellow);
    }
    return;
  }
  schedule = apple::mlb_feed::parse_schedule(doc.as<JsonVariantConst>());
  char detail[64];
  std::snprintf(detail, sizeof(detail), "%lu games %s..%s in %lu ms",
                static_cast<unsigned long>(schedule.size()), start, end,
                static_cast<unsigned long>(stats.elapsed_ms));
  publish_trace("SCHEDULE", detail);
  next_schedule_ms = now32() + kScheduleRefreshMs;
  schedule_ok_since_boot = true;

  const std::optional<ScheduleGame> game_two = doubleheader_game_two();
  if (final_seen) final_has_game_two = game_two.has_value();

  // The win animation already presents the final score. Keep its static
  // result card briefly before a same-day Game 2; ordinary finals retain the
  // longer between-games hold.
  if (game && final_seen && final_card_visible &&
      !due(final_card_started_ms + final_hold_ms())) {
    for (const ScheduleGame& candidate : schedule) {
      if (candidate.live()) {
        follow(candidate);
        return;
      }
    }
    return;
  }
  if (game && final_seen && game_two) {
    follow(game_two);
    return;
  }
  follow(apple::mlb_feed::choose_game(schedule, wall_epoch()));
}

void poll_feed() {
  if (!game) return;
  if (!apple::mlb_feed::should_poll(*game, wall_epoch(), kPregameLeadSeconds)) {
    next_poll_ms = now32() + kPregamePollMs;
    return;
  }
  String url = String(kMlbOrigin) + "/api/v1.1/game/" + String(static_cast<long long>(game->game_pk)) +
               "/feed/live?fields=" + apple::mlb_feed::live_feed_fields();
  JsonDocument doc(&json_allocator);
  FetchStats stats;
  if (!fetch_json(url, doc, apple::mlb_feed::live_feed_filter_json(), stats)) {
    ++polls_failed;
    next_poll_ms = now32() + poll_backoff_ms;
    poll_backoff_ms = poll_backoff_ms * 2 > kPollRetryMaxMs ? kPollRetryMaxMs : poll_backoff_ms * 2;
    return;
  }
  ++polls_ok;
  poll_backoff_ms = kPollRetryMs;
  last_poll_duration_ms = stats.elapsed_ms;
  last_poll_bytes = stats.bytes;
  last_error[0] = '\0';
  next_poll_ms = now32() + apple::mlb_feed::kMinimumPollWaitMs;
  accept_feed(doc.as<JsonVariantConst>(), game->game_number, "mlb");
}

// ---------------------------------------------------------------------------
// Owner settings

void load_settings() {
  settings_store.begin("settings", false);
  const std::uint16_t raised = settings_store.getUShort("raised", settings.raised_seconds);
  settings.raised_seconds = raised < kRaisedSecondsMin ? kRaisedSecondsMin
                            : raised > kRaisedSecondsMax ? kRaisedSecondsMax
                                                         : raised;
  settings.motor = settings_store.getBool("motor", settings.motor);
  settings.follow = settings_store.getBool("follow", settings.follow);
  settings.sleep_display = settings_store.getBool("sleep", settings.sleep_display);
  settings.require_code = settings_store.getBool("lock", settings.require_code);
  manager.set_code_required(settings.require_code);
  const String zone = settings_store.getString("tz", "");
  if (!set_time_zone(zone.c_str())) set_time_zone(apple::firmware::kDefaultTimeZoneId);
  settings.tz_chosen = settings_store.getBool("tzset", false);
  const std::uint8_t bright = settings_store.getUChar("bright", settings.brightness);
  settings.auto_update = settings_store.getBool("autoupd", settings.auto_update);
  settings.beta = settings_store.getBool("beta", settings.beta);
  settings_store.getString("ghtok", settings.github_token, sizeof(settings.github_token));
  settings.brightness = bright < kBrightnessMin ? kBrightnessMin : bright > 100 ? 100 : bright;
  apply_time_zone();
  history_store.begin("history", false);
  history_store.getString("kind", "").toCharArray(last_celebration.kind, sizeof(last_celebration.kind));
  history_store.getString("subject", "").toCharArray(last_celebration.subject, sizeof(last_celebration.subject));
  last_celebration.at = history_store.getLong64("at", 0);
  last_celebration.moved = history_store.getBool("moved", false);
}

void save_settings() {
  settings_store.putUShort("raised", settings.raised_seconds);
  settings_store.putBool("motor", settings.motor);
  settings_store.putBool("follow", settings.follow);
  settings_store.putBool("sleep", settings.sleep_display);
  settings_store.putBool("lock", settings.require_code);
  settings_store.putString("tz", settings.time_zone);
  settings_store.putBool("tzset", settings.tz_chosen);
  settings_store.putUChar("bright", settings.brightness);
  settings_store.putBool("autoupd", settings.auto_update);
  settings_store.putBool("beta", settings.beta);
  settings_store.putString("ghtok", settings.github_token);
}

// Brightness is a percent; the low end stays visible in a dark room.
std::uint32_t backlight_duty() {
  const std::uint32_t pct = settings.brightness < kBrightnessMin ? kBrightnessMin : settings.brightness;
  return pct >= 100 ? 255 : (pct * pct * 255) / 10000 + 6;  // gentle curve, never fully dark
}

void apply_backlight() { ledcWrite(kBacklightChannel, backlight_on ? backlight_duty() : 0); }

void set_backlight(bool on) {
  if (backlight_on == on) return;
  backlight_on = on;
  apply_backlight();
  publish_trace("BACKLIGHT", on ? "on" : "off");
}

// The screen sleeps only when there is nothing to show: no game to follow,
// nothing being set up or replayed, and following switched on.
// "Between games" means no game in progress: the next-game card, a no-game
// week, or the offseason. Anything else (a live game, a celebration, setup,
// the info screen, a replay, a warning card) keeps the screen on.
void service_backlight() {
  const bool idle_card = model.state == ScreenState::Upcoming || model.state == ScreenState::Offseason ||
                         (model.state == ScreenState::Waiting &&
                          std::strcmp(model.status_message, "NO GAME THIS WEEK") == 0);
  const bool between_games = settings.sleep_display && idle_card && !replay_active &&
                             !manager.setup_network_active() && settings.follow &&
                             net_state == NetState::Connected;
  set_backlight(!between_games);
}

void show_paused_screen() {
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  copy_text(model.waiting_note, sizeof(model.waiting_note), "TURN ON IN THE MANAGER");
  show_waiting("PAUSED");
}

void pause_following() {
  settings.follow = false;
  if (!motion_idle()) stop_motion("PAUSED");
  game.reset();
  tracker.reset();
  reset_final_tracking();
  publish_trace("FOLLOW", "paused");
  show_paused_screen();
}

void resume_following() {
  settings.follow = true;
  tracker.reset();
  reset_final_tracking();
  next_schedule_ms = now32();
  publish_trace("FOLLOW", "auto");
  if (net_state == NetState::Connected) {
    copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
    model.waiting_note[0] = '\0';
    show_waiting("CHECKING SCHEDULE");
  }
}

String on_settings(const apple::firmware::SettingsUpdate& update) {
  if (update.raised_seconds >= 0 &&
      (update.raised_seconds < kRaisedSecondsMin || update.raised_seconds > kRaisedSecondsMax)) {
    return "RAISED_RANGE";
  }
  if (update.raised_seconds >= 0) {
    settings.raised_seconds = static_cast<std::uint16_t>(update.raised_seconds);
    if (engine) engine->set_raised_dwell_ms(static_cast<std::uint64_t>(settings.raised_seconds) * 1000);
  }
  if (update.motor >= 0) {
    settings.motor = update.motor == 1;
    apply_drive(settings.motor ? applied_drive : Drive::Off);
  }
  if (update.follow >= 0 && (update.follow == 1) != settings.follow) {
    if (update.follow == 1) {
      resume_following();
    } else {
      pause_following();
    }
  }
  if (update.sleep >= 0) settings.sleep_display = update.sleep == 1;
  if (update.lock >= 0) {
    settings.require_code = update.lock == 1;
    manager.set_code_required(settings.require_code);
  }
  if (update.brightness >= 0) {
    if (update.brightness < kBrightnessMin || update.brightness > 100) return "BRIGHTNESS_RANGE";
    settings.brightness = static_cast<std::uint8_t>(update.brightness);
    apply_backlight();
  }
  if (update.time_zone.length() > 0) {
    if (!set_time_zone(update.time_zone.c_str())) return "TIME_ZONE";
    settings.tz_chosen = true;
    apply_time_zone();
  }
  if (update.auto_update >= 0) settings.auto_update = update.auto_update == 1;
  if (update.beta >= 0) {
    settings.beta = update.beta == 1;
    release.check_requested = true;  // the answer may change
  }
  if (update.token_given) {
    if (update.github_token.length() >= sizeof(settings.github_token)) return "TOKEN_LENGTH";
    copy_text(settings.github_token, sizeof(settings.github_token), update.github_token.c_str());
    release.check_requested = true;
  }
  save_settings();
  char detail[160];
  std::snprintf(detail, sizeof(detail),
                "raised=%us motor=%s follow=%s sleep=%s lock=%s tz=%s bright=%u auto=%s beta=%s token=%s",
                static_cast<unsigned>(settings.raised_seconds), settings.motor ? "on" : "off",
                settings.follow ? "auto" : "paused", settings.sleep_display ? "on" : "off",
                settings.require_code ? "on" : "off", settings.time_zone,
                static_cast<unsigned>(settings.brightness), settings.auto_update ? "on" : "off",
                settings.beta ? "on" : "off", settings.github_token[0] ? "set" : "none");
  publish_trace("SETTINGS", detail);
  request_redraw();
  return String();
}

// ---------------------------------------------------------------------------
// Wireless firmware updates

// Empty when an update may start now; otherwise a short reason for the page.
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
  boot_guard.putBool("pending", true);
  boot_guard.putString("prev", apple::firmware::running_partition_label());
  boot_guard.putUInt("early", 0);
  publish_trace("UPDATE", "installed; restarting into the new firmware");
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  copy_text(model.waiting_note, sizeof(model.waiting_note), "RESTARTING");
  show_waiting("UPDATING", apple::firmware::kMetsOrange, apple::firmware::WaitingIcon::Update);
  render_if_needed();
  restart_at_ms = now32() + 1500;
}

// Restart from the page, once nothing is moving.
String on_restart_request() {
  if (celebration_active || !motion_idle()) return "CELEBRATING";
  publish_trace("RESET", "restart requested from the manager page");
  restart_at_ms = now32() + 1000;
  return String();
}

// ---------------------------------------------------------------------------
// Releases on GitHub: the Apple checks for itself and installs between games.
//
// The releases list and the signed .bin come from GitHub over TLS pinned to
// the roots in update_roots.hpp. Asset downloads answer with a redirect to a
// separate host, followed by hand so the token never leaves api.github.com.
// A private repository needs the developer token; a public one needs none.

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

// ---------------------------------------------------------------------------
// Owner reset button

void show_info_screen() {
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  const bool connected = WiFi.status() == WL_CONNECTED;
  char note[sizeof(model.waiting_note)];
  std::snprintf(note, sizeof(note), "PASSWORD %s|%s", credentials.setup_key().c_str(),
                connected ? "home-run-apple.local" : "NOT ON WI-FI");
  copy_text(model.waiting_note, sizeof(model.waiting_note), note);
  show_waiting(connected ? WiFi.localIP().toString().c_str() : "SETUP NEEDED");
  info_screen_until_ms = now32() + kInfoScreenMs;
}

void factory_reset() {
  publish_trace("RESET", "button held: clearing Wi-Fi and settings");
  settings_store.clear();
  settings = Settings{};
  save_settings();
  if (engine) engine->set_raised_dwell_ms(static_cast<std::uint64_t>(settings.raised_seconds) * 1000);
  apply_drive(Drive::Off);
  on_forget_request();
}

void service_reset_button() {
  const bool down = digitalRead(kResetButtonPin) == LOW;
  const std::uint32_t now = now32();
  if (down && !button_was_down) {
    button_down_since_ms = now;
    reset_countdown_shown = -1;
  }
  if (down) {
    const std::uint32_t held = now - button_down_since_ms;
    if (held >= kResetShortPressMaxMs) {
      const std::int32_t remaining = static_cast<std::int32_t>((kResetHoldMs - std::min(held, kResetHoldMs) + 999) / 1000);
      if (remaining != reset_countdown_shown) {
        reset_countdown_shown = remaining;
        char status[24];
        std::snprintf(status, sizeof(status), "RESET IN %ld", static_cast<long>(remaining));
        copy_text(model.waiting_title, sizeof(model.waiting_title), "HOLD TO RESET");
        copy_text(model.waiting_note, sizeof(model.waiting_note), "LET GO TO KEEP EVERYTHING");
        show_waiting(status, apple::firmware::kErrorRed, apple::firmware::WaitingIcon::Alert);
      }
      if (held >= kResetHoldMs) {
        button_was_down = false;
        button_down_since_ms = now;
        factory_reset();
        return;
      }
    }
  } else if (button_was_down) {
    const std::uint32_t held = now - button_down_since_ms;
    if (held < kResetShortPressMaxMs) {
      show_info_screen();
    } else {
      // Released early: put the previous screen back.
      info_screen_until_ms = 0;
      if (projector.has_projection()) show_snapshot(projector.snapshot());
      else if (game) show_upcoming(*game);
      else request_redraw();
    }
  }
  button_was_down = down;
  if (info_screen_until_ms != 0 && due(info_screen_until_ms)) {
    info_screen_until_ms = 0;
    if (projector.has_projection()) show_snapshot(projector.snapshot());
    else if (game) show_upcoming(*game);
    else if (manager.setup_network_active()) show_setup_screen();
  }
}

// ---------------------------------------------------------------------------
// Replay of the recorded game, for the bench and for demos without Wi-Fi

void start_replay() {
  if (replay_active) return;
  if (!motion_idle()) {
    publish_trace("REPLAY", "refused: sequence active");
    return;
  }
  replay_active = true;
  replay_step = 0;
  next_replay_ms = now32();
  replay_ledger.clear();
  make_engine(replay_ledger);
  tracker.reset();
  reset_final_tracking();
  ScheduleGame replay_game;
  replay_game.game_pk = kReplayGamePk;
  replay_game.game_number = 1;
  replay_game.game_date = "2026-09-01T22:40:00Z";
  replay_game.abstract_state = "Live";
  replay_game.detailed_state = "In Progress";
  replay_game.venue = "Tropicana Field";
  replay_game.away = {121, "NYM", "New York Mets"};
  replay_game.home = {139, "TB", "Tampa Bay Rays"};
  game = replay_game;
  Serial.println("APPLE_LIVE:{\"type\":\"replay\",\"status\":\"STARTED\"}");
}

void finish_replay(const char* status) {
  if (!replay_active) return;
  replay_active = false;
  Serial.printf("APPLE_LIVE:{\"type\":\"replay\",\"status\":\"%s\"}\n", status);
  make_engine(nvs_ledger);
  tracker.reset();
  projector = apple::game_state::Projector{};  // drop the replay's scoreboard
  game.reset();
  reset_final_tracking();
  next_schedule_ms = now32();
  if (net_state != NetState::Connected) {
    if (manager.setup_network_active()) {
      show_setup_screen();
    } else {
      show_joining_screen();
    }
  }
}

void service_replay() {
  if (!replay_active) return;
  if (replay_step >= sizeof(kReplay) / sizeof(kReplay[0])) {
    if (motion_idle()) finish_replay("COMPLETED");
    return;
  }
  if (!due(next_replay_ms) || !motion_idle()) return;
  const ReplayStep& step = kReplay[replay_step];
  JsonDocument filter;
  deserializeJson(filter, apple::mlb_feed::live_feed_filter_json());
  JsonDocument doc(&json_allocator);
  const ArduinoJson::DeserializationError error =
      deserializeJson(doc, step.feed, ArduinoJson::DeserializationOption::Filter(filter),
                      ArduinoJson::DeserializationOption::NestingLimit(apple::mlb_feed::kLiveFeedNestingLimit));
  if (error != ArduinoJson::DeserializationError::Ok) {
    set_error("REPLAY_JSON");
    finish_replay("FAILED");
    return;
  }
  Serial.printf("APPLE_LIVE:{\"type\":\"replay\",\"status\":\"STEP\",\"name\":\"%s\"}\n", step.name);
  accept_feed(doc.as<JsonVariantConst>(), 1, "replay");
  ++replay_step;
  next_replay_ms = now32() + (replay_step < sizeof(kReplay) / sizeof(kReplay[0]) ? kReplay[replay_step].delay_ms : 0);
}

// ---------------------------------------------------------------------------

void service_network() {
  if (manager.update_in_progress()) return;
  if (replay_active || net_state != NetState::Connected || !settings.follow) return;
  // Network calls block the loop for seconds; never while the Apple moves.
  if (!motion_idle()) return;
  if (game && final_seen && final_card_visible && !final_handoff_requested &&
      due(final_card_started_ms + final_hold_ms())) {
    final_handoff_requested = true;
    next_schedule_ms = now32();
    publish_trace("FINAL_HOLD_COMPLETE",
                  final_has_game_two ? "doubleheader game 2" : "next scheduled game");
  }
  if (due(next_schedule_ms)) {
    refresh_schedule();
    return;
  }
  if (game && due(next_poll_ms)) poll_feed();
}

void handle_serial() {
  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    switch (command) {
      case '?':
        publish_hello();
        publish_status();
        break;
      case 'x':
      case 'X':
        stop_motion("SERIAL_STOP");
        break;
      case 'r':
      case 'R':
        start_replay();
        break;
      case 's':
      case 'S':
        next_schedule_ms = now32();
        break;
      case 'p':
      case 'P':
        next_poll_ms = now32();
        break;
      case 'u':
      case 'U':
        release.check_requested = true;
        break;
      case 'w':
      case 'W':
        on_forget_request();
        break;
      case 'i':
      case 'I':
        show_info_screen();
        break;
      default:
        break;
    }
  }
}

}  // namespace

void setup() {
  apple::firmware::disarm_motion_outputs();
  pinMode(kResetButtonPin, INPUT_PULLUP);

  Serial.begin(115200);
  const std::uint32_t serial_wait_started_ms = millis();
  while (!Serial && millis() - serial_wait_started_ms < kSerialWaitTimeoutMs) delay(10);

  scan_lock = make_in_psram<apple::firmware::ScanLockedPanel>(panel);
  home_run_loop = make_in_psram<apple::display::HomeRunLoop>();
  mets_win_loop = make_in_psram<apple::display::MetsWinLoop>();

  ledcSetup(kBacklightChannel, 5000, 8);
  ledcAttachPin(kDisplayBacklightPin, kBacklightChannel);
  ledcWrite(kBacklightChannel, 0);
  SPI.begin();
  panel.init(240, 320);
  panel.setRotation(1);
  panel.fillScreen(kDarkBlue);
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  model.waiting_note[0] = '\0';
  show_waiting("STARTING");
  render_if_needed();
  nvs_ledger.begin();
  load_settings();
  apply_backlight();
  make_engine(nvs_ledger);
  apply_drive(Drive::Off);

  boot_guard.begin("boot", false);
  const std::uint32_t early_crashes = boot_guard.getUInt("early", 0);
  boot_guard.putUInt("early", early_crashes + 1);
  update_pending_boot = boot_guard.getBool("pending", false);
  if (update_pending_boot && early_crashes >= 2) {
    // The freshly installed firmware crashed twice before settling: boot the
    // previous slot again and forget the update.
    const String previous = boot_guard.getString("prev", "");
    boot_guard.putBool("pending", false);
    boot_guard.putUInt("early", 0);
    update_pending_boot = false;
    if (apple::firmware::boot_from_partition(previous.c_str())) {
      Serial.println("APPLE_LIVE:{\"type\":\"trace\",\"code\":\"UPDATE\",\"detail\":\"new firmware kept crashing; rolling back\"}");
      Serial.flush();
      delay(100);
      ESP.restart();
    }
  }
  safe_mode = early_crashes >= kEarlyCrashLimit;
#ifdef APPLE_UPDATE_CRASH_TEST
  // Build with -DAPPLE_UPDATE_CRASH_TEST to prove the rollback: this image
  // dies on every boot, so the guard must fall back to the previous slot.
  Serial.println("APPLE_LIVE:{\"type\":\"trace\",\"code\":\"BOOT\",\"detail\":\"crash test build: aborting\"}");
  Serial.flush();
  abort();
#endif

  esp_task_wdt_init(kWatchdogSeconds, true);
  esp_task_wdt_add(nullptr);

  credentials.begin();  // so the hello below reports the saved network truthfully
  publish_hello();
  Serial.printf("APPLE_LIVE=READY COMMANDS=?:status x:stop r:replay s:schedule p:poll w:forget_wifi MOTOR=%s\n",
                settings.motor ? "on" : "off");
  if (safe_mode) {
    publish_trace("SAFE_MODE", "repeated early crashes; network and Manager skipped, reflash with pio");
    copy_text(model.waiting_title, sizeof(model.waiting_title), "SAFE MODE");
    copy_text(model.waiting_note, sizeof(model.waiting_note), "REFLASH OVER USB|THEN RESET");
    show_waiting("STARTUP CRASHED", apple::firmware::kErrorRed, apple::firmware::WaitingIcon::Alert);
  } else {
    start_wifi();
  }
  publish_status();
  next_status_ms = now32() + kStatusPeriodMs;
}

void loop() {
  esp_task_wdt_reset();
  const std::uint64_t now = now_ms();
  if (!boot_settled && now >= kBootSettleMs) {
    boot_settled = true;
    // With an unproven firmware, crashes keep counting until it is confirmed.
    if (!update_pending_boot) boot_guard.putUInt("early", 0);
  }
  if (update_pending_boot && boot_settled && (schedule_ok_since_boot || now >= kBootConfirmMaxMs)) {
    update_pending_boot = false;
    boot_guard.putBool("pending", false);
    boot_guard.putUInt("early", 0);
    publish_trace("UPDATE", schedule_ok_since_boot ? "new firmware confirmed: schedule fetched" : "new firmware confirmed");
  }
  if (restart_at_ms != 0 && due(restart_at_ms)) {
    Serial.flush();
    ESP.restart();
  }
  handle_serial();
  service_wifi();
  service_motion(now);
  service_replay();
  service_network();
  service_release();
  if (celebration_active) {
    service_celebration();
  } else {
    render_if_needed();
  }
  service_backlight();
  service_setup_screen();
  service_reset_button();
  update_idle_note(false);
  if (due(next_status_ms)) {
    next_status_ms = now32() + kStatusPeriodMs;
    publish_status();
  }
  delay(manager.setup_network_active() ? 1 : kLoopPeriodMs);
}
