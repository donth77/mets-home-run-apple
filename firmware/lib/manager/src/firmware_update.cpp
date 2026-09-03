#include "apple/firmware/firmware_update.hpp"

#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>

#include <algorithm>
#include <cstring>

#include "apple/firmware/update_public_key.hpp"
#include "mbedtls/pk.h"

namespace apple::firmware {

bool FirmwareUpdater::begin() {
  if (active_) abort();
  active_ = true;
  failed_ = false;
  error_ = "";
  written_ = 0;
  tail_len_ = 0;
  mbedtls_sha256_init(&sha_);
  mbedtls_sha256_starts_ret(&sha_, 0);
  if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
    failed_ = true;
    error_ = "NO_SPACE";
    return false;
  }
  return true;
}

void FirmwareUpdater::emit(const std::uint8_t* data, std::size_t length) {
  if (failed_ || length == 0) return;
  mbedtls_sha256_update_ret(&sha_, data, length);
  // Update.write takes a mutable pointer but does not modify the bytes.
  if (Update.write(const_cast<std::uint8_t*>(data), length) != length) {
    failed_ = true;
    error_ = Update.hasError() ? "WRITE_FAILED" : "SHORT_WRITE";
    return;
  }
  written_ += length;
}

// Everything but the last kTrailerBytes of the stream is image; the trailer
// only becomes known at the end, so the newest 96 bytes always wait in tail_.
void FirmwareUpdater::write(const std::uint8_t* data, std::size_t length) {
  if (!active_ || failed_) return;
  while (length > 0) {
    if (tail_len_ < kTrailerBytes) {
      const std::size_t take = std::min(kTrailerBytes - tail_len_, length);
      std::memcpy(tail_ + tail_len_, data, take);
      tail_len_ += take;
      data += take;
      length -= take;
      continue;
    }
    if (length >= kTrailerBytes) {
      emit(tail_, kTrailerBytes);
      emit(data, length - kTrailerBytes);
      std::memcpy(tail_, data + length - kTrailerBytes, kTrailerBytes);
    } else {
      emit(tail_, length);
      std::memmove(tail_, tail_ + length, kTrailerBytes - length);
      std::memcpy(tail_ + kTrailerBytes - length, data, length);
    }
    length = 0;
  }
}

bool FirmwareUpdater::verify_trailer() {
  if (tail_len_ < kTrailerBytes || written_ == 0) {
    error_ = "TOO_SMALL";
    return false;
  }
  if (std::memcmp(tail_, "HRAPPLE1", 8) != 0) {
    error_ = "NOT_SIGNED";
    return false;
  }
  const std::uint16_t sig_len = static_cast<std::uint16_t>(tail_[10] | (tail_[11] << 8));
  if (sig_len == 0 || sig_len > kSignatureMax) {
    error_ = "NOT_SIGNED";
    return false;
  }
  std::uint8_t hash[32];
  mbedtls_sha256_finish_ret(&sha_, hash);
  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  const int parsed = mbedtls_pk_parse_public_key(
      &pk, reinterpret_cast<const unsigned char*>(kUpdatePublicKeyPem), std::strlen(kUpdatePublicKeyPem) + 1);
  bool ok = false;
  if (parsed == 0) {
    ok = mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, hash, sizeof(hash), tail_ + kTrailerBytes - kSignatureMax,
                           sig_len) == 0;
  }
  mbedtls_pk_free(&pk);
  if (!ok) error_ = parsed == 0 ? "BAD_SIGNATURE" : "NO_PUBLIC_KEY";
  return ok;
}

bool FirmwareUpdater::end() {
  if (!active_) return false;
  active_ = false;
  mbedtls_sha256_context* sha = &sha_;
  const bool verified = !failed_ && verify_trailer();
  mbedtls_sha256_free(sha);
  if (!verified) {
    Update.abort();
    return false;
  }
  if (!Update.end(true)) {
    error_ = "COMMIT_FAILED";
    return false;
  }
  return true;
}

void FirmwareUpdater::abort() {
  if (!active_) return;
  active_ = false;
  mbedtls_sha256_free(&sha_);
  Update.abort();
  error_ = "ABORTED";
}

const char* running_partition_label() {
  const esp_partition_t* running = esp_ota_get_running_partition();
  return running != nullptr ? running->label : "";
}

bool boot_from_partition(const char* label) {
  if (label == nullptr || label[0] == '\0') return false;
  const esp_partition_t* target =
      esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, label);
  if (target == nullptr) return false;
  return esp_ota_set_boot_partition(target) == ESP_OK;
}

}  // namespace apple::firmware
