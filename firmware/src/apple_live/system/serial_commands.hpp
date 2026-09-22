#pragma once

// Single-key commands on the USB serial console: `?` status, `x` stop motion,
// `r` explain how to run a hardware test, `s` refresh the schedule, `p` poll
// the feed, `u` check for a release, `a` remount the card, `w` forget Wi-Fi,
// `i` show the info screen.

namespace apple::live {

void handle_serial();

}  // namespace apple::live
