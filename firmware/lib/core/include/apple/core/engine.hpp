#pragma once

#include "apple/core/types.hpp"

#include <cstddef>
#include <cstdint>
#include <deque>
#include <map>
#include <string>
#include <string_view>

namespace apple::core {

enum class LedgerLookup : std::uint8_t {
  Missing,
  Present,
  Error,
};

class EventLedger {
 public:
  virtual ~EventLedger() = default;
  virtual LedgerLookup lookup(std::string_view event_key) const = 0;
  virtual bool persist(std::string_view event_key) = 0;
};

class Engine {
 public:
  explicit Engine(EventLedger& ledger);

  EngineOutput ingest(const InputEnvelope& input, std::uint64_t now_ms);
  EngineOutput tick(std::uint64_t now_ms);
  EngineOutput report_position(std::int32_t position_mm, std::uint64_t now_ms);
  // Lets the motion adapter latch a fault it detected itself, such as a
  // stall seen by a current sensor. Emits MotionDisable like any fault.
  EngineOutput report_motion_fault(std::string_view reason,
                                   std::uint64_t now_ms);

  SequenceState sequence_state() const noexcept;
  bool fault_latched() const noexcept;
  std::size_t queued_sequence_count() const noexcept;
  const std::string& active_event_key() const noexcept;

 private:
  struct GameContext {
    bool bootstrapped{false};
    std::string cursor;
    Phase phase{Phase::Pregame};
  };

  struct CelebrationRequest {
    std::string event_key;
    CelebrationKind kind{CelebrationKind::HomeRun};
    std::string subject;
  };

  EventLedger& ledger_;
  std::map<std::int64_t, GameContext> games_;
  std::deque<CelebrationRequest> queue_;
  CelebrationRequest active_;
  SequenceState sequence_state_{SequenceState::Idle};
  std::uint64_t lead_due_ms_{0};
  std::uint64_t hold_remaining_ms_{0};
  std::uint64_t motion_deadline_ms_{0};
  std::uint64_t raised_due_ms_{0};
  std::uint64_t last_now_ms_{0};
  bool has_time_{false};
  bool fault_latched_{false};

  bool validate_time(std::uint64_t now_ms, EngineOutput& output);
  bool validate_input(const InputEnvelope& input, EngineOutput& output) const;
  bool persist_once(std::string_view event_key, EngineOutput& output);
  bool seed_bootstrap(const InputEnvelope& input, EngineOutput& output);
  void consider_play(const InputEnvelope& input, const PlayEvidence& play,
                     std::uint64_t now_ms, EngineOutput& output);
  void consider_final(const InputEnvelope& input, Phase previous_phase,
                      std::uint64_t now_ms, EngineOutput& output);
  void handle_active_review(const PlayEvidence& play, std::uint64_t now_ms,
                            EngineOutput& output);
  void enqueue(CelebrationRequest request, std::uint64_t now_ms,
               EngineOutput& output);
  void start_next(std::uint64_t now_ms, EngineOutput& output);
  void cancel_active(std::uint64_t now_ms, EngineOutput& output,
                     std::string_view trace_code);
  void latch_fault(std::string_view reason, EngineOutput& output);
  void emit_motion(CommandType type, std::int32_t position_mm,
                   std::uint64_t deadline_ms, EngineOutput& output) const;
};

}  // namespace apple::core
