// Delivers queued incidents on a fixed number of worker threads, holding the rest
// in a bounded queue that drops the oldest entry once full. Not public API.
//
// Dropping the oldest keeps the newest incident, which is the one most likely to
// still matter, and submission never blocks the application.

#ifndef OPPEX_SRC_ASYNC_DISPATCHER_HPP
#define OPPEX_SRC_ASYNC_DISPATCHER_HPP

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

#include "oppex/oppex.hpp"
#include "rate_limited_drop_logger.hpp"

namespace oppex {

inline constexpr std::size_t kQueueCapacity = 5000;
inline constexpr std::size_t kWorkerCount = 2;
inline constexpr std::chrono::seconds kCloseDrainTimeout{10};

class AsyncDispatcher {
 public:
  using Task = std::function<void()>;

  AsyncDispatcher(LogSink log_sink, std::size_t worker_count = kWorkerCount,
                  std::size_t capacity = kQueueCapacity);
  ~AsyncDispatcher();

  AsyncDispatcher(const AsyncDispatcher&) = delete;
  AsyncDispatcher& operator=(const AsyncDispatcher&) = delete;

  /// Queues a task, evicting the oldest queued task when the queue is full.
  /// Returns whether the task was accepted; only a closed dispatcher refuses.
  bool Submit(Task task);

  /// Stops admitting work and drains what is already queued and in flight for up
  /// to `timeout`, then abandons the rest. Idempotent and safe from any thread.
  void Close(std::chrono::milliseconds timeout) noexcept;

 private:
  void Work();

  LogSink log_sink_;
  std::size_t capacity_;
  RateLimitedDropLogger drop_logger_;

  // One mutex guards the queue and every lifecycle flag together. Splitting them
  // would reintroduce the missed-wakeup race: a worker reads `draining_`, Close
  // clears it and notifies, and only then does the worker start waiting, on a
  // notification that already happened.
  std::mutex mutex_;
  std::condition_variable changed_;
  std::deque<Task> tasks_;
  bool accepting_ = true;
  bool draining_ = true;
  std::size_t active_ = 0;

  std::vector<std::thread> workers_;
};

}  // namespace oppex

#endif  // OPPEX_SRC_ASYNC_DISPATCHER_HPP
