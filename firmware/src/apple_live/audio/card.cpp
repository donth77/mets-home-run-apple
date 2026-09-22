#include "apple_live/audio/card.hpp"

#include "apple_live/pins.hpp"

namespace apple::live {

// The card's own bus. The display keeps the default one.
SPIClass sd_spi(HSPI);
// The card library is not safe for two cores at once, and the audio task
// streams a win track from the card while the main loop may be refreshing
// its stored copies. Every use of the card takes this lock.
SemaphoreHandle_t sd_lock = nullptr;
bool audio_card_ready = false;

void begin_card_bus() {
  sd_lock = xSemaphoreCreateRecursiveMutex();
  sd_spi.begin(kSdClockPin, kSdMisoPin, kSdMosiPin, kSdChipSelectPin);
}

}  // namespace apple::live
