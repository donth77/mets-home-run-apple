#include "apple/core/engine.hpp"

#include <cstddef>
#include <cstdint>
#include <set>
#include <string>
#include <string_view>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define APPLE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define APPLE_EXPORT
#endif

namespace {

using apple::core::Engine;
using apple::core::EngineOutput;
using apple::core::EventLedger;
using apple::core::InputEnvelope;
using apple::core::LedgerLookup;

class MemoryLedger final : public EventLedger {
 public:
  LedgerLookup lookup(std::string_view event_key) const override {
    if (fail_reads_) return LedgerLookup::Error;
    return keys_.count(std::string(event_key)) == 0 ? LedgerLookup::Missing
                                                    : LedgerLookup::Present;
  }

  bool persist(std::string_view event_key) override {
    if (fail_writes_) return false;
    keys_.insert(std::string(event_key));
    return true;
  }

  void set_failures(bool reads, bool writes) {
    fail_reads_ = reads;
    fail_writes_ = writes;
  }

  bool contains(std::string_view event_key) const {
    return keys_.count(std::string(event_key)) != 0;
  }

 private:
  std::set<std::string> keys_;
  bool fail_reads_{false};
  bool fail_writes_{false};
};

struct CoreHandle {
  CoreHandle() : engine(ledger) {}

  MemoryLedger ledger;
  Engine engine;
  InputEnvelope pending;
  EngineOutput output;
  bool pending_ready{false};
};

CoreHandle* as_handle(void* raw) { return static_cast<CoreHandle*>(raw); }

const CoreHandle* as_handle(const void* raw) {
  return static_cast<const CoreHandle*>(raw);
}

std::string string_or_empty(const char* value) {
  return value == nullptr ? std::string{} : std::string(value);
}

template <typename Enum>
bool enum_in_range(int value, int maximum, Enum& target) {
  if (value < 0 || value > maximum) return false;
  target = static_cast<Enum>(value);
  return true;
}

const apple::core::Command* command_at(const CoreHandle* handle,
                                       std::size_t index) {
  if (handle == nullptr || index >= handle->output.commands.size()) {
    return nullptr;
  }
  return &handle->output.commands[index];
}

const apple::core::TraceEntry* trace_at(const CoreHandle* handle,
                                        std::size_t index) {
  if (handle == nullptr || index >= handle->output.traces.size()) {
    return nullptr;
  }
  return &handle->output.traces[index];
}

}  // namespace

extern "C" {

APPLE_EXPORT void* apple_core_create() { return new CoreHandle(); }

APPLE_EXPORT void apple_core_destroy(void* raw) { delete as_handle(raw); }

APPLE_EXPORT int apple_core_begin_input(
    void* raw, int schema_version, int update_mode, int game_pk,
    int game_number, const char* cursor, int phase, int half, int inning,
    int outs, int away_team_id, int home_team_id, int away_runs,
    int home_runs) {
  auto* handle = as_handle(raw);
  if (handle == nullptr) return 0;

  InputEnvelope input;
  input.schema_version = schema_version;
  input.game_pk = game_pk;
  input.game_number = game_number;
  input.cursor = string_or_empty(cursor);
  input.inning = inning;
  input.outs = outs;
  input.away_team_id = away_team_id;
  input.home_team_id = home_team_id;
  input.away_runs = away_runs;
  input.home_runs = home_runs;
  if (!enum_in_range(update_mode, 1, input.update_mode) ||
      !enum_in_range(phase, 6, input.phase) ||
      !enum_in_range(half, 3, input.half)) {
    handle->pending_ready = false;
    return 0;
  }
  handle->pending = std::move(input);
  handle->pending_ready = true;
  return 1;
}

APPLE_EXPORT int apple_core_add_play(void* raw, const char* event_key,
                                     int at_bat_index, int batting_team_id,
                                     const char* batter_name, int play_kind,
                                     int complete, int review_state) {
  auto* handle = as_handle(raw);
  if (handle == nullptr || !handle->pending_ready) return 0;
  apple::core::PlayEvidence play;
  play.event_key = string_or_empty(event_key);
  play.at_bat_index = at_bat_index;
  play.batting_team_id = batting_team_id;
  play.batter_name = string_or_empty(batter_name);
  play.complete = complete != 0;
  if (!enum_in_range(play_kind, 1, play.kind) ||
      !enum_in_range(review_state, 3, play.review)) {
    return 0;
  }
  handle->pending.plays.push_back(std::move(play));
  return 1;
}

APPLE_EXPORT int apple_core_commit_input(void* raw, double now_ms) {
  auto* handle = as_handle(raw);
  if (handle == nullptr || !handle->pending_ready || now_ms < 0) return 0;
  handle->output =
      handle->engine.ingest(handle->pending, static_cast<std::uint64_t>(now_ms));
  handle->pending_ready = false;
  return 1;
}

APPLE_EXPORT int apple_core_tick(void* raw, double now_ms) {
  auto* handle = as_handle(raw);
  if (handle == nullptr || now_ms < 0) return 0;
  handle->output = handle->engine.tick(static_cast<std::uint64_t>(now_ms));
  return 1;
}

APPLE_EXPORT int apple_core_report_position(void* raw, int position_mm,
                                            double now_ms) {
  auto* handle = as_handle(raw);
  if (handle == nullptr || now_ms < 0) return 0;
  handle->output = handle->engine.report_position(
      position_mm, static_cast<std::uint64_t>(now_ms));
  return 1;
}

APPLE_EXPORT void apple_core_set_ledger_failures(void* raw, int reads,
                                                  int writes) {
  auto* handle = as_handle(raw);
  if (handle != nullptr) handle->ledger.set_failures(reads != 0, writes != 0);
}

APPLE_EXPORT int apple_core_ledger_contains(const void* raw,
                                            const char* event_key) {
  const auto* handle = as_handle(raw);
  return handle != nullptr &&
                 handle->ledger.contains(string_or_empty(event_key))
             ? 1
             : 0;
}

APPLE_EXPORT int apple_core_sequence_state(const void* raw) {
  const auto* handle = as_handle(raw);
  return handle == nullptr ? -1
                           : static_cast<int>(handle->engine.sequence_state());
}

APPLE_EXPORT int apple_core_fault_latched(const void* raw) {
  const auto* handle = as_handle(raw);
  return handle != nullptr && handle->engine.fault_latched() ? 1 : 0;
}

APPLE_EXPORT int apple_core_command_count(const void* raw) {
  const auto* handle = as_handle(raw);
  return handle == nullptr ? 0
                           : static_cast<int>(handle->output.commands.size());
}

APPLE_EXPORT int apple_core_command_type(const void* raw, int index) {
  const auto* command =
      index < 0 ? nullptr : command_at(as_handle(raw), index);
  return command == nullptr ? -1 : static_cast<int>(command->type);
}

APPLE_EXPORT const char* apple_core_command_event_key(const void* raw,
                                                      int index) {
  const auto* command =
      index < 0 ? nullptr : command_at(as_handle(raw), index);
  return command == nullptr ? "" : command->event_key.c_str();
}

APPLE_EXPORT const char* apple_core_command_subject(const void* raw,
                                                    int index) {
  const auto* command =
      index < 0 ? nullptr : command_at(as_handle(raw), index);
  return command == nullptr ? "" : command->subject.c_str();
}

APPLE_EXPORT int apple_core_command_celebration(const void* raw, int index) {
  const auto* command =
      index < 0 ? nullptr : command_at(as_handle(raw), index);
  return command == nullptr ? -1 : static_cast<int>(command->celebration);
}

APPLE_EXPORT int apple_core_command_position_mm(const void* raw, int index) {
  const auto* command =
      index < 0 ? nullptr : command_at(as_handle(raw), index);
  return command == nullptr ? 0 : command->position_mm;
}

APPLE_EXPORT double apple_core_command_deadline_ms(const void* raw,
                                                   int index) {
  const auto* command =
      index < 0 ? nullptr : command_at(as_handle(raw), index);
  return command == nullptr ? 0.0
                            : static_cast<double>(command->deadline_ms);
}

APPLE_EXPORT int apple_core_trace_count(const void* raw) {
  const auto* handle = as_handle(raw);
  return handle == nullptr ? 0
                           : static_cast<int>(handle->output.traces.size());
}

APPLE_EXPORT const char* apple_core_trace_code(const void* raw, int index) {
  const auto* entry = index < 0 ? nullptr : trace_at(as_handle(raw), index);
  return entry == nullptr ? "" : entry->code.c_str();
}

APPLE_EXPORT const char* apple_core_trace_detail(const void* raw, int index) {
  const auto* entry = index < 0 ? nullptr : trace_at(as_handle(raw), index);
  return entry == nullptr ? "" : entry->detail.c_str();
}

}  // extern "C"
