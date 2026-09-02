#include "apple/game_state/projector.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

namespace {

using apple::game_state::AtBatState;
using apple::game_state::CanonicalFrame;
using apple::game_state::Half;
using apple::game_state::InningScore;
using apple::game_state::Phase;
using apple::game_state::PlayEvidence;
using apple::game_state::PlayKind;
using apple::game_state::Projector;
using apple::game_state::ReviewState;
using apple::game_state::TeamScore;
using apple::game_state::UpdateMode;

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
    if (!(actual_value == expected_value))                                     \
      fail("values differ: " #actual " != " #expected, __LINE__);              \
  } while (false)

CanonicalFrame rich_frame() {
  CanonicalFrame frame;
  frame.game_pk = 777001;
  frame.game_number = 2;
  frame.cursor = "20260827_190010";
  frame.update_mode = UpdateMode::Incremental;
  frame.phase = Phase::Review;
  frame.label = "PLAY UNDER REVIEW";
  frame.away = TeamScore{144, "ATL", "Braves", 2};
  frame.home = TeamScore{121, "NYM", "Mets", 3};
  frame.inning = 7;
  frame.half = Half::Bottom;
  frame.display_outs = 0;
  frame.evidence_outs = 3;
  frame.review = ReviewState::Pending;
  frame.last_event = "Francisco Lindor homers on a fly ball to right field.";
  frame.scheduled_start = "2026-08-27T23:10:00Z";
  frame.venue = "Citi Field";

  AtBatState at_bat;
  at_bat.balls = 3;
  at_bat.strikes = 2;
  at_bat.bases = {true, false, true};
  at_bat.batter = "Francisco Lindor";
  at_bat.batter_line = "2–3";
  at_bat.pitcher = "Kodai Senga";
  at_bat.pitch_count = 87;
  frame.at_bat = at_bat;

  frame.linescore.innings = {
      InningScore{1, 0, 1},
      InningScore{2, 2, 0},
      InningScore{7, 0, std::nullopt},
  };
  frame.linescore.away_hits = 5;
  frame.linescore.home_hits = 7;
  frame.linescore.away_errors = 0;
  frame.linescore.home_errors = 1;
  frame.changed_plays.push_back(PlayEvidence{
      "777001:play-42", 42, 121, "Francisco Lindor", PlayKind::HomeRun,
      true, ReviewState::Pending});
  return frame;
}

void test_projects_complete_and_decision_views() {
  Projector projector;
  const auto frame = rich_frame();
  EXPECT_TRUE(projector.replace(frame));
  EXPECT_TRUE(projector.has_projection());
  EXPECT_TRUE(projector.last_error().empty());

  const auto &snapshot = projector.snapshot();
  EXPECT_EQ(snapshot.schema_version, 1);
  EXPECT_EQ(snapshot.game_pk, 777001);
  EXPECT_EQ(snapshot.game_number, 2);
  EXPECT_EQ(snapshot.phase, Phase::Review);
  EXPECT_EQ(snapshot.label, "PLAY UNDER REVIEW");
  EXPECT_EQ(snapshot.away.abbreviation, "ATL");
  EXPECT_EQ(snapshot.home.id, 121);
  EXPECT_EQ(snapshot.home.runs, 3);
  EXPECT_EQ(snapshot.inning, 7);
  EXPECT_EQ(snapshot.half, Half::Bottom);
  EXPECT_EQ(snapshot.outs, 0);
  EXPECT_EQ(snapshot.review, ReviewState::Pending);
  EXPECT_EQ(snapshot.scheduled_start.value(), "2026-08-27T23:10:00Z");
  EXPECT_EQ(snapshot.venue.value(), "Citi Field");
  EXPECT_TRUE(snapshot.at_bat.has_value());
  EXPECT_EQ(snapshot.at_bat->balls, 3);
  EXPECT_TRUE(snapshot.at_bat->bases.first);
  EXPECT_TRUE(snapshot.at_bat->bases.third);
  EXPECT_EQ(snapshot.at_bat->batter.value(), "Francisco Lindor");
  EXPECT_EQ(snapshot.at_bat->batter_line.value(), "2–3");
  EXPECT_EQ(snapshot.at_bat->pitch_count.value(), 87);
  EXPECT_EQ(snapshot.linescore.innings.size(), 3U);
  EXPECT_EQ(snapshot.linescore.innings[2].away.value(), 0);
  EXPECT_TRUE(!snapshot.linescore.innings[2].home.has_value());
  EXPECT_EQ(snapshot.linescore.home_errors.value(), 1);

  const auto &decision = projector.decision_evidence();
  EXPECT_EQ(decision.schema_version, 1);
  EXPECT_EQ(decision.update_mode, UpdateMode::Incremental);
  EXPECT_EQ(decision.game_pk, snapshot.game_pk);
  EXPECT_EQ(decision.game_number, snapshot.game_number);
  EXPECT_EQ(decision.cursor, "20260827_190010");
  EXPECT_EQ(decision.phase, snapshot.phase);
  EXPECT_EQ(decision.half, snapshot.half);
  EXPECT_EQ(decision.inning, snapshot.inning);
  EXPECT_EQ(decision.outs, 3);
  EXPECT_EQ(decision.away_team_id, snapshot.away.id);
  EXPECT_EQ(decision.home_team_id, snapshot.home.id);
  EXPECT_EQ(decision.away_runs, snapshot.away.runs);
  EXPECT_EQ(decision.home_runs, snapshot.home.runs);
  EXPECT_EQ(decision.plays.size(), 1U);
  EXPECT_EQ(decision.plays[0].kind, PlayKind::HomeRun);
  EXPECT_EQ(decision.plays[0].batter_name, "Francisco Lindor");
}

void test_replace_clears_stale_optional_state() {
  Projector projector;
  EXPECT_TRUE(projector.replace(rich_frame()));

  auto next = rich_frame();
  next.cursor = "20260827_190020";
  next.phase = Phase::Live;
  next.label = "LIVE";
  next.review = ReviewState::None;
  next.scheduled_start.reset();
  next.venue.reset();
  next.at_bat.reset();
  next.linescore = {};
  next.changed_plays.clear();
  EXPECT_TRUE(projector.replace(next));

  const auto &snapshot = projector.snapshot();
  EXPECT_TRUE(!snapshot.scheduled_start.has_value());
  EXPECT_TRUE(!snapshot.venue.has_value());
  EXPECT_TRUE(!snapshot.at_bat.has_value());
  EXPECT_TRUE(snapshot.linescore.innings.empty());
  EXPECT_TRUE(!snapshot.linescore.away_hits.has_value());
  EXPECT_TRUE(projector.decision_evidence().plays.empty());
}

void test_rejected_frame_preserves_last_good_projection() {
  Projector projector;
  EXPECT_TRUE(projector.replace(rich_frame()));
  auto invalid = rich_frame();
  invalid.game_pk = 888002;
  invalid.display_outs = 4;

  EXPECT_TRUE(!projector.replace(invalid));
  EXPECT_EQ(projector.last_error(), "outs must be between 0 and 3");
  EXPECT_EQ(projector.snapshot().game_pk, 777001);
  EXPECT_EQ(projector.decision_evidence().game_pk, 777001);
}

} // namespace

int main() {
  test_projects_complete_and_decision_views();
  test_replace_clears_stale_optional_state();
  test_rejected_frame_preserves_last_good_projection();
  std::cout << "game state tests passed\n";
  return 0;
}
