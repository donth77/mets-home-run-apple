#pragma once

// Identity of the autonomous Apple firmware. The release workflow reads
// kFirmwareVersion from this file.

namespace apple::live {

constexpr char kProfileName[] = "apple_live";
#ifdef APPLE_UPDATE_CRASH_TEST
constexpr char kFirmwareVersion[] = "0.2.2-crashtest";
#else
constexpr char kFirmwareVersion[] = "0.4.9";
#endif
constexpr char kHostname[] = "home-run-apple";

}  // namespace apple::live
