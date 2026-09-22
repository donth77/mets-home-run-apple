#include "apple_live/display/screens.hpp"

#include "apple_live/display/display.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/live_feed.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/net/manager_hooks.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/settings.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/text.hpp"

#include "apple/firmware/manager.hpp"

#include <Arduino.h>
#include <WiFi.h>
#include <qrcode.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>

namespace apple::live {

using apple::firmware::FinalScreen;
using apple::firmware::GameScreen;
using apple::firmware::ScreenState;
using apple::firmware::copy_text;
using apple::game_state::GameSnapshot;
using apple::game_state::Half;
using apple::game_state::Phase;
using apple::mlb_feed::ScheduleGame;

namespace {

// The setup display alternates between the QR code and the typed details.
constexpr std::uint32_t kSetupScreenFlipMs = 10'000;
std::uint32_t next_setup_flip_ms = 0;

void show_snapshot_as_is(const GameSnapshot& snapshot) {
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

}  // namespace

void show_waiting(const char* status, std::uint16_t accent,
                  apple::firmware::WaitingIcon icon) {
  model.state = ScreenState::Waiting;
  model.waiting_accent = accent;
  model.waiting_icon = icon;
  model.status_color = 0xFFFF;
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
  if (replay_active && replay_score.active) {
    show_snapshot_as_is(with_replay_score(snapshot));
    return;
  }
  show_snapshot_as_is(snapshot);
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

// Draw whatever screen the live state calls for. A temporary overlay — the
// info screen, or a cancelled reset countdown — ends by calling this, so the
// panel is never stranded on the overlay. Mirrors the main-loop precedence so
// every state (including "no game yet, still syncing") lands somewhere valid.
void restore_default_screen() {
  if (projector.has_projection()) { show_snapshot(projector.snapshot()); return; }
  if (!settings.follow) { show_paused_screen(); return; }
  if (game.has_value()) { show_upcoming(*game); return; }
  if (manager.setup_network_active()) { show_setup_screen(); return; }
  copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
  if (WiFi.status() != WL_CONNECTED) {
    copy_text(model.waiting_note, sizeof(model.waiting_note), "RETRYING");
    show_waiting("WI-FI LOST", apple::firmware::kDelayYellow, apple::firmware::WaitingIcon::WifiLost);
  } else if (!clock_valid()) {
    model.waiting_note[0] = '\0';
    show_waiting("SYNCING CLOCK", apple::firmware::kMetsOrange, apple::firmware::WaitingIcon::Clock);
  } else {
    model.waiting_note[0] = '\0';
    show_waiting("WAITING FOR LIVE DATA");
  }
}

}  // namespace apple::live
