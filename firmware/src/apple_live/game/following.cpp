#include "apple_live/game/following.hpp"

#include "apple_live/display/display.hpp"
#include "apple_live/display/screens.hpp"
#include "apple_live/game/live_feed.hpp"
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

#include "apple/firmware/screens.hpp"

#include <Arduino.h>
#include <ArduinoJson.h>

#include <cstdint>
#include <cstdio>
#include <ctime>

namespace apple::live {

using apple::firmware::ScreenState;
using apple::firmware::copy_text;
using apple::mlb_feed::ScheduleGame;

namespace {

// The schedule is re-read often only around a game, when a postponement,
// a moved start or a doubleheader's Game 2 matters within minutes. The rest
// of the time hourly is plenty: a change noticed within the hour still
// leaves the whole pregame hour before the Apple would start polling.
constexpr std::uint32_t kScheduleRefreshMs = 10 * 60 * 1000;
constexpr std::uint32_t kScheduleRefreshIdleMs = 60 * 60 * 1000;
constexpr std::int64_t kScheduleCloseSeconds = 2 * 60 * 60;
constexpr std::uint32_t kSlowFetchMs = 3000;  // worth a log line even when nothing changed
constexpr std::uint32_t kScheduleRetryMs = 60 * 1000;
constexpr std::uint32_t kStandardFinalHoldMs = 20 * 60 * 1000;
constexpr std::uint32_t kDoubleheaderFinalHoldMs = 10'000;

}  // namespace

std::vector<ScheduleGame> schedule;
std::optional<ScheduleGame> game;
std::uint32_t next_schedule_ms = 0;
// The schedule lookup has its own health; between games it is the only
// thing the Apple fetches, and one hiccup must not read as a feed problem.
std::uint32_t schedule_ok = 0;
std::uint32_t schedule_failed = 0;
std::uint32_t last_schedule_ms = 0;
std::uint32_t last_schedule_ok_ms = 0;
std::uint32_t schedule_refresh_ms = kScheduleRefreshMs;
char last_schedule_error[64] = "";
bool final_seen = false;
bool final_has_game_two = false;

namespace {

std::uint64_t schedule_fingerprint = 0;
std::uint32_t final_card_started_ms = 0;
bool final_card_visible = false;
bool final_handoff_requested = false;

std::uint32_t final_hold_ms() {
  return final_has_game_two ? kDoubleheaderFinalHoldMs : kStandardFinalHoldMs;
}

void local_date(int offset_days, char* out, std::size_t capacity) {
  const time_t at = static_cast<time_t>(wall_epoch() + static_cast<std::int64_t>(offset_days) * 86400);
  struct tm local;
  localtime_r(&at, &local);
  strftime(out, capacity, "%Y-%m-%d", &local);
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
  // The old game's scoreboard would otherwise outlive it: status would keep
  // reporting last night's final beside the next game, and the info screen
  // would hand back to it. The next game's first frame builds a fresh one.
  projector = apple::game_state::Projector{};
  reset_final_tracking();
  poll_failure_streak = 0;
  last_error[0] = '\0';
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

// Every fact the schedule can change under us: which games, when, and their state.
std::uint64_t schedule_digest(const std::vector<ScheduleGame>& games) {
  std::uint64_t hash = 1469598103934665603ULL;
  auto mix = [&hash](const void* data, std::size_t length) {
    const auto* bytes = static_cast<const std::uint8_t*>(data);
    for (std::size_t i = 0; i < length; ++i) hash = (hash ^ bytes[i]) * 1099511628211ULL;
  };
  for (const ScheduleGame& g : games) {
    mix(&g.game_pk, sizeof(g.game_pk));
    mix(&g.game_number, sizeof(g.game_number));
    mix(g.game_date.data(), g.game_date.size());
    mix(g.detailed_state.data(), g.detailed_state.size());
  }
  return hash;
}

// Often around a game, hourly otherwise. Also hourly with nothing to follow.
std::uint32_t schedule_refresh_interval_ms() {
  if (!game) return kScheduleRefreshIdleMs;
  if (game->live() || final_seen) return kScheduleRefreshMs;
  const std::optional<std::int64_t> start = apple::mlb_feed::parse_iso8601_utc(game->game_date);
  if (!start) return kScheduleRefreshMs;
  return *start - wall_epoch() <= kScheduleCloseSeconds ? kScheduleRefreshMs : kScheduleRefreshIdleMs;
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
    ++schedule_failed;
    copy_text(last_schedule_error, sizeof(last_schedule_error), stats.error);
    char detail[160];  // the log keeps the first 80 characters; the serial line keeps it all
    std::snprintf(detail, sizeof(detail), "lookup failed: %s; retry in %lu s", stats.error,
                  static_cast<unsigned long>(kScheduleRetryMs / 1000));
    publish_trace("SCHEDULE", detail);
    if (!game) {
      copy_text(model.waiting_note, sizeof(model.waiting_note), "RETRYING");
      show_waiting("SCHEDULE UNAVAILABLE", apple::firmware::kDelayYellow);
    }
    return;
  }
  schedule = apple::mlb_feed::parse_schedule(doc.as<JsonVariantConst>());
  ++schedule_ok;
  last_schedule_ms = stats.elapsed_ms;
  last_schedule_ok_ms = now32();
  last_schedule_error[0] = '\0';
  const std::uint64_t fingerprint = schedule_digest(schedule);
  const bool changed = fingerprint != schedule_fingerprint;
  if (changed || stats.elapsed_ms >= kSlowFetchMs) {
    char detail[sizeof(TraceEntry::detail)];
    std::snprintf(detail, sizeof(detail), "%lu games %s..%s in %lu ms%s",
                  static_cast<unsigned long>(schedule.size()), start, end,
                  static_cast<unsigned long>(stats.elapsed_ms),
                  !changed ? " (slow)" : schedule_fingerprint == 0 ? "" : " (changed)");
    publish_trace("SCHEDULE", detail);
  }
  schedule_fingerprint = fingerprint;
  note_schedule_fetched();
  // The early returns below are all around a final, where the short interval
  // is right; the ordinary path picks its interval once the game is chosen.
  schedule_refresh_ms = kScheduleRefreshMs;
  next_schedule_ms = now32() + schedule_refresh_ms;

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
  schedule_refresh_ms = schedule_refresh_interval_ms();
  next_schedule_ms = now32() + schedule_refresh_ms;
}

}  // namespace

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

void mark_final_card_visible() {
  if (!final_seen || final_card_visible || model.state != ScreenState::Final)
    return;
  final_card_visible = true;
  final_card_started_ms = now32();
  final_handoff_requested = false;
  next_schedule_ms = now32();
}

void pause_following() {
  settings.follow = false;
  if (active_fixture || !motion_idle()) stop_motion("PAUSED");
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

}  // namespace apple::live
