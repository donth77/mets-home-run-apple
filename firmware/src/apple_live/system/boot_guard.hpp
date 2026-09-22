#pragma once

// Every boot counts as an early crash until it has run for a while. A freshly
// installed update that keeps crashing is rolled back to the previous slot,
// and repeated early crashes start the Apple in safe mode, without the
// network or the Manager, so the USB flasher stays reachable.

#include <cstdint>

namespace apple::live {

// Written only by the boot guard.
extern bool safe_mode;
extern bool boot_settled;
extern bool update_pending_boot;  // a wireless update has not proven itself yet

// Counts this boot, rolls back an update that keeps crashing, and decides on
// safe mode. Runs in setup() before anything that can block.
void guard_boot();
// Settles the boot, confirms a pending update, and restarts when asked to.
void service_boot_guard(std::uint64_t now);
// The schedule was fetched: the network path works on this firmware.
void note_schedule_fetched();
// A new image is in the other slot: boot it next, falling back to this one.
void note_update_installed();
// Restarts from the main loop after delay_ms.
void request_restart(std::uint32_t delay_ms);

}  // namespace apple::live
