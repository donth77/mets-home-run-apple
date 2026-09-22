#include "apple/firmware/diagnostics.hpp"

#include "apple/core/engine.hpp"
#include "apple/firmware/board_pins.hpp"

#include <Arduino.h>
#include <WiFi.h>
#include <esp_system.h>

#include <cstdint>
#include <string_view>

namespace apple::firmware {
namespace {

constexpr std::uint32_t kHeartbeatIntervalMs = 5'000;
constexpr char kDiagnosticFirmwareVersion[] = "0.1.0";

class DiagnosticLedger final : public core::EventLedger {
 public:
  core::LedgerLookup lookup(std::string_view) const override {
    return core::LedgerLookup::Missing;
  }

  bool persist(std::string_view) override { return false; }
};

const char* reset_reason_name(esp_reset_reason_t reason) noexcept {
  switch (reason) {
    case ESP_RST_POWERON:
      return "power_on";
    case ESP_RST_EXT:
      return "external_pin";
    case ESP_RST_SW:
      return "software";
    case ESP_RST_PANIC:
      return "panic";
    case ESP_RST_INT_WDT:
      return "interrupt_watchdog";
    case ESP_RST_TASK_WDT:
      return "task_watchdog";
    case ESP_RST_WDT:
      return "other_watchdog";
    case ESP_RST_DEEPSLEEP:
      return "deep_sleep";
    case ESP_RST_BROWNOUT:
      return "brownout";
    case ESP_RST_SDIO:
      return "sdio";
    case ESP_RST_UNKNOWN:
    default:
      return "unknown";
  }
}

void print_core_link_check() {
  DiagnosticLedger ledger;
  core::Engine engine(ledger);

  Serial.println("CORE_LINK=OK");
  Serial.printf("CORE_SCHEMA_VERSION=%ld\n",
                static_cast<long>(core::kSchemaVersion));
  Serial.printf("CORE_SEQUENCE_STATE=%s\n",
                core::sequence_state_name(engine.sequence_state()));
  Serial.printf("CORE_RAISED_DWELL_MS=%llu\n",
                static_cast<unsigned long long>(core::kRaisedDwellMs));
  Serial.printf("CORE_MAX_STROKE_MM=%ld\n",
                static_cast<long>(core::kMaxStrokeMm));
}

bool scan_wifi_without_names() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, false);
  delay(100);

  Serial.println("WIFI_SCAN=STARTED");
  const int network_count = WiFi.scanNetworks();
  if (network_count < 0) {
    Serial.printf("WIFI_SCAN=FAILED:%d\n", network_count);
    WiFi.mode(WIFI_OFF);
    return false;
  }

  int strongest_rssi = -127;
  int strongest_channel = 0;
  for (int index = 0; index < network_count; ++index) {
    const int rssi = WiFi.RSSI(index);
    if (rssi > strongest_rssi) {
      strongest_rssi = rssi;
      strongest_channel = WiFi.channel(index);
    }
  }

  Serial.printf("WIFI_SCAN_COUNT=%d\n", network_count);
  if (network_count > 0) {
    Serial.printf("WIFI_SCAN_STRONGEST_RSSI_DBM=%d\n", strongest_rssi);
    Serial.printf("WIFI_SCAN_STRONGEST_CHANNEL=%d\n", strongest_channel);
  }
  Serial.println("WIFI_SCAN=OK");

  WiFi.scanDelete();
  WiFi.mode(WIFI_OFF);
  return true;
}

void blink_status_led() {
#if defined(LED_BUILTIN)
  pinMode(LED_BUILTIN, OUTPUT);
  for (int pulse = 0; pulse < 3; ++pulse) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(120);
    digitalWrite(LED_BUILTIN, LOW);
    delay(120);
  }
#endif
}

}  // namespace

void run_boot_diagnostics() {
  Serial.println();
  Serial.println("NANO_ESP32_BOOT_OK");
  Serial.println("DIAGNOSTIC_MODE=USB_ONLY_DISARMED");
  Serial.printf("DIAGNOSTIC_FIRMWARE_VERSION=%s\n",
                kDiagnosticFirmwareVersion);
  Serial.println("MOTION_OUTPUTS=LOW");
  Serial.printf("RESET_REASON=%s\n", reset_reason_name(esp_reset_reason()));
  Serial.printf("CHIP_MODEL=%s\n", ESP.getChipModel());
  Serial.printf("CHIP_REVISION=%d\n", ESP.getChipRevision());
  Serial.printf("CPU_MHZ=%u\n", ESP.getCpuFreqMHz());
  Serial.printf("FLASH_BYTES=%u\n", ESP.getFlashChipSize());
  Serial.printf("PSRAM_BYTES=%u\n", ESP.getPsramSize());
  Serial.printf("FREE_HEAP_BYTES=%u\n", ESP.getFreeHeap());
  Serial.printf("ESP_IDF_VERSION=%s\n", ESP.getSdkVersion());

  print_core_link_check();
  blink_status_led();
  const bool wifi_scan_ok = scan_wifi_without_names();

  disarm_motion_outputs();
  Serial.printf("DIAGNOSTIC_RESULT=%s\n", wifi_scan_ok ? "PASS" : "FAIL");
  Serial.println("SERIAL_COMMAND=d:rerun_diagnostics");
  Serial.println("DIAG_END");
}

void service_diagnostics(std::uint32_t now_ms) {
  static std::uint32_t previous_heartbeat_ms = 0;

  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    if (command == 'd' || command == 'D') {
      run_boot_diagnostics();
    }
  }

  if (now_ms - previous_heartbeat_ms < kHeartbeatIntervalMs) {
    return;
  }

  previous_heartbeat_ms = now_ms;
  disarm_motion_outputs();
  Serial.printf("HEARTBEAT uptime_ms=%lu motion=DISARMED free_heap=%u\n",
                static_cast<unsigned long>(now_ms), ESP.getFreeHeap());
}

}  // namespace apple::firmware
