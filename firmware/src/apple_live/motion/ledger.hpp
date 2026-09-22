#pragma once

// Persistent ledger of accepted celebration keys. The decision core asks it
// before starting a celebration, so a reboot mid-game never repeats one.

#include "apple/core/engine.hpp"

#include <Arduino.h>
#include <Preferences.h>

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace apple::live {

using apple::core::EventLedger;
using apple::core::LedgerLookup;

constexpr std::size_t kLedgerCapacity = 24;

class NvsLedger final : public EventLedger {
 public:
  void begin() {
    preferences_.begin("ledger", false);
    next_ = preferences_.getUInt("i", 0) % kLedgerCapacity;
    for (std::size_t index = 0; index < kLedgerCapacity; ++index) {
      const String value = preferences_.getString(slot(index).c_str(), "");
      keys_[index] = value.c_str();
    }
  }

  LedgerLookup lookup(std::string_view key) const override {
    for (const std::string& stored : keys_) {
      if (!stored.empty() && stored == key) return LedgerLookup::Present;
    }
    return LedgerLookup::Missing;
  }

  bool persist(std::string_view key) override {
    if (lookup(key) == LedgerLookup::Present) return true;
    keys_[next_] = std::string(key);
    const bool wrote = preferences_.putString(slot(next_).c_str(), keys_[next_].c_str()) > 0;
    next_ = (next_ + 1) % kLedgerCapacity;
    preferences_.putUInt("i", static_cast<std::uint32_t>(next_));
    return wrote;
  }

  std::size_t count() const {
    std::size_t total = 0;
    for (const std::string& stored : keys_) total += stored.empty() ? 0 : 1;
    return total;
  }

 private:
  static std::string slot(std::size_t index) { return "k" + std::to_string(index); }

  Preferences preferences_;
  std::string keys_[kLedgerCapacity];
  std::size_t next_{0};
};

class MemoryLedger final : public EventLedger {
 public:
  LedgerLookup lookup(std::string_view key) const override {
    for (const std::string& stored : keys_) {
      if (stored == key) return LedgerLookup::Present;
    }
    return LedgerLookup::Missing;
  }
  bool persist(std::string_view key) override {
    keys_.emplace_back(key);
    return true;
  }
  void clear() { keys_.clear(); }

 private:
  std::vector<std::string> keys_;
};

// The flash ledger real games use, and a scratch one for replays and Lab tests.
extern NvsLedger nvs_ledger;
extern MemoryLedger replay_ledger;

}  // namespace apple::live
