#include "apple/core/engine.hpp"

#include <algorithm>
#include <utility>

namespace apple::core {
namespace {

void trace(EngineOutput &output, std::string code, std::string detail = {}) {
  output.traces.push_back(TraceEntry{std::move(code), std::move(detail)});
}

bool mets_are_home(const InputEnvelope &input) {
  return input.home_team_id == kMetsTeamId;
}

bool mets_won(const InputEnvelope &input) {
  if (mets_are_home(input)) {
    return input.home_runs > input.away_runs;
  }
  return input.away_runs > input.home_runs;
}

ReviewState effective_review(const InputEnvelope &input,
                             const PlayEvidence &play) {
  if (play.review == ReviewState::None && input.phase == Phase::Review) {
    return ReviewState::Pending;
  }
  return play.review;
}

bool is_home_run(PlayKind kind) {
  return kind == PlayKind::HomeRun || kind == PlayKind::GrandSlam;
}

CelebrationKind celebration_for_play(PlayKind kind) {
  return kind == PlayKind::GrandSlam ? CelebrationKind::GrandSlam
                                     : CelebrationKind::HomeRun;
}

} // namespace

Engine::Engine(EventLedger &ledger) : ledger_(ledger) {}

EngineOutput Engine::ingest(const InputEnvelope &input, std::uint64_t now_ms) {
  EngineOutput output;
  if (!validate_time(now_ms, output) || !validate_input(input, output) ||
      fault_latched_) {
    return output;
  }

  auto &game = games_[input.game_pk];
  if (!game.cursor.empty() && input.cursor <= game.cursor) {
    trace(output,
          input.cursor == game.cursor ? "INPUT_DUPLICATE"
                                      : "INPUT_CURSOR_REGRESSION",
          input.cursor);
    return output;
  }

  const Phase previous_phase = game.phase;
  const bool must_bootstrap =
      input.update_mode == UpdateMode::Bootstrap || !game.bootstrapped;
  if (must_bootstrap) {
    if (!seed_bootstrap(input, output)) {
      return output;
    }
    game.bootstrapped = true;
    game.cursor = input.cursor;
    game.phase = input.phase;
    trace(output,
          input.update_mode == UpdateMode::Bootstrap ? "BOOTSTRAP_ACCEPTED"
                                                     : "IMPLICIT_BOOTSTRAP",
          std::to_string(input.game_pk));
    return output;
  }

  for (const auto &play : input.plays) {
    handle_active_review(play, now_ms, output);
    if (fault_latched_) {
      return output;
    }
    consider_play(input, play, now_ms, output);
    if (fault_latched_) {
      return output;
    }
  }
  consider_final(input, previous_phase, now_ms, output);
  if (fault_latched_) {
    return output;
  }

  game.cursor = input.cursor;
  game.phase = input.phase;
  trace(output, "INPUT_ACCEPTED", input.cursor);
  return output;
}

EngineOutput Engine::report_motion_fault(std::string_view reason,
                                         std::uint64_t now_ms) {
  EngineOutput output;
  if (!validate_time(now_ms, output) || fault_latched_) {
    return output;
  }
  latch_fault(reason, output);
  return output;
}

EngineOutput Engine::tick(std::uint64_t now_ms) {
  EngineOutput output;
  if (!validate_time(now_ms, output) || fault_latched_) {
    return output;
  }

  switch (sequence_state_) {
  case SequenceState::LeadIn:
    if (now_ms >= lead_due_ms_) {
      motion_deadline_ms_ = now_ms + kMotionDeadlineMs;
      sequence_state_ = SequenceState::Extending;
      emit_motion(CommandType::MotionExtend, kMaxStrokeMm, motion_deadline_ms_,
                  output);
      trace(output, "MOTION_EXTEND_ISSUED", active_.event_key);
    }
    break;
  case SequenceState::Extending:
    if (now_ms >= motion_deadline_ms_) {
      latch_fault("EXTEND_TIMEOUT", output);
    }
    break;
  case SequenceState::Raised:
    if (now_ms >= raised_due_ms_) {
      motion_deadline_ms_ = now_ms + kMotionDeadlineMs;
      sequence_state_ = SequenceState::Retracting;
      emit_motion(CommandType::MotionRetract, 0, motion_deadline_ms_, output);
      trace(output, "MOTION_RETRACT_ISSUED", active_.event_key);
    }
    break;
  case SequenceState::Retracting:
    if (now_ms >= motion_deadline_ms_) {
      latch_fault("RETRACT_TIMEOUT", output);
    }
    break;
  case SequenceState::Idle:
  case SequenceState::ReviewHold:
  case SequenceState::Fault:
    break;
  }
  return output;
}

EngineOutput Engine::report_position(std::int32_t position_mm,
                                     std::uint64_t now_ms) {
  EngineOutput output;
  if (!validate_time(now_ms, output) || fault_latched_) {
    return output;
  }
  if (position_mm < 0 || position_mm > kMaxStrokeMm) {
    trace(output, "POSITION_REJECTED", std::to_string(position_mm));
    return output;
  }

  if (sequence_state_ == SequenceState::Extending &&
      position_mm >= kMaxStrokeMm) {
    sequence_state_ = SequenceState::Raised;
    raised_due_ms_ = now_ms + kRaisedDwellMs;
    trace(output, "POSITION_RAISED", active_.event_key);
  } else if (sequence_state_ == SequenceState::Retracting && position_mm == 0) {
    trace(output, "POSITION_HOME", active_.event_key);
    sequence_state_ = SequenceState::Idle;
    active_ = CelebrationRequest{};
    start_next(now_ms, output);
  }
  return output;
}

SequenceState Engine::sequence_state() const noexcept {
  return sequence_state_;
}

bool Engine::fault_latched() const noexcept { return fault_latched_; }

std::size_t Engine::queued_sequence_count() const noexcept {
  return queue_.size();
}

const std::string &Engine::active_event_key() const noexcept {
  return active_.event_key;
}

bool Engine::validate_time(std::uint64_t now_ms, EngineOutput &output) {
  if (has_time_ && now_ms < last_now_ms_) {
    latch_fault("MONOTONIC_TIME_REGRESSION", output);
    return false;
  }
  last_now_ms_ = now_ms;
  has_time_ = true;
  return true;
}

bool Engine::validate_input(const InputEnvelope &input,
                            EngineOutput &output) const {
  if (input.schema_version != kSchemaVersion) {
    trace(output, "INPUT_SCHEMA_REJECTED",
          std::to_string(input.schema_version));
    return false;
  }
  if (input.game_pk <= 0 || input.cursor.empty() ||
      (input.game_number != 1 && input.game_number != 2) || input.inning < 0 ||
      input.outs < 0 || input.outs > 3 || input.away_runs < 0 ||
      input.home_runs < 0) {
    trace(output, "INPUT_MALFORMED");
    return false;
  }
  const bool mets_away = input.away_team_id == kMetsTeamId;
  const bool mets_home = input.home_team_id == kMetsTeamId;
  if (mets_away == mets_home) {
    trace(output, "INPUT_WRONG_GAME", std::to_string(input.game_pk));
    return false;
  }
  return true;
}

bool Engine::persist_once(std::string_view event_key, EngineOutput &output) {
  const auto lookup = ledger_.lookup(event_key);
  if (lookup == LedgerLookup::Error) {
    latch_fault("LEDGER_LOOKUP_FAILED", output);
    return false;
  }
  if (lookup == LedgerLookup::Present) {
    trace(output, "EVENT_DUPLICATE", std::string(event_key));
    return false;
  }
  if (!ledger_.persist(event_key)) {
    latch_fault("LEDGER_PERSIST_FAILED", output);
    return false;
  }
  trace(output, "EVENT_PERSISTED", std::string(event_key));
  return true;
}

bool Engine::seed_bootstrap(const InputEnvelope &input, EngineOutput &output) {
  for (const auto &play : input.plays) {
    if (!play.complete || play.event_key.empty() || !is_home_run(play.kind) ||
        play.batting_team_id != kMetsTeamId) {
      continue;
    }
    const auto review = effective_review(input, play);
    if (review == ReviewState::Pending || review == ReviewState::Overturned) {
      continue;
    }
    const auto lookup = ledger_.lookup(play.event_key);
    if (lookup == LedgerLookup::Error ||
        (lookup == LedgerLookup::Missing && !ledger_.persist(play.event_key))) {
      latch_fault("BOOTSTRAP_LEDGER_FAILED", output);
      return false;
    }
    trace(output, "BOOTSTRAP_EVENT_SEEDED", play.event_key);
  }

  if (input.phase == Phase::Final && mets_won(input)) {
    const std::string final_key = std::to_string(input.game_pk) + ":final";
    const auto lookup = ledger_.lookup(final_key);
    if (lookup == LedgerLookup::Error ||
        (lookup == LedgerLookup::Missing && !ledger_.persist(final_key))) {
      latch_fault("BOOTSTRAP_LEDGER_FAILED", output);
      return false;
    }
    trace(output, "BOOTSTRAP_EVENT_SEEDED", final_key);
  }
  return true;
}

void Engine::consider_play(const InputEnvelope &input, const PlayEvidence &play,
                           std::uint64_t now_ms, EngineOutput &output) {
  if (!play.complete || play.event_key.empty() || !is_home_run(play.kind)) {
    return;
  }
  if (play.batting_team_id != kMetsTeamId) {
    trace(output, "HOME_RUN_OPPONENT_IGNORED", play.event_key);
    return;
  }

  const auto review = effective_review(input, play);
  if (review == ReviewState::Pending) {
    trace(output, "HOME_RUN_REVIEW_HOLD", play.event_key);
    return;
  }
  if (review == ReviewState::Overturned) {
    trace(output, "HOME_RUN_OVERTURNED", play.event_key);
    return;
  }
  if (!persist_once(play.event_key, output)) {
    return;
  }
  enqueue(CelebrationRequest{play.event_key, celebration_for_play(play.kind),
                             play.batter_name},
          now_ms, output);
}

void Engine::consider_final(const InputEnvelope &input, Phase previous_phase,
                            std::uint64_t now_ms, EngineOutput &output) {
  if (input.phase != Phase::Final || previous_phase == Phase::Final ||
      !mets_won(input)) {
    return;
  }
  const std::string event_key = std::to_string(input.game_pk) + ":final";
  if (!persist_once(event_key, output)) {
    return;
  }
  enqueue(CelebrationRequest{event_key, CelebrationKind::MetsWin, "Mets Win!"},
          now_ms, output);
}

void Engine::handle_active_review(const PlayEvidence &play,
                                  std::uint64_t now_ms, EngineOutput &output) {
  if (active_.event_key.empty() || play.event_key != active_.event_key ||
      !is_home_run(play.kind)) {
    return;
  }
  if (play.review == ReviewState::Pending &&
      sequence_state_ == SequenceState::LeadIn) {
    hold_remaining_ms_ = lead_due_ms_ > now_ms ? lead_due_ms_ - now_ms : 0;
    sequence_state_ = SequenceState::ReviewHold;
    trace(output, "ACTIVE_REVIEW_HOLD", play.event_key);
  } else if ((play.review == ReviewState::Confirmed ||
              play.review == ReviewState::None) &&
             sequence_state_ == SequenceState::ReviewHold) {
    lead_due_ms_ = now_ms + hold_remaining_ms_;
    sequence_state_ = SequenceState::LeadIn;
    trace(output, "ACTIVE_REVIEW_RESUMED", play.event_key);
  } else if (play.review == ReviewState::Overturned &&
             (sequence_state_ == SequenceState::LeadIn ||
              sequence_state_ == SequenceState::ReviewHold)) {
    cancel_active(now_ms, output, "ACTIVE_REVIEW_OVERTURNED");
  }
}

void Engine::enqueue(CelebrationRequest request, std::uint64_t now_ms,
                     EngineOutput &output) {
  queue_.push_back(std::move(request));
  trace(output, "SEQUENCE_QUEUED", queue_.back().event_key);
  start_next(now_ms, output);
}

void Engine::start_next(std::uint64_t now_ms, EngineOutput &output) {
  if (fault_latched_ || sequence_state_ != SequenceState::Idle ||
      queue_.empty()) {
    return;
  }
  active_ = std::move(queue_.front());
  queue_.pop_front();
  sequence_state_ = SequenceState::LeadIn;
  lead_due_ms_ = now_ms + kCelebrationLeadInMs;
  hold_remaining_ms_ = 0;
  output.events.push_back(CoreEvent{EventType::CelebrationStarted,
                                    active_.event_key, active_.kind,
                                    active_.subject});
  trace(output, "SEQUENCE_STARTED", active_.event_key);
}

void Engine::cancel_active(std::uint64_t now_ms, EngineOutput &output,
                           std::string_view trace_code) {
  trace(output, std::string(trace_code), active_.event_key);
  active_ = CelebrationRequest{};
  sequence_state_ = SequenceState::Idle;
  start_next(now_ms, output);
}

void Engine::latch_fault(std::string_view reason, EngineOutput &output) {
  if (fault_latched_) {
    return;
  }
  fault_latched_ = true;
  sequence_state_ = SequenceState::Fault;
  queue_.clear();
  output.commands.push_back(
      Command{CommandType::MotionDisable, active_.event_key, 0, 0});
  trace(output, "FAULT_LATCHED", std::string(reason));
}

void Engine::emit_motion(CommandType type, std::int32_t position_mm,
                         std::uint64_t deadline_ms,
                         EngineOutput &output) const {
  output.commands.push_back(
      Command{type, active_.event_key, position_mm, deadline_ms});
}

} // namespace apple::core
