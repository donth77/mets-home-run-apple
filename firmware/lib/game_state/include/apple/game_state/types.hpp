#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace apple::game_state {

constexpr std::int32_t kSchemaVersion = 1;

enum class UpdateMode : std::uint8_t {
  Bootstrap,
  Incremental,
};

enum class Phase : std::uint8_t {
  Pregame,
  Live,
  Review,
  Delayed,
  Final,
  Sleep,
};

enum class Half : std::uint8_t {
  Top,
  Bottom,
  Middle,
  End,
};

enum class ReviewState : std::uint8_t {
  None,
  Pending,
  Confirmed,
  Overturned,
};

enum class PlayKind : std::uint8_t {
  Other,
  HomeRun,
  GrandSlam,
};

struct TeamScore {
  std::int32_t id{0};
  std::string abbreviation;
  std::string name;
  std::int32_t runs{0};
};

struct Bases {
  bool first{false};
  bool second{false};
  bool third{false};
};

struct AtBatState {
  std::int32_t balls{0};
  std::int32_t strikes{0};
  Bases bases;
  std::optional<std::string> batter;
  std::optional<std::string> batter_line;
  std::optional<std::string> pitcher;
  std::optional<std::int32_t> pitch_count;
};

struct InningScore {
  std::int32_t inning{0};
  std::optional<std::int32_t> away;
  std::optional<std::int32_t> home;
};

struct GameLinescore {
  std::vector<InningScore> innings;
  std::optional<std::int32_t> away_hits;
  std::optional<std::int32_t> home_hits;
  std::optional<std::int32_t> away_errors;
  std::optional<std::int32_t> home_errors;
};

struct PlayEvidence {
  std::string event_key;
  std::int32_t at_bat_index{-1};
  std::int32_t batting_team_id{0};
  std::string batter_name;
  PlayKind kind{PlayKind::Other};
  bool complete{false};
  ReviewState review{ReviewState::None};
};

/** Facts extracted by a platform-specific MLB feed adapter. */
struct CanonicalFrame {
  std::int64_t game_pk{0};
  std::int32_t game_number{1};
  std::string cursor;
  UpdateMode update_mode{UpdateMode::Incremental};
  Phase phase{Phase::Pregame};
  std::string label;
  TeamScore away;
  TeamScore home;
  std::int32_t inning{0};
  Half half{Half::Top};
  std::int32_t display_outs{0};
  std::int32_t evidence_outs{0};
  ReviewState review{ReviewState::None};
  std::string last_event;
  std::optional<std::string> scheduled_start;
  std::optional<std::string> venue;
  std::optional<AtBatState> at_bat;
  GameLinescore linescore;
  std::vector<PlayEvidence> changed_plays;
};

/** Complete read-only state for displays and scoreboards. */
struct GameSnapshot {
  std::int32_t schema_version{kSchemaVersion};
  std::int64_t game_pk{0};
  std::int32_t game_number{1};
  Phase phase{Phase::Pregame};
  std::string label;
  TeamScore away;
  TeamScore home;
  std::int32_t inning{0};
  Half half{Half::Top};
  std::int32_t outs{0};
  ReviewState review{ReviewState::None};
  std::string last_event;
  std::optional<std::string> scheduled_start;
  std::optional<std::string> venue;
  std::optional<AtBatState> at_bat;
  GameLinescore linescore;
};

/** Small, display-free evidence for the celebration decision core. */
struct DecisionEvidence {
  std::int32_t schema_version{kSchemaVersion};
  UpdateMode update_mode{UpdateMode::Incremental};
  std::int64_t game_pk{0};
  std::int32_t game_number{1};
  std::string cursor;
  Phase phase{Phase::Pregame};
  Half half{Half::Top};
  std::int32_t inning{0};
  std::int32_t outs{0};
  std::int32_t away_team_id{0};
  std::int32_t home_team_id{0};
  std::int32_t away_runs{0};
  std::int32_t home_runs{0};
  std::vector<PlayEvidence> plays;
};

} // namespace apple::game_state
