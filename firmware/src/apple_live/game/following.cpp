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
#include "apple/mlb_feed/season.hpp"

#include <Arduino.h>
#include <ArduinoJson.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
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

using apple::mlb_feed::IdleCard;

std::uint64_t schedule_fingerprint = 0;
std::uint32_t final_card_started_ms = 0;
bool final_card_visible = false;
bool final_handoff_requested = false;

// The card for a week with nothing to follow, once a schedule has said so.
std::optional<IdleCard> idle_card;

// Whether the Mets' season is over, asked of MLB only when a week is empty
// in September or October, and at most hourly. An elimination or a finished
// postseason stands for the rest of the year.
constexpr std::uint32_t kSeasonFactsRefreshMs = 60 * 60 * 1000;
struct SeasonFacts {
  int year{0};
  std::optional<apple::mlb_feed::TeamStanding> standing;
  std::optional<std::uint32_t> standing_checked_ms;
  std::optional<bool> postseason_over;
  std::optional<std::uint32_t> postseason_checked_ms;
};
SeasonFacts season_facts;

std::uint32_t final_hold_ms() {
  return final_has_game_two ? kDoubleheaderFinalHoldMs : kStandardFinalHoldMs;
}

void local_date(int offset_days, char* out, std::size_t capacity) {
  const time_t at = static_cast<time_t>(wall_epoch() + static_cast<std::int64_t>(offset_days) * 86400);
  struct tm local;
  localtime_r(&at, &local);
  strftime(out, capacity, "%Y-%m-%d", &local);
}

struct tm local_now() {
  const time_t at = static_cast<time_t>(wall_epoch());
  struct tm local;
  localtime_r(&at, &local);
  return local;
}

bool season_fact_due(const std::optional<std::uint32_t>& checked_ms) {
  return !checked_ms || due(*checked_ms + kSeasonFactsRefreshMs);
}

void refresh_season_facts(int year) {
  if (season_facts.year != year) {
    season_facts = SeasonFacts{};
    season_facts.year = year;
  }
  const bool eliminated = season_facts.standing && season_facts.standing->eliminated;
  if (!eliminated && season_fact_due(season_facts.standing_checked_ms)) {
    season_facts.standing_checked_ms = now32();
    const String url = String(kMlbOrigin) + "/api/v1/teams/121?season=" + String(year) +
                       "&hydrate=standings&fields=" + apple::mlb_feed::team_standing_fields();
    JsonDocument doc(&json_allocator);
    FetchStats stats;
    if (fetch_json(url, doc, apple::mlb_feed::team_standing_filter_json(), stats)) {
      if (const auto standing = apple::mlb_feed::parse_team_standing(doc.as<JsonVariantConst>())) {
        season_facts.standing = standing;
        publish_trace("SEASON", standing->eliminated ? "standing: eliminated"
                                : standing->clinched ? "standing: clinched"
                                                     : "standing: in the race");
      }
    } else {
      char detail[96];
      std::snprintf(detail, sizeof(detail), "standing lookup failed: %s", stats.error);
      publish_trace("SEASON", detail);
    }
  }
  if (!season_facts.standing || !season_facts.standing->clinched || season_facts.postseason_over.value_or(false) ||
      !season_fact_due(season_facts.postseason_checked_ms))
    return;
  season_facts.postseason_checked_ms = now32();
  const String url = String(kMlbOrigin) + "/api/v1/schedule?sportId=1&teamId=121&season=" + String(year) +
                     "&gameType=F,D,L,W&hydrate=team,seriesStatus&fields=" + apple::mlb_feed::schedule_fields();
  JsonDocument doc(&json_allocator);
  FetchStats stats;
  if (!fetch_json(url, doc, apple::mlb_feed::schedule_filter_json(), stats)) {
    char detail[96];
    std::snprintf(detail, sizeof(detail), "postseason lookup failed: %s", stats.error);
    publish_trace("SEASON", detail);
    return;
  }
  season_facts.postseason_over =
      apple::mlb_feed::postseason_run_over(apple::mlb_feed::parse_schedule(doc.as<JsonVariantConst>()));
  publish_trace("SEASON", *season_facts.postseason_over ? "postseason: over" : "postseason: still going");
}

IdleCard decide_idle_card() {
  const struct tm local = local_now();
  const int month = local.tm_mon + 1;
  if (apple::mlb_feed::season_facts_needed(month)) refresh_season_facts(local.tm_year + 1900);
  return apple::mlb_feed::idle_card(month, season_facts.standing, season_facts.postseason_over);
}

const char* idle_card_name(IdleCard card) {
  switch (card) {
    case IdleCard::Offseason: return "offseason card";
    case IdleCard::NextGameTbd: return "next game TBD";
    case IdleCard::NoGameThisWeek:
    default: return "no game this week";
  }
}

void show_idle(IdleCard card) {
  if (!idle_card || *idle_card != card) {
    char detail[64];
    std::snprintf(detail, sizeof(detail), "no followable game: %s", idle_card_name(card));
    publish_trace("SCHEDULE", detail);
  }
  idle_card = card;
  // The info and setup screens hand back through restore_default_screen,
  // which paints the card then.
  if (model.state == ScreenState::Info || model.state == ScreenState::Setup ||
      model.state == ScreenState::SetupQr)
    return;
  show_idle_card();
}

// A change the upcoming card shows: a start time set or moved, or the round.
bool upcoming_card_differs(const ScheduleGame& shown, const ScheduleGame& latest) {
  return shown.game_date != latest.game_date || shown.start_time_tbd != latest.start_time_tbd ||
         shown.official_date != latest.official_date || shown.game_type != latest.game_type ||
         shown.series_game_number != latest.series_game_number;
}

void follow(const std::optional<ScheduleGame>& chosen) {
  const bool changed = chosen.has_value() != game.has_value() ||
                       (chosen && game && chosen->game_pk != game->game_pk);
  if (chosen && game && !changed) {
    const bool redraw = upcoming_card_differs(*game, *chosen);
    game = chosen;  // refresh state text and start time
    if (redraw && model.state == ScreenState::Upcoming && !projector.has_projection()) show_upcoming(*game);
    return;
  }
  if (changed) {
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
  }
  if (!game) {
    // Every empty schedule decides the card again, not only the first after
    // a game: after a restart or a lost connection the screen still shows
    // the startup card, and an empty week can become the offseason.
    show_idle(decide_idle_card());
    return;
  }
  idle_card.reset();
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

bool show_idle_card() {
  if (!idle_card || game) return false;
  if (*idle_card == IdleCard::Offseason) {
    const struct tm local = local_now();
    char season[sizeof(model.offseason_season)];
    std::snprintf(season, sizeof(season), "%04d SEASON",
                  apple::mlb_feed::next_season_year(local.tm_year + 1900, local.tm_mon + 1));
    if (model.state != ScreenState::Offseason || std::strcmp(season, model.offseason_season) != 0) {
      copy_text(model.offseason_season, sizeof(model.offseason_season), season);
      model.state = ScreenState::Offseason;
      request_redraw();
    }
    return true;
  }
  const char* status = *idle_card == IdleCard::NextGameTbd ? kNextGameTbd : kNoGameThisWeek;
  if (model.state != ScreenState::Waiting || std::strcmp(model.status_message, status) != 0) {
    copy_text(model.waiting_title, sizeof(model.waiting_title), "HOME RUN APPLE");
    show_waiting(status);
  }
  update_idle_note(true);
  return true;
}

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
