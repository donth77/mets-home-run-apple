#include "apple/motion/timed_actuator.hpp"

#include <algorithm>

namespace apple::motion {

namespace {

Drive direction_for(core::CommandType type) noexcept {
  switch (type) {
    case core::CommandType::MotionExtend:
      return Drive::Extend;
    case core::CommandType::MotionRetract:
      return Drive::Retract;
    case core::CommandType::MotionDisable:
    default:
      return Drive::Off;
  }
}

}  // namespace

TimedActuator::TimedActuator(TimedActuatorProfile profile,
                             CurrentSenseProfile sense) noexcept
    : profile_(profile), sense_(sense) {}

void TimedActuator::reset_current_tracking() noexcept {
  flowing_ = false;
  flow_confirmed_ = false;
  low_ = false;
  high_ = false;
  arrival_pending_ = false;
  stall_pending_ = false;
}

void TimedActuator::observe_current(std::int32_t milliamps,
                                    std::uint64_t now_ms) noexcept {
  last_current_ma_ = milliamps;
  if (drive_ == Drive::Off || !sense_.enabled()) {
    return;
  }

  if (milliamps > sense_.flowing_above_ma) {
    if (!flowing_) {
      flowing_ = true;
      flow_since_ms_ = now_ms;
    }
    if (now_ms - flow_since_ms_ >= sense_.min_flow_ms) {
      flow_confirmed_ = true;
    }
  } else {
    flowing_ = false;
  }

  if (flow_confirmed_ && milliamps < sense_.arrival_below_ma) {
    if (!low_) {
      low_ = true;
      low_since_ms_ = now_ms;
    }
    if (now_ms - low_since_ms_ >= sense_.arrival_hold_ms) {
      arrival_pending_ = true;
    }
  } else {
    low_ = false;
  }

  if (sense_.stall_enabled() && milliamps > sense_.stall_above_ma) {
    if (!high_) {
      high_ = true;
      high_since_ms_ = now_ms;
    }
    if (now_ms - high_since_ms_ >= sense_.stall_ms) {
      stall_pending_ = true;
    }
  } else {
    high_ = false;
  }
}

std::uint32_t TimedActuator::full_ms(Drive direction) const noexcept {
  return direction == Drive::Extend ? profile_.extend_full_ms
                                    : profile_.retract_full_ms;
}

std::uint32_t TimedActuator::required_ms(core::CommandType type) const noexcept {
  const Drive direction = direction_for(type);
  if (direction == Drive::Off) {
    return 0;
  }
  return full_ms(direction) + profile_.overrun_ms;
}

void TimedActuator::stop(std::uint64_t now_ms) noexcept {
  if (drive_ != Drive::Off) {
    position_mm_ = estimated_position_mm(now_ms);
    last_off_ms_ = now_ms;
    has_last_off_ = true;
  }
  drive_ = Drive::Off;
  pending_ = Drive::Off;
  reset_current_tracking();
}

Rejection TimedActuator::accept(const core::Command& command,
                                std::uint64_t now_ms) noexcept {
  const Drive direction = direction_for(command.type);
  if (direction == Drive::Off) {
    stop(now_ms);
    return Rejection::None;
  }
  if (!profile_.valid()) {
    stop(now_ms);
    return Rejection::InvalidProfile;
  }

  // A drive that stops early leaves the position uncertain until the next
  // completed drive.
  const bool was_driving = drive_ != Drive::Off;
  stop(now_ms);
  if (was_driving) {
    position_known_ = false;
  }

  std::uint64_t start_at_ms = now_ms;
  if (has_last_off_ && last_direction_ != Drive::Off &&
      last_direction_ != direction) {
    start_at_ms = std::max(start_at_ms, last_off_ms_ + profile_.reverse_pause_ms);
  }
  const std::uint64_t stop_at_ms =
      start_at_ms + full_ms(direction) + profile_.overrun_ms;
  if (command.deadline_ms != 0 && stop_at_ms > command.deadline_ms) {
    return Rejection::DeadlineTooShort;
  }

  pending_ = direction;
  start_at_ms_ = start_at_ms;
  stop_at_ms_ = stop_at_ms;
  start_position_mm_ = position_mm_;
  target_mm_ = direction == Drive::Extend ? profile_.stroke_mm : 0;
  return Rejection::None;
}

Step TimedActuator::tick(std::uint64_t now_ms) noexcept {
  Step step;
  if (pending_ != Drive::Off && now_ms >= start_at_ms_) {
    drive_ = pending_;
    pending_ = Drive::Off;
    last_direction_ = drive_;
    started_ms_ = now_ms;
    reset_current_tracking();
    step.drive_changed = true;
  } else if (drive_ != Drive::Off && stall_pending_) {
    // The sensor saw a stall: stop without claiming any position.
    position_known_ = false;
    stop(now_ms);
    step.drive_changed = true;
    step.stall = true;
  } else if (drive_ != Drive::Off &&
             (now_ms >= stop_at_ms_ || arrival_pending_)) {
    const bool by_current = arrival_pending_ && now_ms < stop_at_ms_;
    position_mm_ = target_mm_;
    position_known_ = true;
    drive_ = Drive::Off;
    last_off_ms_ = now_ms;
    has_last_off_ = true;
    reset_current_tracking();
    step.drive_changed = true;
    step.report_position = true;
    step.position_mm = target_mm_;
    step.arrived_by_current = by_current;
  }
  step.drive = drive_;
  return step;
}

std::int32_t TimedActuator::estimated_position_mm(
    std::uint64_t now_ms) const noexcept {
  if (drive_ == Drive::Off) {
    return position_mm_;
  }
  const std::uint32_t travel_ms = full_ms(drive_);
  if (travel_ms == 0 || now_ms <= started_ms_) {
    return start_position_mm_;
  }
  const std::uint64_t elapsed_ms = std::min<std::uint64_t>(
      now_ms - started_ms_, travel_ms);
  const std::int64_t delta_mm =
      static_cast<std::int64_t>(profile_.stroke_mm) *
      static_cast<std::int64_t>(elapsed_ms) / travel_ms;
  const std::int64_t position =
      drive_ == Drive::Extend
          ? static_cast<std::int64_t>(start_position_mm_) + delta_mm
          : static_cast<std::int64_t>(start_position_mm_) - delta_mm;
  return static_cast<std::int32_t>(std::clamp<std::int64_t>(
      position, 0, profile_.stroke_mm));
}

const char* drive_name(Drive drive) noexcept {
  switch (drive) {
    case Drive::Extend:
      return "EXTEND";
    case Drive::Retract:
      return "RETRACT";
    case Drive::Off:
    default:
      return "OFF";
  }
}

const char* rejection_name(Rejection rejection) noexcept {
  switch (rejection) {
    case Rejection::InvalidProfile:
      return "INVALID_PROFILE";
    case Rejection::DeadlineTooShort:
      return "DEADLINE_TOO_SHORT";
    case Rejection::None:
    default:
      return "NONE";
  }
}

}  // namespace apple::motion
