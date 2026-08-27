#include "apple/core/types.hpp"

namespace apple::core {

const char* command_type_name(CommandType type) noexcept {
  switch (type) {
    case CommandType::MotionExtend:
      return "MOTION_EXTEND";
    case CommandType::MotionRetract:
      return "MOTION_RETRACT";
    case CommandType::MotionDisable:
      return "MOTION_DISABLE";
  }
  return "UNKNOWN";
}

const char* sequence_state_name(SequenceState state) noexcept {
  switch (state) {
    case SequenceState::Idle:
      return "IDLE";
    case SequenceState::LeadIn:
      return "LEAD_IN";
    case SequenceState::ReviewHold:
      return "REVIEW_HOLD";
    case SequenceState::Extending:
      return "EXTENDING";
    case SequenceState::Raised:
      return "RAISED";
    case SequenceState::Retracting:
      return "RETRACTING";
    case SequenceState::Fault:
      return "FAULT";
  }
  return "UNKNOWN";
}

}  // namespace apple::core
