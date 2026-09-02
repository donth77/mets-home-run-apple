#pragma once

#include "apple/core/types.hpp"

#include <cstdint>

namespace apple::motion {

// Measured behaviour of a two-wire linear actuator whose internal end-stop
// switches open the motor circuit at both ends of travel.
//
// The switches make both ends of travel safe to drive into, so the model does
// not need position feedback: every motion command drives for the measured
// full-stroke time plus an overrun, which reaches the target end from any
// starting position. Sitting on an open switch draws no current.
struct TimedActuatorProfile {
  std::int32_t stroke_mm{core::kMaxStrokeMm};
  std::uint32_t extend_full_ms{0};
  std::uint32_t retract_full_ms{0};
  // Extra drive time past the measured stroke so a slower actuator on a sagging
  // supply still reaches its switch.
  std::uint32_t overrun_ms{0};
  // Bridge-off pause before reversing direction.
  std::uint32_t reverse_pause_ms{50};

  constexpr bool valid() const noexcept {
    return stroke_mm > 0 && stroke_mm <= core::kMaxStrokeMm &&
           extend_full_ms > 0 && retract_full_ms > 0;
  }
};

// Optional current-sense confirmation on top of the timed drive. All
// thresholds zero means no sensor: the model stays purely timed.
//
// Arrival: once the motor has drawn more than flowing_above_ma for at least
// min_flow_ms, a reading below arrival_below_ma held for arrival_hold_ms means
// the internal end-stop switch opened, and the drive stops early with the
// target reported. Stall: a reading above stall_above_ma held for stall_ms
// stops the drive and flags a fault; the adapter must latch it in the engine.
struct CurrentSenseProfile {
  std::int32_t flowing_above_ma{0};
  std::uint32_t min_flow_ms{0};
  std::int32_t arrival_below_ma{0};
  std::uint32_t arrival_hold_ms{0};
  std::int32_t stall_above_ma{0};
  std::uint32_t stall_ms{0};

  constexpr bool enabled() const noexcept {
    return flowing_above_ma > 0 && arrival_below_ma > 0;
  }
  constexpr bool stall_enabled() const noexcept {
    return stall_above_ma > 0 && stall_ms > 0;
  }
};

// Starting point for the prototype actuator (34 Ω, about 0.33 A running at
// 11 V): flow above 150 mA for 300 ms, arrival below 60 mA for 100 ms, stall
// above 1200 mA for 250 ms. Tune from soak data before trusting it.
inline constexpr CurrentSenseProfile kReferenceCurrentSense{150, 300, 60, 100,
                                                            1'200, 250};

// Bench measurement of the prototype actuator on September 1, 2026: 50 mm
// stroke through the L298N from an 11.05 V TalentCell pack, stopwatch timing
// of 5.07 s extend and 4.98 s retract from switch to switch. Times are rounded
// up and the overrun covers a discharged pack.
inline constexpr TimedActuatorProfile kReferenceProfile{
    core::kMaxStrokeMm, 5'500, 5'300, 1'500, 50};

enum class Drive : std::uint8_t {
  Off,
  Extend,
  Retract,
};

enum class Rejection : std::uint8_t {
  None,
  InvalidProfile,
  DeadlineTooShort,
};

struct Step {
  Drive drive{Drive::Off};
  bool drive_changed{false};
  bool report_position{false};
  std::int32_t position_mm{0};
  // Arrival confirmed by the current sensor before the timed drive ended.
  bool arrived_by_current{false};
  // The current sensor saw a stall; the drive is off and the adapter must
  // latch a fault in the engine.
  bool stall{false};
};

class TimedActuator {
 public:
  explicit TimedActuator(TimedActuatorProfile profile,
                         CurrentSenseProfile sense = {}) noexcept;

  // Feeds one motor-current sample. Safe to call at any rate; ignored while
  // the drive is off or when no sensor profile is configured.
  void observe_current(std::int32_t milliamps, std::uint64_t now_ms) noexcept;

  // Applies a core command. Motion commands are rejected, leaving the drive
  // off, when the profile is invalid or the full drive cannot finish before the
  // command's deadline. A zero deadline means none. MotionDisable always stops
  // immediately and is never rejected.
  Rejection accept(const core::Command& command, std::uint64_t now_ms) noexcept;

  // Advances the model. The step carries the drive the outputs must show now
  // and, when a target is reached, the position to report to the engine.
  Step tick(std::uint64_t now_ms) noexcept;

  Drive drive() const noexcept { return drive_; }
  bool busy() const noexcept {
    return drive_ != Drive::Off || pending_ != Drive::Off;
  }
  // True once a drive has completed, so the actuator is known to sit on a
  // switch. False after boot or after a drive stopped early.
  bool position_known() const noexcept { return position_known_; }
  std::int32_t estimated_position_mm(std::uint64_t now_ms) const noexcept;
  // Full drive time for a direction, excluding any reverse pause.
  std::uint32_t required_ms(core::CommandType type) const noexcept;
  const TimedActuatorProfile& profile() const noexcept { return profile_; }
  const CurrentSenseProfile& current_sense() const noexcept { return sense_; }
  std::int32_t last_current_ma() const noexcept { return last_current_ma_; }

 private:
  void stop(std::uint64_t now_ms) noexcept;
  std::uint32_t full_ms(Drive direction) const noexcept;
  void reset_current_tracking() noexcept;

  TimedActuatorProfile profile_;
  CurrentSenseProfile sense_;
  std::int32_t last_current_ma_{0};
  std::uint64_t flow_since_ms_{0};
  bool flowing_{false};
  bool flow_confirmed_{false};
  std::uint64_t low_since_ms_{0};
  bool low_{false};
  std::uint64_t high_since_ms_{0};
  bool high_{false};
  bool arrival_pending_{false};
  bool stall_pending_{false};
  Drive drive_{Drive::Off};
  Drive pending_{Drive::Off};
  Drive last_direction_{Drive::Off};
  std::uint64_t start_at_ms_{0};
  std::uint64_t started_ms_{0};
  std::uint64_t stop_at_ms_{0};
  std::uint64_t last_off_ms_{0};
  bool has_last_off_{false};
  std::int32_t position_mm_{0};
  std::int32_t start_position_mm_{0};
  std::int32_t target_mm_{0};
  bool position_known_{false};
};

const char* drive_name(Drive drive) noexcept;
const char* rejection_name(Rejection rejection) noexcept;

}  // namespace apple::motion
