#pragma once

// Copy this file to secrets.local.hpp next to it and fill in the home Wi-Fi
// network the Apple should join. *.local.hpp is ignored by git. Leave the
// SSID empty to build without network access; the device then shows a
// "NO WI-FI CREDENTIALS" screen and still supports the serial replay demo.
//
// A 2.4 GHz network is required: the Nano ESP32 radio does not join 5 GHz.

namespace apple::firmware::secrets {

inline constexpr char kWifiSsid[] = "";
inline constexpr char kWifiPassword[] = "";

}  // namespace apple::firmware::secrets
