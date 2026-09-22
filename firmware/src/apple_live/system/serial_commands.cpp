#include "apple_live/system/serial_commands.hpp"

#include "apple_live/audio/track_library.hpp"
#include "apple_live/game/following.hpp"
#include "apple_live/game/live_feed.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/updates.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/owner_button.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/status.hpp"
#include "apple_live/system/trace.hpp"

#include <Arduino.h>

namespace apple::live {

void handle_serial() {
  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    switch (command) {
      case '?':
        publish_hello();
        publish_status();
        break;
      case 'x':
      case 'X':
        stop_motion("SERIAL_STOP");
        break;
      case 'r':
      case 'R':
        publish_trace("MAINTENANCE_REQUIRED", "request a test in Apple Lab, then press the owner button");
        break;
      case 's':
      case 'S':
        next_schedule_ms = now32();
        break;
      case 'p':
      case 'P':
        next_poll_ms = now32();
        break;
      case 'u':
      case 'U':
        release.check_requested = true;
        break;
      case 'a':
      case 'A':
        mount_audio_card();
        break;
      case 'w':
      case 'W':
        on_forget_request();
        break;
      case 'i':
      case 'I':
        show_info_screen();
        break;
      default:
        break;
    }
  }
}

}  // namespace apple::live
