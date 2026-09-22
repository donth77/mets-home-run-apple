#pragma once

// What the Apple reports about itself: the hello line at boot, and the status
// the Manager page, Apple Lab and the serial console read.

#include <ArduinoJson.h>

namespace apple::live {

// Remembers the task setup() runs on, which is the one loop() runs on, so
// the status can report how close it has come to its stack limit.
void note_loop_task();
void publish_hello();
void fill_status(JsonDocument& doc);
// fill_status() as one serial line.
void publish_status();

}  // namespace apple::live
