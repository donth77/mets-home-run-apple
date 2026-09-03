#pragma once

#include <Arduino.h>

#include <cstddef>
#include <cstdint>

#include "mbedtls/sha256.h"

namespace apple::firmware {

/// Streams a signed firmware file into the spare OTA slot. The last 96 bytes
/// of the file are a signature trailer (see tools/sign_firmware.py); the
/// image before it is hashed as it is written and the signature is checked
/// against the built-in public key before the slot is made bootable.
class FirmwareUpdater {
 public:
  static constexpr std::size_t kTrailerBytes = 96;
  static constexpr std::size_t kSignatureMax = 72;

  bool begin();
  void write(const std::uint8_t* data, std::size_t length);
  /// Verifies the signature and commits. Returns false with `error()` set.
  bool end();
  void abort();

  bool active() const { return active_; }
  std::size_t written() const { return written_; }
  const char* error() const { return error_; }

 private:
  void emit(const std::uint8_t* data, std::size_t length);
  bool verify_trailer();

  bool active_{false};
  bool failed_{false};
  const char* error_{""};
  std::size_t written_{0};
  std::uint8_t tail_[kTrailerBytes]{};
  std::size_t tail_len_{0};
  mbedtls_sha256_context sha_{};
};

/// Label of the partition the running firmware came from ("app0"/"app1").
const char* running_partition_label();
/// Makes `label` the boot partition again; used to roll back a bad update.
bool boot_from_partition(const char* label);

}  // namespace apple::firmware
