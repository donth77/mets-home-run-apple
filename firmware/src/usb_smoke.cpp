#include <Arduino.h>

#include <cstdint>

namespace {

constexpr std::uint32_t kHeartbeatIntervalMs = 1'000;

}  // namespace

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  Serial.begin(115200);
  Serial.println("USB_SMOKE=STARTED");
}

void loop() {
  static std::uint32_t previous_heartbeat_ms = 0;
  static bool led_on = false;

  const std::uint32_t now_ms = millis();
  if (now_ms - previous_heartbeat_ms < kHeartbeatIntervalMs) {
    delay(10);
    return;
  }

  previous_heartbeat_ms = now_ms;
  led_on = !led_on;
  digitalWrite(LED_BUILTIN, led_on ? HIGH : LOW);
  Serial.printf("USB_SMOKE=ALIVE uptime_ms=%lu\n",
                static_cast<unsigned long>(now_ms));
}
