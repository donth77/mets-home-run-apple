#pragma once

// The Apple Manager web server, and the hooks that connect its pages and
// endpoints to the rest of the firmware.

#include "apple/firmware/manager.hpp"

namespace apple::live {

extern apple::firmware::ManagerServer manager;

// Starts the server with every hook. Needs the TCP/IP stack, which WiFi.mode()
// brings up.
void start_manager();

}  // namespace apple::live
