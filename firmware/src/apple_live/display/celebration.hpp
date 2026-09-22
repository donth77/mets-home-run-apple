#pragma once

// A celebration on the panel: the home run or Mets win animation, its audio,
// and the record of what the lift did. The decision core decides when one
// starts; this draws it until the Apple comes down.

#include "apple/core/engine.hpp"

namespace apple::live {

extern bool celebration_active;

void begin_celebration(const apple::core::CoreEvent& event);
void end_celebration(const char* reason);
void service_celebration();

}  // namespace apple::live
