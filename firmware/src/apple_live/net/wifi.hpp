#pragma once

// Joining the owner's Wi-Fi, the setup network for first boot and changed
// passwords, and setting the clock over NTP once the Apple is online.

#include "apple/firmware/manager.hpp"

#include <Arduino.h>

#include <cstdint>

namespace apple::live {

enum class NetState : std::uint8_t { NoCredentials, Connecting, Connected, Lost, Failed };
extern NetState net_state;
extern apple::firmware::WifiCredentials credentials;

const char* net_state_name();
void start_wifi();
void on_join_request(const String& ssid, const String& password, const String& time_zone);
void on_forget_request();
void service_wifi();

}  // namespace apple::live
