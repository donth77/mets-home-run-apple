#pragma once

// Firmware updates: an image uploaded from the Manager page, and releases the
// Apple finds on GitHub and installs between games.

#include "apple/firmware/release_pick.hpp"

#include <Arduino.h>

#include <cstdint>

namespace apple::live {

// How soon after joining Wi-Fi the Apple first checks GitHub for a release.
constexpr std::uint32_t kReleaseFirstCheckMs = 90 * 1000;

enum class ReleaseState : std::uint8_t { Idle, Checking, UpToDate, Available, Downloading, Failed };
struct ReleaseStatus {
  ReleaseState state{ReleaseState::Idle};
  apple::firmware::ReleasePick pick;
  std::int64_t checked_at{0};      // epoch seconds of the last completed check
  std::uint32_t next_check_ms{0};  // 0 until Wi-Fi is up
  bool check_requested{false};
  bool install_requested{false};
  char error[40] = "";
};
extern ReleaseStatus release;

// Empty when an update may start now; otherwise a short reason for the page.
String update_gate();
void on_update_done();
String on_restart_request();
const char* release_state_name(ReleaseState state);
bool install_window_open();
void service_release();
String on_check_request();
String on_install_request();

}  // namespace apple::live
