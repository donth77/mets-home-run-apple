#include "apple_live/system/boot_guard.hpp"

#include "apple_live/system/clock.hpp"
#include "apple_live/system/trace.hpp"

#include "apple/firmware/firmware_update.hpp"

#include <Arduino.h>
#include <Preferences.h>

namespace apple::live {
namespace {

// Three boots in a row that die before this many seconds pass means the
// network or Manager startup is crashing; the next boot skips them so the
// USB flasher (which runs inside this app) stays reachable.
constexpr std::uint32_t kBootSettleMs = 30'000;
// A freshly installed firmware counts as proven once it has fetched the
// schedule, or after this long without one (no Wi-Fi is not its fault).
constexpr std::uint32_t kBootConfirmMaxMs = 5 * 60 * 1000;
constexpr std::uint32_t kEarlyCrashLimit = 3;

Preferences boot_guard;
bool schedule_ok_since_boot = false;  // the network path works on this firmware
std::uint32_t restart_at_ms = 0;   // set after an update is written

}  // namespace

bool safe_mode = false;
bool boot_settled = false;
bool update_pending_boot = false;  // a wireless update has not proven itself yet

void guard_boot() {
  boot_guard.begin("boot", false);
  const std::uint32_t early_crashes = boot_guard.getUInt("early", 0);
  boot_guard.putUInt("early", early_crashes + 1);
  update_pending_boot = boot_guard.getBool("pending", false);
  if (update_pending_boot && early_crashes >= 2) {
    // The freshly installed firmware crashed twice before settling: boot the
    // previous slot again and forget the update.
    const String previous = boot_guard.getString("prev", "");
    boot_guard.putBool("pending", false);
    boot_guard.putUInt("early", 0);
    update_pending_boot = false;
    if (apple::firmware::boot_from_partition(previous.c_str())) {
      Serial.println("APPLE_LIVE:{\"type\":\"trace\",\"code\":\"UPDATE\",\"detail\":\"new firmware kept crashing; rolling back\"}");
      Serial.flush();
      delay(100);
      ESP.restart();
    }
  }
  safe_mode = early_crashes >= kEarlyCrashLimit;
#ifdef APPLE_UPDATE_CRASH_TEST
  // Build with -DAPPLE_UPDATE_CRASH_TEST to prove the rollback: this image
  // dies on every boot, so the guard must fall back to the previous slot.
  Serial.println("APPLE_LIVE:{\"type\":\"trace\",\"code\":\"BOOT\",\"detail\":\"crash test build: aborting\"}");
  Serial.flush();
  abort();
#endif
}

void service_boot_guard(std::uint64_t now) {
  if (!boot_settled && now >= kBootSettleMs) {
    boot_settled = true;
    // With an unproven firmware, crashes keep counting until it is confirmed.
    if (!update_pending_boot) boot_guard.putUInt("early", 0);
  }
  if (update_pending_boot && boot_settled && (schedule_ok_since_boot || now >= kBootConfirmMaxMs)) {
    update_pending_boot = false;
    boot_guard.putBool("pending", false);
    boot_guard.putUInt("early", 0);
    publish_trace("UPDATE", schedule_ok_since_boot ? "new firmware confirmed: schedule fetched" : "new firmware confirmed");
  }
  if (restart_at_ms != 0 && due(restart_at_ms)) {
    Serial.flush();
    ESP.restart();
  }
}

void note_schedule_fetched() { schedule_ok_since_boot = true; }

void note_update_installed() {
  boot_guard.putBool("pending", true);
  boot_guard.putString("prev", apple::firmware::running_partition_label());
  boot_guard.putUInt("early", 0);
}

void request_restart(std::uint32_t delay_ms) { restart_at_ms = now32() + delay_ms; }

}  // namespace apple::live
