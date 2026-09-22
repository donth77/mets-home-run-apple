#pragma once

// Applying the owner's settings across the Apple: loading them at boot, the
// time zone, and the Manager's settings form.

#include "apple/firmware/manager.hpp"

#include <Arduino.h>

namespace apple::live {

// Loads the settings and the last celebration from flash and applies the zone.
void load_settings();
void apply_time_zone();
// The Manager's settings form. Empty when the change was applied and stored.
String on_settings(const apple::firmware::SettingsUpdate& update);

}  // namespace apple::live
