#pragma once

#include <cstdint>
#include <string>
#include <utility>

namespace apple::firmware {

// Transport-independent, single-use permission. Caller supplies monotonic time,
// authenticated requests, and unpredictable per-request tokens. Only the physical
// button handler may call confirm(); no network or serial command can do so.
class MaintenanceSession {
 public:
  static constexpr std::uint32_t kPresenceWindowMs = 30'000;
  static constexpr std::uint32_t kSessionWindowMs = 60'000;

  bool request(bool authenticated, std::string token, std::uint32_t now) {
    if (!authenticated || token.empty()) return false;
    token_ = std::move(token);
    started_ = now;
    armed_ = false;
    return true;
  }
  bool pending(std::uint32_t now) const {
    return !token_.empty() && !armed_ && now - started_ < kPresenceWindowMs;
  }
  bool armed(std::uint32_t now) const {
    return !token_.empty() && armed_ && now - started_ < kSessionWindowMs;
  }
  std::uint32_t remaining_ms(std::uint32_t now) const {
    if (pending(now)) return kPresenceWindowMs - (now - started_);
    if (armed(now)) return kSessionWindowMs - (now - started_);
    return 0;
  }
  bool confirm(std::uint32_t now) {
    if (!pending(now)) return false;
    armed_ = true;
    started_ = now;
    return true;
  }
  bool consume(const std::string& token, std::uint32_t now) {
    if (!armed(now) || token.empty() || token != token_) return false;
    clear();
    return true;
  }
  bool cancel(const std::string& token) {
    if (token.empty() || token != token_) return false;
    clear();
    return true;
  }
  // Call on the device loop, including while disconnected, to retire expired
  // credentials permanently rather than letting them survive a later wrap.
  void expire(std::uint32_t now) { if (!pending(now) && !armed(now)) clear(); }
  void clear() { token_.clear(); armed_ = false; }

 private:
  std::string token_;
  std::uint32_t started_{0};
  bool armed_{false};
};

}  // namespace apple::firmware
