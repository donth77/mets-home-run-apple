#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace apple::core {

constexpr std::int32_t kSchemaVersion = 1;
constexpr std::int32_t kMetsTeamId = 121;
constexpr std::int32_t kMaxStrokeMm = 50;
constexpr std::uint64_t kCelebrationLeadInMs = 2'000;
constexpr std::uint64_t kMotionDeadlineMs = 5'000;
constexpr std::uint64_t kRaisedDwellMs = 30'000;

enum class UpdateMode : std::uint8_t {
  Bootstrap,
  Incremental,
};

enum class Phase : std::uint8_t {
  Pregame,
  Live,
  Review,
  Delayed,
  Celebration,
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
};

enum class CelebrationKind : std::uint8_t {
  HomeRun,
  MetsWin,
};

enum class CommandType : std::uint8_t {
  DisplayRender,
  LedCelebrate,
  MotionExtend,
  MotionRetract,
  MotionDisable,
};

enum class SequenceState : std::uint8_t {
  Idle,
  LeadIn,
  ReviewHold,
  Extending,
  Raised,
  Retracting,
  Fault,
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

struct InputEnvelope {
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

struct Command {
  CommandType type{CommandType::DisplayRender};
  std::string event_key;
  CelebrationKind celebration{CelebrationKind::HomeRun};
  std::string subject;
  std::int32_t position_mm{0};
  std::uint64_t deadline_ms{0};
};

struct TraceEntry {
  std::string code;
  std::string detail;
};

struct EngineOutput {
  std::vector<Command> commands;
  std::vector<TraceEntry> traces;
};

const char* command_type_name(CommandType type) noexcept;
const char* sequence_state_name(SequenceState state) noexcept;

}  // namespace apple::core
