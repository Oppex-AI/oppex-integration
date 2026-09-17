// Counts every dropped incident but reports at most one summary per interval.
//
// A saturated queue drops continuously, so logging each drop would replace one
// overload with another. Returning the count instead of logging keeps this class
// free of any logging decision, which is also what makes it testable without
// capturing output.
//
// Not public API.

#ifndef OPPEX_SRC_RATE_LIMITED_DROP_LOGGER_HPP
#define OPPEX_SRC_RATE_LIMITED_DROP_LOGGER_HPP

#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>

namespace oppex {

class RateLimitedDropLogger {
 public:
  using Clock = std::chrono::steady_clock;

  explicit RateLimitedDropLogger(std::chrono::milliseconds interval = std::chrono::minutes(1))
      : interval_(interval), started_at_(Clock::now()) {}

  /// Records one drop, returning the accumulated count when the interval has
  /// elapsed and the caller should report a summary.
  std::optional<std::uint64_t> RecordDrop() {
    const std::lock_guard<std::mutex> lock(mutex_);
    ++dropped_;
    const auto now = Clock::now();
    if (now - started_at_ < interval_) {
      return std::nullopt;
    }
    const std::uint64_t dropped = dropped_;
    dropped_ = 0;
    started_at_ = now;
    return dropped;
  }

 private:
  std::chrono::milliseconds interval_;
  std::mutex mutex_;
  std::uint64_t dropped_ = 0;
  Clock::time_point started_at_;
};

}  // namespace oppex

#endif  // OPPEX_SRC_RATE_LIMITED_DROP_LOGGER_HPP
