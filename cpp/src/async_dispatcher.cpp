#include "async_dispatcher.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <utility>

namespace oppex {

AsyncDispatcher::AsyncDispatcher(LogSink log_sink, std::size_t worker_count, std::size_t capacity)
    : log_sink_(std::move(log_sink)), capacity_(capacity) {
  workers_.reserve(worker_count);
  for (std::size_t index = 0; index < worker_count; ++index) {
    workers_.emplace_back([this] { Work(); });
  }
}

AsyncDispatcher::~AsyncDispatcher() {
  Close(kCloseDrainTimeout);
  for (auto& worker : workers_) {
    if (worker.joinable()) {
      worker.join();
    }
  }
}

bool AsyncDispatcher::Submit(Task task) {
  std::optional<std::uint64_t> dropped;
  {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (!accepting_) {
      return false;
    }
    if (tasks_.size() >= capacity_) {
      tasks_.pop_front();
      dropped = drop_logger_.RecordDrop();
    }
    tasks_.push_back(std::move(task));
  }
  changed_.notify_one();

  if (dropped.has_value() && log_sink_) {
    log_sink_(LogLevel::kWarning,
              "oppex: dropped " + std::to_string(*dropped) + " incidents in the last minute");
  }
  return true;
}

void AsyncDispatcher::Close(std::chrono::milliseconds timeout) noexcept {
  std::size_t abandoned = 0;
  {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!accepting_) {
      return;
    }
    accepting_ = false;

    changed_.wait_for(lock, timeout, [this] { return tasks_.empty() && active_ == 0; });

    // Stops the workers whether or not the queue emptied. A thread cannot be
    // interrupted, so a worker blocked in an HTTP attempt finishes that attempt
    // on its own; the attempt timeout already bounds how long that takes.
    draining_ = false;
    abandoned = tasks_.size();
    tasks_.clear();
  }
  changed_.notify_all();

  // Reported once and directly, rather than through the rate-limited overflow
  // counter: a shutdown loss and an overload loss are different events, and a
  // rate-limited counter's last batch can go unreported.
  if (abandoned > 0 && log_sink_) {
    log_sink_(LogLevel::kWarning, "oppex: force-dropped " + std::to_string(abandoned) +
                                      " pending incidents during close");
  }
}

void AsyncDispatcher::Work() {
  while (true) {
    Task task;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      changed_.wait(lock, [this] { return !tasks_.empty() || !draining_; });
      if (tasks_.empty()) {
        return;
      }
      task = std::move(tasks_.front());
      tasks_.pop_front();
      ++active_;
    }

    // A task owns its own error handling; see Client::Submit, which wraps every
    // task in a catch-all before it reaches here.
    task();

    {
      const std::lock_guard<std::mutex> lock(mutex_);
      --active_;
    }
    changed_.notify_all();
  }
}

}  // namespace oppex
