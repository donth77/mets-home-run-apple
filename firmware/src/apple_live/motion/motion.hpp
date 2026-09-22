#pragma once

// The decision core and the lift: the engine that approves and sequences
// celebrations, the timed actuator model, and the L298N outputs it drives when
// the owner's motor setting is on.

#include "apple/core/engine.hpp"
#include "apple/motion/timed_actuator.hpp"

#include <cstdint>
#include <optional>

namespace apple::live {

extern std::optional<apple::core::Engine> engine;
extern apple::motion::TimedActuator actuator;
extern apple::motion::Drive applied_drive;

void make_engine(apple::core::EventLedger& ledger);
void apply_raised_dwell();
void apply_drive(apple::motion::Drive drive);
void handle_output(const apple::core::EngineOutput& output, std::uint64_t now);
void service_motion(std::uint64_t now);
// No celebration on screen and the sequence at rest.
bool motion_idle();
void stop_motion(const char* reason);

}  // namespace apple::live
