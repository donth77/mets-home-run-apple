#pragma once

// The owner button (kResetButtonPin, to ground). A short press shows the
// address and the code, or approves a pending Apple Lab test; a hold of one
// to three seconds restarts; holding on to ten seconds clears Wi-Fi and the
// settings.

namespace apple::live {

void begin_owner_button();
void show_info_screen();
void service_reset_button();
// Shows and counts down a pending Apple Lab test, or takes the prompt away.
void service_maintenance_prompt();

}  // namespace apple::live
