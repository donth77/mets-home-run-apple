// Pushes recorded MLB feeds through the portable feed adapter, the game-state
// projector, and the decision core. The captures under fixtures/mlb are the
// field-limited responses the Nano receives: the Mets at Rays game on
// 2026-09-01 (Lindor homered in the first; the Rays won 6-2) and the Mets at
// Phillies game on 2026-07-18 at the moment a 45-minute rain delay began and
// the moment play resumed.

#include "apple/core/engine.hpp"
#include "apple/core/evidence_bridge.hpp"
#include "apple/game_state/projector.hpp"
#include "apple/mlb_feed/feed.hpp"
#include "apple/mlb_feed/schedule.hpp"
#include "apple/mlb_feed/season.hpp"
#include "fixtures.hpp"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <string>

namespace {

using apple::game_state::CanonicalFrame;
using apple::game_state::Half;
using apple::game_state::Phase;
using apple::game_state::PlayKind;
using apple::game_state::UpdateMode;
using apple::mlb_feed::Extraction;
using apple::mlb_feed::FeedTracker;
using apple::mlb_feed::PlayFingerprints;

[[noreturn]] void fail(const std::string &message, int line) {
  std::cerr << "FAIL line " << line << ": " << message << '\n';
  std::exit(1);
}

#define EXPECT_TRUE(value)                                                     \
  do {                                                                         \
    if (!(value))                                                              \
      fail("expected true: " #value, __LINE__);                                \
  } while (false)

#define EXPECT_EQ(actual, expected)                                            \
  do {                                                                         \
    const auto actual_value = (actual);                                        \
    const auto expected_value = (expected);                                    \
    if (!(actual_value == expected_value)) {                                   \
      std::ostringstream stream;                                               \
      stream << "values differ: " #actual " != " #expected " (" << actual_value \
             << " vs " << expected_value << ")";                               \
      fail(stream.str(), __LINE__);                                            \
    }                                                                          \
  } while (false)

std::ostream &operator<<(std::ostream &out, Phase phase) {
  return out << static_cast<int>(phase);
}
std::ostream &operator<<(std::ostream &out, Half half) {
  return out << static_cast<int>(half);
}
std::ostream &operator<<(std::ostream &out, PlayKind kind) {
  return out << static_cast<int>(kind);
}
std::ostream &operator<<(std::ostream &out, FeedTracker::Outcome outcome) {
  return out << static_cast<int>(outcome);
}
std::ostream &operator<<(std::ostream &out, apple::core::SequenceState state) {
  return out << apple::core::sequence_state_name(state);
}

JsonDocument parse_feed(const char *text, bool filtered = true) {
  JsonDocument doc;
  ArduinoJson::DeserializationError error;
  if (filtered) {
    JsonDocument filter;
    EXPECT_TRUE(deserializeJson(filter, apple::mlb_feed::live_feed_filter_json()) ==
                ArduinoJson::DeserializationError::Ok);
    error = deserializeJson(
        doc, text, ArduinoJson::DeserializationOption::Filter(filter),
        ArduinoJson::DeserializationOption::NestingLimit(apple::mlb_feed::kLiveFeedNestingLimit));
  } else {
    error = deserializeJson(
        doc, text,
        ArduinoJson::DeserializationOption::NestingLimit(apple::mlb_feed::kLiveFeedNestingLimit));
  }
  if (error != ArduinoJson::DeserializationError::Ok)
    fail(std::string("parse failed: ") + error.c_str(), __LINE__);
  EXPECT_TRUE(!doc.overflowed());
  return doc;
}

Extraction extract(const JsonDocument &doc, UpdateMode mode, PlayFingerprints &fingerprints) {
  Extraction out;
  const std::string_view error =
      apple::mlb_feed::extract_frame(doc.as<JsonVariantConst>(), 1, mode, fingerprints, out);
  if (!error.empty())
    fail(std::string("extract failed: ") + std::string(error), __LINE__);
  return out;
}

bool same_frame(const CanonicalFrame &a, const CanonicalFrame &b) {
  PlayFingerprints empty;
  return apple::mlb_feed::state_fingerprint(a, empty) ==
             apple::mlb_feed::state_fingerprint(b, empty) &&
         a.changed_plays.size() == b.changed_plays.size() && a.cursor == b.cursor &&
         a.game_pk == b.game_pk && a.evidence_outs == b.evidence_outs;
}

class MemoryLedger final : public apple::core::EventLedger {
public:
  apple::core::LedgerLookup lookup(std::string_view key) const override {
    return keys_.count(std::string(key)) ? apple::core::LedgerLookup::Present
                                         : apple::core::LedgerLookup::Missing;
  }
  bool persist(std::string_view key) override {
    keys_.insert(std::string(key));
    return true;
  }

private:
  std::set<std::string> keys_;
};

void test_iso8601() {
  EXPECT_EQ(apple::mlb_feed::parse_iso8601_utc("1970-01-01T00:00:00Z").value_or(-1), 0);
  EXPECT_EQ(apple::mlb_feed::parse_iso8601_utc("2000-03-01T00:00:00Z").value_or(-1), 951868800);
  EXPECT_EQ(apple::mlb_feed::parse_iso8601_utc("2026-09-02T22:40:00Z").value_or(-1),
            1788388800);
  EXPECT_EQ(apple::mlb_feed::parse_iso8601_utc("2026-09-02T22:40:00.250Z").value_or(-1),
            1788388800);
  EXPECT_TRUE(!apple::mlb_feed::parse_iso8601_utc("2026-09-02 22:40:00"));
  EXPECT_TRUE(!apple::mlb_feed::parse_iso8601_utc("2026-13-02T22:40:00Z"));
  EXPECT_TRUE(!apple::mlb_feed::parse_iso8601_utc(""));
}

void test_schedule() {
  JsonDocument filter;
  EXPECT_TRUE(deserializeJson(filter, apple::mlb_feed::schedule_filter_json()) ==
              ArduinoJson::DeserializationError::Ok);
  JsonDocument doc;
  EXPECT_TRUE(deserializeJson(doc, apple::fixtures::mlb::k_schedule_20260830_20260903,
                              ArduinoJson::DeserializationOption::Filter(filter)) ==
              ArduinoJson::DeserializationError::Ok);
  auto games = apple::mlb_feed::parse_schedule(doc.as<JsonVariantConst>());
  EXPECT_EQ(games.size(), static_cast<std::size_t>(4));
  const auto &today = games.back();
  EXPECT_EQ(today.game_pk, 822931);
  EXPECT_EQ(today.game_number, 1);
  EXPECT_EQ(today.official_date, std::string("2026-09-02"));
  EXPECT_EQ(today.game_date, std::string("2026-09-02T22:40:00Z"));
  EXPECT_EQ(today.abstract_state, std::string("Preview"));
  EXPECT_EQ(today.away.id, 121);
  EXPECT_EQ(today.away.abbreviation, std::string("NYM"));
  EXPECT_EQ(today.home.id, 139);
  EXPECT_EQ(today.home.name, std::string("Tampa Bay Rays"));
  EXPECT_EQ(today.venue, std::string("Tropicana Field"));
  EXPECT_TRUE(games.front().finished());
  EXPECT_TRUE(!today.finished() && !today.live() && today.followable());

  const std::int64_t afternoon = 1788379200; // 2026-09-02T20:00:00Z
  auto chosen = apple::mlb_feed::choose_game(games, afternoon);
  EXPECT_TRUE(chosen.has_value());
  EXPECT_EQ(chosen->game_pk, 822931);
  EXPECT_TRUE(!apple::mlb_feed::should_poll(*chosen, afternoon, 3600));
  EXPECT_TRUE(apple::mlb_feed::should_poll(*chosen, 1788388800 - 3000, 3600));
  EXPECT_TRUE(apple::mlb_feed::should_poll(*chosen, 1788388800 + 3000, 3600));

  // A live game wins over the next scheduled one.
  games.front().abstract_state = "Live";
  chosen = apple::mlb_feed::choose_game(games, afternoon);
  EXPECT_EQ(chosen->game_pk, 823580);
  EXPECT_TRUE(apple::mlb_feed::should_poll(*chosen, afternoon, 0));

  // Nothing left once everything is final, and postponed games are skipped.
  games.front().abstract_state = "Final";
  games.back().detailed_state = "Postponed";
  EXPECT_TRUE(!apple::mlb_feed::choose_game(games, afternoon).has_value());
  games.back().detailed_state = "Scheduled";
  // Stale schedule data: a game that should have started long ago is skipped.
  EXPECT_TRUE(!apple::mlb_feed::choose_game(games, 1788388800 + 7 * 3600).has_value());
}

void test_doubleheader_game_two_selection() {
  apple::mlb_feed::ScheduleGame game_one;
  game_one.game_pk = 900001;
  game_one.game_number = 1;
  game_one.official_date = "2026-09-02";
  game_one.game_date = "2026-09-02T17:10:00Z";
  game_one.abstract_state = "Final";
  game_one.detailed_state = "Final";
  game_one.away = {121, "NYM", "New York Mets"};
  game_one.home = {144, "ATL", "Atlanta Braves"};

  apple::mlb_feed::ScheduleGame game_two = game_one;
  game_two.game_pk = 900002;
  game_two.game_number = 2;
  game_two.game_date = "2026-09-02T23:10:00Z";
  game_two.abstract_state = "Preview";
  game_two.detailed_state = "Scheduled";

  const auto selected = apple::mlb_feed::choose_doubleheader_game_two(
      {game_one, game_two}, game_one);
  EXPECT_TRUE(selected.has_value());
  EXPECT_EQ(selected->game_pk, game_two.game_pk);

  game_two.home.id = 143;
  EXPECT_TRUE(!apple::mlb_feed::choose_doubleheader_game_two(
                   {game_one, game_two}, game_one)
                   .has_value());
  game_two.home.id = game_one.home.id;
  game_two.official_date = "2026-09-03";
  game_two.game_date = "2026-09-03T12:10:00Z";
  EXPECT_TRUE(!apple::mlb_feed::choose_doubleheader_game_two(
                   {game_one, game_two}, game_one)
                   .has_value());
}

std::vector<apple::mlb_feed::ScheduleGame> schedule_capture(const char *json) {
  JsonDocument filter;
  EXPECT_TRUE(deserializeJson(filter, apple::mlb_feed::schedule_filter_json()) ==
              ArduinoJson::DeserializationError::Ok);
  JsonDocument doc;
  EXPECT_TRUE(deserializeJson(doc, json, ArduinoJson::DeserializationOption::Filter(filter)) ==
              ArduinoJson::DeserializationError::Ok);
  return apple::mlb_feed::parse_schedule(doc.as<JsonVariantConst>());
}

// 2026-03-13 was a split-squad day: the Mets at Washington at 6:05 PM and
// Miami at Clover Park at 6:10 PM. The Apple follows the home game.
void test_spring_training_and_split_squads() {
  using apple::mlb_feed::choose_game;
  using apple::mlb_feed::game_label;
  using apple::mlb_feed::yields_to_home_split_squad;
  auto games = schedule_capture(apple::fixtures::mlb::k_schedule_20260312_20260314);
  EXPECT_EQ(games.size(), static_cast<std::size_t>(4));
  for (const auto &game : games) {
    EXPECT_EQ(game.game_type, std::string("S"));
    EXPECT_TRUE(game.spring() && !game.postseason());
    EXPECT_EQ(game_label(game), std::string("SPRING TRAINING"));
    EXPECT_TRUE(!game.start_time_tbd);
  }
  EXPECT_EQ(games[1].game_pk, 831464);  // at Washington
  EXPECT_EQ(games[2].game_pk, 831462);  // Miami at Clover Park
  EXPECT_TRUE(yields_to_home_split_squad(games[1], games));
  EXPECT_TRUE(!yields_to_home_split_squad(games[2], games));
  EXPECT_TRUE(!yields_to_home_split_squad(games[0], games));  // no home game on the 12th

  for (auto &game : games) {
    game.abstract_state = "Preview";
    game.detailed_state = "Scheduled";
  }
  games[0].abstract_state = "Final";
  const std::int64_t afternoon = apple::mlb_feed::parse_iso8601_utc("2026-03-13T21:00:00Z").value_or(0);
  EXPECT_EQ(choose_game(games, afternoon)->game_pk, 831462);
  // The road game going live first does not pull the Apple away.
  games[1].abstract_state = "Live";
  EXPECT_EQ(choose_game(games, afternoon + 3600)->game_pk, 831462);
  // A rained-out home game leaves the day to the road game.
  games[2].detailed_state = "Postponed";
  EXPECT_EQ(choose_game(games, afternoon + 3600)->game_pk, 831464);
  games[2].detailed_state = "Scheduled";
  // The same club twice in a day is a doubleheader, not a split squad.
  games[1].home = games[2].away;
  EXPECT_TRUE(!yields_to_home_split_squad(games[1], games));
  // Only spring games split squads; a regular season road game is followed.
  games[1].home = {120, "WSH", "Washington Nationals"};
  games[1].game_type = "R";
  EXPECT_TRUE(!yields_to_home_split_squad(games[1], games));
}

// The Mets' 2024 postseason: they won the Wild Card Series at Milwaukee and
// the NLDS against the Phillies, then lost the NLCS to the Dodgers in six.
void test_postseason_labels_and_run() {
  using apple::mlb_feed::game_label;
  using apple::mlb_feed::postseason_run_over;
  using apple::mlb_feed::ScheduleGame;
  const auto games = schedule_capture(apple::fixtures::mlb::k_postseason_2024);
  EXPECT_EQ(games.size(), static_cast<std::size_t>(13));
  EXPECT_EQ(game_label(games[0]), std::string("WILD CARD GAME 1"));
  EXPECT_EQ(game_label(games[3]), std::string("NLDS GAME 1"));
  EXPECT_EQ(game_label(games[7]), std::string("NLCS GAME 1"));
  EXPECT_EQ(game_label(games.back()), std::string("NLCS GAME 6"));
  EXPECT_TRUE(games.back().postseason() && !games.back().spring());
  EXPECT_TRUE(games.back().series_status.present && games.back().series_status.is_over);
  EXPECT_EQ(games.back().series_status.winning_team_id, 119);
  EXPECT_EQ(games.back().series_status.losing_team_id, 121);

  EXPECT_TRUE(postseason_run_over(games));
  EXPECT_TRUE(!postseason_run_over({}));
  // Mid-series, and after winning a round, the run goes on.
  EXPECT_TRUE(!postseason_run_over({games.begin(), games.begin() + 2}));
  EXPECT_TRUE(!postseason_run_over({games.begin(), games.begin() + 7}));
  // Winning the World Series ends it as well.
  ScheduleGame clincher = games.back();
  clincher.game_type = "W";
  clincher.series_status.winning_team_id = 121;
  clincher.series_status.losing_team_id = 147;
  EXPECT_EQ(game_label(clincher), std::string("WORLD SERIES GAME 6"));
  EXPECT_TRUE(postseason_run_over({clincher}));

  ScheduleGame other = games[3];
  other.series_description = "AL Division Series";
  EXPECT_EQ(game_label(other), std::string("ALDS GAME 1"));
  other.game_type = "E";
  EXPECT_EQ(game_label(other), std::string("EXHIBITION"));
  EXPECT_TRUE(other.spring());
  other.game_type = "R";
  EXPECT_EQ(game_label(other), std::string());
}

// Until MLB sets a start time it lists the game at 3:33 AM Eastern.
void test_start_time_tbd() {
  const auto games = schedule_capture(apple::fixtures::mlb::k_schedule_20270218_20270222);
  EXPECT_TRUE(!games.empty());
  EXPECT_EQ(games.front().game_pk, 868574);
  EXPECT_EQ(games.front().official_date, std::string("2027-02-19"));
  EXPECT_EQ(games.front().game_date, std::string("2027-02-19T08:33:00Z"));
  EXPECT_TRUE(games.front().start_time_tbd);
  EXPECT_EQ(apple::mlb_feed::game_label(games.front()), std::string("SPRING TRAINING"));
}

void test_season_over() {
  using apple::mlb_feed::IdleCard;
  using apple::mlb_feed::idle_card;
  using apple::mlb_feed::next_season_year;
  using apple::mlb_feed::TeamStanding;
  const auto standing = [](const char *json) {
    JsonDocument filter;
    EXPECT_TRUE(deserializeJson(filter, apple::mlb_feed::team_standing_filter_json()) ==
                ArduinoJson::DeserializationError::Ok);
    JsonDocument doc;
    EXPECT_TRUE(deserializeJson(doc, json, ArduinoJson::DeserializationOption::Filter(filter)) ==
                ArduinoJson::DeserializationError::Ok);
    return apple::mlb_feed::parse_team_standing(doc.as<JsonVariantConst>());
  };
  // 2026: 74-88, out of both races. 2024: a wild card.
  const auto eliminated = standing(apple::fixtures::mlb::k_team_standing_2026);
  EXPECT_TRUE(eliminated.has_value() && eliminated->eliminated && !eliminated->clinched);
  const auto clinched = standing(apple::fixtures::mlb::k_team_standing_2024);
  EXPECT_TRUE(clinched.has_value() && clinched->clinched && !clinched->eliminated);
  EXPECT_TRUE(!standing(R"({"teams":[{"id":121}]})").has_value());

  // The 2026 finale, 2026-09-27: the Mets' last game over and no week ahead.
  EXPECT_TRUE(idle_card(9, eliminated, std::nullopt) == IdleCard::Offseason);
  EXPECT_TRUE(idle_card(10, eliminated, std::nullopt) == IdleCard::Offseason);
  const std::optional<TeamStanding> racing = TeamStanding{};
  EXPECT_TRUE(idle_card(9, racing, std::nullopt) == IdleCard::NoGameThisWeek);
  EXPECT_TRUE(idle_card(9, std::nullopt, std::nullopt) == IdleCard::NoGameThisWeek);
  // A clinched club is waiting on its next round until its run is over.
  EXPECT_TRUE(idle_card(10, clinched, std::nullopt) == IdleCard::NextGameTbd);
  EXPECT_TRUE(idle_card(10, clinched, false) == IdleCard::NextGameTbd);
  EXPECT_TRUE(idle_card(10, clinched, true) == IdleCard::Offseason);
  // November through February is the offseason whatever the standing says,
  // and March through August never is.
  for (const int month : {11, 12, 1, 2})
    EXPECT_TRUE(idle_card(month, std::nullopt, std::nullopt) == IdleCard::Offseason);
  for (const int month : {3, 5, 8})
    EXPECT_TRUE(idle_card(month, eliminated, true) == IdleCard::NoGameThisWeek);
  EXPECT_TRUE(apple::mlb_feed::season_facts_needed(9) && apple::mlb_feed::season_facts_needed(10));
  EXPECT_TRUE(!apple::mlb_feed::season_facts_needed(11) && !apple::mlb_feed::season_facts_needed(8));

  EXPECT_EQ(next_season_year(2026, 9), 2027);
  EXPECT_EQ(next_season_year(2026, 12), 2027);
  EXPECT_EQ(next_season_year(2027, 1), 2027);
  EXPECT_EQ(next_season_year(2027, 2), 2027);
}

void test_pregame() {
  JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_pregame);
  PlayFingerprints fingerprints;
  const Extraction out = extract(doc, UpdateMode::Bootstrap, fingerprints);
  const CanonicalFrame &frame = out.frame;
  EXPECT_EQ(frame.game_pk, 822929);
  EXPECT_EQ(frame.cursor, std::string("20260901_193547"));
  EXPECT_EQ(frame.phase, Phase::Pregame);
  EXPECT_EQ(frame.label, std::string("Pre-Game"));
  EXPECT_EQ(frame.away.id, 121);
  EXPECT_EQ(frame.away.abbreviation, std::string("NYM"));
  EXPECT_EQ(frame.away.name, std::string("Mets"));
  EXPECT_EQ(frame.home.id, 139);
  EXPECT_EQ(frame.home.abbreviation, std::string("TB"));
  EXPECT_EQ(frame.home.name, std::string("Rays"));
  EXPECT_EQ(frame.away.runs, 0);
  EXPECT_EQ(frame.home.runs, 0);
  EXPECT_EQ(frame.scheduled_start.value_or(""), std::string("2026-09-01T22:40:00Z"));
  EXPECT_EQ(frame.venue.value_or(""), std::string("Tropicana Field"));
  EXPECT_TRUE(!frame.at_bat.has_value());
  EXPECT_EQ(frame.display_outs, 0);
  EXPECT_EQ(out.wait_ms, 10'000U);
  EXPECT_EQ(frame.changed_plays.size(), out.play_count);
  for (const auto &play : frame.changed_plays)
    EXPECT_EQ(play.kind, PlayKind::Other);
}

void test_home_run_bootstrap() {
  JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_hr);
  PlayFingerprints fingerprints;
  const Extraction out = extract(doc, UpdateMode::Bootstrap, fingerprints);
  const CanonicalFrame &frame = out.frame;
  EXPECT_EQ(frame.phase, Phase::Live);
  EXPECT_EQ(frame.label, std::string("LIVE"));
  EXPECT_EQ(frame.inning, 1);
  EXPECT_EQ(frame.half, Half::Top);
  EXPECT_EQ(frame.away.runs, 1);
  EXPECT_EQ(frame.home.runs, 0);
  EXPECT_TRUE(frame.last_event.find("Lindor") != std::string::npos);
  bool found = false;
  for (const auto &play : frame.changed_plays) {
    if (play.kind != PlayKind::HomeRun)
      continue;
    found = true;
    EXPECT_EQ(play.batter_name, std::string("Francisco Lindor"));
    EXPECT_EQ(play.batting_team_id, 121);
    EXPECT_EQ(play.at_bat_index, 0);
    EXPECT_TRUE(play.complete);
    EXPECT_EQ(play.event_key.rfind("822929:", 0), static_cast<std::size_t>(0));
    EXPECT_TRUE(play.event_key.find("atbat-") == std::string::npos);
  }
  EXPECT_TRUE(found);
  EXPECT_TRUE(frame.at_bat.has_value());
  EXPECT_TRUE(frame.linescore.innings.size() >= 1);
  EXPECT_EQ(frame.linescore.innings.front().away.value_or(-1), 1);
  EXPECT_TRUE(!frame.linescore.innings.front().home.has_value());
}

void test_live_situation() {
  JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_live_mid);
  PlayFingerprints fingerprints;
  const Extraction out = extract(doc, UpdateMode::Bootstrap, fingerprints);
  const CanonicalFrame &frame = out.frame;
  EXPECT_EQ(frame.phase, Phase::Live);
  EXPECT_EQ(frame.inning, 4);
  EXPECT_EQ(frame.half, Half::Bottom);
  EXPECT_EQ(frame.away.runs, 1);
  EXPECT_EQ(frame.home.runs, 2);
  EXPECT_TRUE(frame.at_bat.has_value());
  EXPECT_TRUE(frame.at_bat->batter.has_value());
  EXPECT_TRUE(frame.at_bat->pitcher.has_value());
  EXPECT_TRUE(frame.at_bat->pitch_count.value_or(0) > 0);
  EXPECT_TRUE(frame.at_bat->batter_line.has_value());
  EXPECT_TRUE(frame.display_outs >= 0 && frame.display_outs <= 3);
  EXPECT_EQ(frame.linescore.innings.size(), static_cast<std::size_t>(4));
  EXPECT_EQ(out.play_count, static_cast<std::size_t>(31));
}

void test_inning_changeovers_and_status_lag() {
  {
    JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_live_mid);
    doc["liveData"]["linescore"]["currentInning"] = 4;
    doc["liveData"]["linescore"]["inningHalf"] = "Bottom";
    doc["liveData"]["linescore"]["inningState"] = "End";
    doc["liveData"]["linescore"]["outs"] = 3;
    PlayFingerprints fingerprints;
    const CanonicalFrame &frame = extract(doc, UpdateMode::Incremental, fingerprints).frame;
    EXPECT_EQ(frame.phase, Phase::Live);
    EXPECT_EQ(frame.inning, 4);
    EXPECT_EQ(frame.half, Half::End);
    EXPECT_EQ(frame.label, std::string("LIVE"));
    EXPECT_EQ(frame.display_outs, 0);
    EXPECT_TRUE(!frame.at_bat.has_value());
  }

  {
    JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_live_mid);
    doc["liveData"]["linescore"]["currentInning"] = 4;
    doc["liveData"]["linescore"]["inningHalf"] = "Top";
    doc["liveData"]["linescore"]["inningState"] = "Middle";
    doc["liveData"]["linescore"]["outs"] = 3;
    PlayFingerprints fingerprints;
    const CanonicalFrame &frame = extract(doc, UpdateMode::Incremental, fingerprints).frame;
    EXPECT_EQ(frame.phase, Phase::Live);
    EXPECT_EQ(frame.half, Half::Middle);
  }

  {
    JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_live_mid);
    doc["liveData"]["linescore"]["currentInning"] = 9;
    doc["liveData"]["linescore"]["inningHalf"] = "Bottom";
    doc["liveData"]["linescore"]["inningState"] = "End";
    doc["liveData"]["linescore"]["outs"] = 3;
    doc["liveData"]["linescore"]["teams"]["away"]["runs"] = 2;
    doc["liveData"]["linescore"]["teams"]["home"]["runs"] = 3;
    PlayFingerprints fingerprints;
    const CanonicalFrame &frame = extract(doc, UpdateMode::Incremental, fingerprints).frame;
    EXPECT_EQ(frame.phase, Phase::Final);
    EXPECT_EQ(frame.inning, 9);
    EXPECT_EQ(frame.half, Half::End);
    EXPECT_EQ(frame.label, std::string("FINAL"));
  }

  {
    JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_live_mid);
    doc["liveData"]["linescore"]["currentInning"] = 9;
    doc["liveData"]["linescore"]["inningHalf"] = "Top";
    doc["liveData"]["linescore"]["inningState"] = "Middle";
    doc["liveData"]["linescore"]["outs"] = 3;
    doc["liveData"]["linescore"]["teams"]["away"]["runs"] = 4;
    doc["liveData"]["linescore"]["teams"]["home"]["runs"] = 3;
    PlayFingerprints fingerprints;
    const CanonicalFrame &frame = extract(doc, UpdateMode::Incremental, fingerprints).frame;
    EXPECT_EQ(frame.phase, Phase::Live);
    EXPECT_EQ(frame.half, Half::Middle);
  }

  {
    JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_live_mid);
    doc["liveData"]["linescore"]["currentInning"] = 9;
    doc["liveData"]["linescore"]["inningHalf"] = "Top";
    doc["liveData"]["linescore"]["inningState"] = "Middle";
    doc["liveData"]["linescore"]["outs"] = 3;
    doc["liveData"]["linescore"]["teams"]["away"]["runs"] = 2;
    doc["liveData"]["linescore"]["teams"]["home"]["runs"] = 3;
    PlayFingerprints fingerprints;
    const CanonicalFrame &frame = extract(doc, UpdateMode::Incremental, fingerprints).frame;
    EXPECT_EQ(frame.phase, Phase::Final);
    EXPECT_EQ(frame.half, Half::End);
    EXPECT_EQ(frame.label, std::string("FINAL"));
  }

  {
    JsonDocument doc = parse_feed(apple::fixtures::mlb::k_822929_live_mid);
    doc["liveData"]["linescore"]["currentInning"] = 9;
    doc["liveData"]["linescore"]["inningHalf"] = "Bottom";
    doc["liveData"]["linescore"]["inningState"] = "End";
    doc["liveData"]["linescore"]["outs"] = 3;
    doc["liveData"]["linescore"]["teams"]["away"]["runs"] = 3;
    doc["liveData"]["linescore"]["teams"]["home"]["runs"] = 3;
    PlayFingerprints fingerprints;
    const CanonicalFrame &frame = extract(doc, UpdateMode::Incremental, fingerprints).frame;
    EXPECT_EQ(frame.phase, Phase::Live);
    EXPECT_EQ(frame.half, Half::End);
  }
}

void test_inferred_final_reaches_decision_core() {
  FeedTracker tracker;
  apple::game_state::Projector projector;
  MemoryLedger ledger;
  apple::core::Engine engine(ledger);
  Extraction out;
  std::string_view error;

  JsonDocument live = parse_feed(apple::fixtures::mlb::k_822929_live_mid);
  live["metaData"]["timeStamp"] = "20260901_235950";
  live["liveData"]["linescore"]["currentInning"] = 9;
  live["liveData"]["linescore"]["inningHalf"] = "Bottom";
  live["liveData"]["linescore"]["inningState"] = "Bottom";
  live["liveData"]["linescore"]["outs"] = 2;
  live["liveData"]["linescore"]["teams"]["away"]["runs"] = 3;
  live["liveData"]["linescore"]["teams"]["home"]["runs"] = 2;
  EXPECT_EQ(tracker.accept(live.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Frame);
  EXPECT_TRUE(projector.replace(out.frame));
  EXPECT_TRUE(engine.ingest(apple::core::to_input_envelope(projector.decision_evidence()), 0)
                  .events.empty());

  JsonDocument terminal;
  terminal.set(live);
  terminal["metaData"]["timeStamp"] = "20260902_000000";
  terminal["liveData"]["linescore"]["inningState"] = "End";
  terminal["liveData"]["linescore"]["outs"] = 3;
  EXPECT_EQ(tracker.accept(terminal.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Frame);
  EXPECT_EQ(out.frame.phase, Phase::Final);
  EXPECT_EQ(out.frame.half, Half::End);
  EXPECT_TRUE(projector.replace(out.frame));
  const apple::core::EngineOutput decision =
      engine.ingest(apple::core::to_input_envelope(projector.decision_evidence()), 1'000);
  EXPECT_EQ(decision.events.size(), static_cast<std::size_t>(1));
  EXPECT_TRUE(decision.events.front().type == apple::core::EventType::CelebrationStarted);
  EXPECT_TRUE(decision.events.front().celebration == apple::core::CelebrationKind::MetsWin);
}

void test_tracker_sequence() {
  FeedTracker tracker;
  Extraction out;
  std::string_view error;

  JsonDocument pregame = parse_feed(apple::fixtures::mlb::k_822929_pregame);
  EXPECT_EQ(tracker.accept(pregame.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Frame);
  EXPECT_TRUE(out.frame.update_mode == UpdateMode::Bootstrap);
  EXPECT_TRUE(tracker.bootstrapped());

  JsonDocument pending = parse_feed(apple::fixtures::mlb::k_822929_hr_pending);
  EXPECT_EQ(tracker.accept(pending.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Frame);
  EXPECT_TRUE(out.frame.update_mode == UpdateMode::Incremental);
  EXPECT_EQ(out.frame.phase, Phase::Live);
  for (const auto &play : out.frame.changed_plays)
    EXPECT_TRUE(!(play.kind == PlayKind::HomeRun && play.complete));

  JsonDocument homer = parse_feed(apple::fixtures::mlb::k_822929_hr);
  EXPECT_EQ(tracker.accept(homer.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Frame);
  EXPECT_EQ(out.frame.changed_plays.size(), static_cast<std::size_t>(1));
  EXPECT_EQ(out.frame.changed_plays.front().kind, PlayKind::HomeRun);
  EXPECT_TRUE(out.frame.changed_plays.front().complete);
  EXPECT_EQ(out.frame.cursor, std::string("20260901_224230"));
  EXPECT_EQ(tracker.cursor(), std::string("20260901_224230"));

  // The same feed again is a no-op, and an older feed is refused.
  EXPECT_EQ(tracker.accept(homer.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::NoChange);
  EXPECT_EQ(tracker.accept(pregame.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Regressed);

  // A repeated timestamp with a visible change gets a revision suffix.
  homer["liveData"]["linescore"]["teams"]["away"]["runs"] = 2;
  EXPECT_EQ(tracker.accept(homer.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Frame);
  EXPECT_EQ(out.frame.cursor, std::string("20260901_224230~000001"));
  EXPECT_EQ(out.frame.away.runs, 2);

  JsonDocument final_feed = parse_feed(apple::fixtures::mlb::k_822929_final);
  EXPECT_EQ(tracker.accept(final_feed.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Frame);
  EXPECT_EQ(out.frame.phase, Phase::Final);
  EXPECT_EQ(out.frame.half, Half::End);
  EXPECT_EQ(out.frame.label, std::string("FINAL"));
  EXPECT_EQ(out.frame.away.runs, 2);
  EXPECT_EQ(out.frame.home.runs, 6);
  EXPECT_TRUE(!out.frame.at_bat.has_value());
  // 74 real plays plus the pregame advisory play that carried no play id.
  EXPECT_EQ(tracker.tracked_plays(), static_cast<std::size_t>(75));

  tracker.reset();
  EXPECT_TRUE(!tracker.bootstrapped());
  EXPECT_EQ(tracker.tracked_plays(), static_cast<std::size_t>(0));
}

void test_core_pipeline() {
  FeedTracker tracker;
  apple::game_state::Projector projector;
  MemoryLedger ledger;
  apple::core::Engine engine(ledger);
  std::uint64_t now = 1'000;
  Extraction out;
  std::string_view error;

  const auto feed = [&](const char *text) {
    JsonDocument doc = parse_feed(text);
    EXPECT_EQ(tracker.accept(doc.as<JsonVariantConst>(), 1, out, error),
              FeedTracker::Outcome::Frame);
    EXPECT_TRUE(projector.replace(out.frame));
    now += 10'000;
    return engine.ingest(apple::core::to_input_envelope(projector.decision_evidence()), now);
  };

  apple::core::EngineOutput output = feed(apple::fixtures::mlb::k_822929_pregame);
  EXPECT_TRUE(output.events.empty());
  EXPECT_TRUE(output.commands.empty());
  output = feed(apple::fixtures::mlb::k_822929_hr_pending);
  EXPECT_TRUE(output.events.empty());
  EXPECT_EQ(engine.sequence_state(), apple::core::SequenceState::Idle);

  output = feed(apple::fixtures::mlb::k_822929_hr);
  EXPECT_EQ(output.events.size(), static_cast<std::size_t>(1));
  EXPECT_TRUE(output.events.front().type == apple::core::EventType::CelebrationStarted);
  EXPECT_TRUE(output.events.front().celebration == apple::core::CelebrationKind::HomeRun);
  EXPECT_EQ(output.events.front().subject, std::string("Francisco Lindor"));
  EXPECT_EQ(engine.sequence_state(), apple::core::SequenceState::LeadIn);
  EXPECT_EQ(ledger.lookup(output.events.front().event_key) == apple::core::LedgerLookup::Present,
            true);

  now += apple::core::kCelebrationLeadInMs + 10;
  output = engine.tick(now);
  EXPECT_EQ(output.commands.size(), static_cast<std::size_t>(1));
  EXPECT_TRUE(output.commands.front().type == apple::core::CommandType::MotionExtend);
  EXPECT_EQ(engine.sequence_state(), apple::core::SequenceState::Extending);

  // Finish the sequence so the final can be judged with the engine idle.
  now += 6'000;
  engine.report_position(apple::core::kMaxStrokeMm, now);
  now += apple::core::kRaisedDwellMs + 10;
  engine.tick(now);
  now += 6'000;
  engine.report_position(0, now);
  EXPECT_EQ(engine.sequence_state(), apple::core::SequenceState::Idle);

  // The Rays won, so the final produces no Mets celebration.
  output = feed(apple::fixtures::mlb::k_822929_final);
  EXPECT_TRUE(output.events.empty());
  EXPECT_EQ(engine.sequence_state(), apple::core::SequenceState::Idle);
  EXPECT_TRUE(!engine.fault_latched());

  // Replaying the home run feed after a restart with the same ledger never
  // fires the celebration twice.
  FeedTracker second;
  apple::core::Engine restarted(ledger);
  JsonDocument again = parse_feed(apple::fixtures::mlb::k_822929_hr);
  EXPECT_EQ(second.accept(again.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Frame);
  EXPECT_TRUE(projector.replace(out.frame));
  output = restarted.ingest(apple::core::to_input_envelope(projector.decision_evidence()), now);
  EXPECT_TRUE(output.events.empty());
}

void test_filter_keeps_everything_needed() {
  JsonDocument filtered = parse_feed(apple::fixtures::mlb::k_822929_final, true);
  JsonDocument unfiltered = parse_feed(apple::fixtures::mlb::k_822929_final, false);
  PlayFingerprints a;
  PlayFingerprints b;
  const Extraction from_filtered = extract(filtered, UpdateMode::Bootstrap, a);
  const Extraction from_unfiltered = extract(unfiltered, UpdateMode::Bootstrap, b);
  EXPECT_TRUE(same_frame(from_filtered.frame, from_unfiltered.frame));
  EXPECT_TRUE(a == b);
  EXPECT_TRUE(measureJson(filtered) < measureJson(unfiltered));
  std::cout << "filtered final feed: " << measureJson(filtered) << " bytes of JSON versus "
            << measureJson(unfiltered) << " received\n";
}

void test_rejects_malformed_feeds() {
  JsonDocument doc;
  deserializeJson(doc, R"({"gamePk":1,"metaData":{"timeStamp":"nope"}})");
  Extraction out;
  PlayFingerprints fingerprints;
  EXPECT_EQ(apple::mlb_feed::extract_frame(doc.as<JsonVariantConst>(), 1, UpdateMode::Bootstrap,
                                           fingerprints, out),
            std::string_view("INVALID_FEED_SHAPE"));
  deserializeJson(doc, R"({"gamePk":1,"gameData":{"teams":{"away":{"id":1},"home":{"id":2}}},)"
                       R"("metaData":{"timeStamp":"nope"}})");
  EXPECT_EQ(apple::mlb_feed::extract_frame(doc.as<JsonVariantConst>(), 1, UpdateMode::Bootstrap,
                                           fingerprints, out),
            std::string_view("INVALID_CURSOR"));
  FeedTracker tracker;
  std::string_view error;
  EXPECT_EQ(tracker.accept(doc.as<JsonVariantConst>(), 1, out, error),
            FeedTracker::Outcome::Invalid);
  EXPECT_EQ(error, std::string_view("INVALID_CURSOR"));
}

const char *phase_label(Phase phase) {
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

// What the adapter made of a capture, as one JSON line. The contract check
// holds it against MLB's own linescore and box score, because two captures
// that parse identically can still both miss every home run.
void print_summary(const CanonicalFrame &frame) {
  JsonDocument summary;
  summary["gamePk"] = frame.game_pk;
  summary["phase"] = phase_label(frame.phase);
  const auto team = [&frame](JsonObject node, const apple::game_state::TeamScore &score) {
    node["id"] = score.id;
    node["abbreviation"] = score.abbreviation;
    node["runs"] = score.runs;
    int home_runs = 0;
    int grand_slams = 0;
    for (const auto &play : frame.changed_plays) {
      if (play.batting_team_id != score.id)
        continue;
      if (play.kind == PlayKind::HomeRun)
        ++home_runs;
      if (play.kind == PlayKind::GrandSlam)
        ++grand_slams;
    }
    node["homeRuns"] = home_runs;
    node["grandSlams"] = grand_slams;
  };
  team(summary["away"].to<JsonObject>(), frame.away);
  team(summary["home"].to<JsonObject>(), frame.home);
  std::string line;
  serializeJson(summary, line);
  std::cout << "SUMMARY " << line << '\n';
}

int compare_captures(const char *full_path, const char *fields_path) {
  std::ifstream full_file(full_path);
  std::ifstream fields_file(fields_path);
  std::stringstream full_text;
  std::stringstream fields_text;
  full_text << full_file.rdbuf();
  fields_text << fields_file.rdbuf();
  const std::string full = full_text.str();
  const std::string fields = fields_text.str();
  JsonDocument from_full = parse_feed(full.c_str());
  JsonDocument from_fields = parse_feed(fields.c_str());
  PlayFingerprints a;
  PlayFingerprints b;
  const Extraction full_frame = extract(from_full, UpdateMode::Bootstrap, a);
  const Extraction fields_frame = extract(from_fields, UpdateMode::Bootstrap, b);
  const bool same = same_frame(full_frame.frame, fields_frame.frame) && a == b;
  std::cout << (same ? "MATCH" : "MISMATCH") << ": full capture " << full.size()
            << " bytes, fields capture " << fields.size() << " bytes, filtered document "
            << measureJson(from_fields) << " bytes, plays " << full_frame.play_count << '\n';
  print_summary(fields_frame.frame);
  return same ? 0 : 1;
}

// Parses a schedule response the way the Nano's fetch does, with the same
// filter and nesting limit, then prints every game it read and the game it
// would follow at now_epoch, for the contract check to compare with the raw
// response.
int check_schedule_capture(const char *path, std::int64_t now_epoch) {
  std::ifstream file(path);
  std::stringstream text;
  text << file.rdbuf();
  const std::string body = text.str();
  JsonDocument filter;
  EXPECT_TRUE(deserializeJson(filter, apple::mlb_feed::schedule_filter_json()) ==
              ArduinoJson::DeserializationError::Ok);
  JsonDocument doc;
  const ArduinoJson::DeserializationError error = deserializeJson(
      doc, body, ArduinoJson::DeserializationOption::Filter(filter),
      ArduinoJson::DeserializationOption::NestingLimit(apple::mlb_feed::kLiveFeedNestingLimit));
  if (error != ArduinoJson::DeserializationError::Ok) {
    std::cerr << "schedule parse failed: " << error.c_str() << '\n';
    return 1;
  }
  if (doc.overflowed()) {
    std::cerr << "schedule document overflowed\n";
    return 1;
  }
  const auto games = apple::mlb_feed::parse_schedule(doc.as<JsonVariantConst>());
  JsonDocument listed;
  JsonArray list = listed.to<JsonArray>();
  for (const auto &game : games) {
    JsonObject node = list.add<JsonObject>();
    node["gamePk"] = game.game_pk;
    node["gameNumber"] = game.game_number;
    node["officialDate"] = game.official_date;
    node["gameDate"] = game.game_date;
    node["abstractGameState"] = game.abstract_state;
    node["detailedState"] = game.detailed_state;
    node["followable"] = game.followable();
    node["gameType"] = game.game_type;
    node["seriesGameNumber"] = game.series_game_number;
    node["startTimeTbd"] = game.start_time_tbd;
    node["label"] = apple::mlb_feed::game_label(game);
    if (game.series_status.present) {
      JsonObject series = node["seriesStatus"].to<JsonObject>();
      series["isOver"] = game.series_status.is_over;
      series["winningTeamId"] = game.series_status.winning_team_id;
      series["losingTeamId"] = game.series_status.losing_team_id;
    }
    const auto team = [](JsonObject side, const apple::mlb_feed::ScheduleTeam &value) {
      side["id"] = value.id;
      side["abbreviation"] = value.abbreviation;
    };
    team(node["away"].to<JsonObject>(), game.away);
    team(node["home"].to<JsonObject>(), game.home);
  }
  std::string line;
  serializeJson(listed, line);
  std::cout << "SCHEDULE " << line << '\n';
  const auto chosen = apple::mlb_feed::choose_game(games, now_epoch);
  std::cout << "CHOSEN " << (chosen ? std::to_string(chosen->game_pk) : std::string("none"))
            << '\n';
  return 0;
}

} // namespace

// MLB's status block said only "Delayed" (code IO) during the 7/18 delay;
// the reason rode on a Game Advisory play event. The filtered parse must
// keep that event so the Apple shows RAIN DELAY, and the resume feed must
// return to LIVE.
void test_real_rain_delay_captures() {
  PlayFingerprints fingerprints;
  JsonDocument delayed = parse_feed(apple::fixtures::mlb::k_823441_rain_delay);
  const Extraction during = extract(delayed, UpdateMode::Bootstrap, fingerprints);
  EXPECT_EQ(during.frame.phase, Phase::Delayed);
  EXPECT_EQ(during.frame.label, std::string("RAIN DELAY"));
  EXPECT_EQ(during.frame.away.abbreviation, std::string("NYM"));
  EXPECT_EQ(during.frame.home.abbreviation, std::string("PHI"));
  EXPECT_EQ(during.frame.away.runs, 1);
  EXPECT_EQ(during.frame.home.runs, 6);
  EXPECT_EQ(during.frame.inning, 7);
  EXPECT_EQ(during.frame.half, Half::Bottom);
  EXPECT_EQ(during.frame.cursor, std::string("20260718_212943"));

  JsonDocument resumed = parse_feed(apple::fixtures::mlb::k_823441_resumed);
  const Extraction after = extract(resumed, UpdateMode::Incremental, fingerprints);
  EXPECT_EQ(after.frame.phase, Phase::Live);
  EXPECT_EQ(after.frame.label, std::string("LIVE"));
  EXPECT_EQ(after.frame.cursor, std::string("20260718_221512"));
  EXPECT_TRUE(after.frame.changed_plays.empty());

  // Without the advisory the same status is a generic delay.
  delayed["liveData"]["plays"]["currentPlay"].remove("playEvents");
  PlayFingerprints fresh;
  const Extraction bare = extract(delayed, UpdateMode::Bootstrap, fresh);
  EXPECT_EQ(bare.frame.phase, Phase::Delayed);
  EXPECT_EQ(bare.frame.label, std::string("Delayed"));
}

// The Mets' standing as the Nano reads it, for the live contract check.
int check_standing_capture(const char *path) {
  std::ifstream file(path);
  std::stringstream text;
  text << file.rdbuf();
  JsonDocument filter;
  EXPECT_TRUE(deserializeJson(filter, apple::mlb_feed::team_standing_filter_json()) ==
              ArduinoJson::DeserializationError::Ok);
  JsonDocument doc;
  if (deserializeJson(doc, text.str(), ArduinoJson::DeserializationOption::Filter(filter)) !=
      ArduinoJson::DeserializationError::Ok) {
    std::cerr << "standing parse failed\n";
    return 1;
  }
  const auto standing = apple::mlb_feed::parse_team_standing(doc.as<JsonVariantConst>());
  if (!standing) {
    std::cout << "STANDING none\n";
    return 0;
  }
  std::cout << "STANDING {\"clinched\":" << (standing->clinched ? "true" : "false")
            << ",\"eliminated\":" << (standing->eliminated ? "true" : "false") << "}\n";
  return 0;
}

int main(int argc, char **argv) {
  // The live contract check (tools/mlb_contract_check.py) runs these modes
  // over fresh MLB responses; with no arguments the recorded fixtures run.
  if (argc == 4 && std::string(argv[1]) == "--schedule")
    return check_schedule_capture(argv[2], std::atoll(argv[3]));
  if (argc == 3 && std::string(argv[1]) == "--standing")
    return check_standing_capture(argv[2]);
  if (argc == 3)
    return compare_captures(argv[1], argv[2]);
  test_iso8601();
  test_schedule();
  test_doubleheader_game_two_selection();
  test_spring_training_and_split_squads();
  test_postseason_labels_and_run();
  test_start_time_tbd();
  test_season_over();
  test_pregame();
  test_home_run_bootstrap();
  test_live_situation();
  test_inning_changeovers_and_status_lag();
  test_inferred_final_reaches_decision_core();
  test_tracker_sequence();
  test_core_pipeline();
  test_filter_keeps_everything_needed();
  test_rejects_malformed_feeds();
  test_real_rain_delay_captures();
  std::cout << "mlb_feed tests passed\n";
  return 0;
}
