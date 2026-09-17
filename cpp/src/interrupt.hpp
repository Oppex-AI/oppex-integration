// A one-way "stop waiting" signal. Not public API.
//
// A sleeping thread cannot be interrupted in C++, so a backoff delay waits on
// this condition variable instead of calling std::this_thread::sleep_for.
// Closing the client signals it once, which wakes every waiting retry
// immediately rather than after up to eight more seconds.

#ifndef OPPEX_SRC_INTERRUPT_HPP
#define OPPEX_SRC_INTERRUPT_HPP

#include <chrono>
#include <condition_variable>
#include <mutex>

namespace oppex {

class Interrupt {
 public:
  /// Signals every current and future waiter. Idempotent.
  void Signal() {
    {
      const std::lock_guard<std::mutex> lock(mutex_);
      signalled_ = true;
    }
    changed_.notify_all();
  }

  /// Waits up to `duration`. Returns true when the wait was cut short by a
  /// signal, false when the full duration elapsed.
  bool Wait(std::chrono::milliseconds duration) {
    std::unique_lock<std::mutex> lock(mutex_);
    return changed_.wait_for(lock, duration, [this] { return signalled_; });
  }

 private:
  std::mutex mutex_;
  std::condition_variable changed_;
  bool signalled_ = false;
};

}  // namespace oppex

#endif  // OPPEX_SRC_INTERRUPT_HPP
