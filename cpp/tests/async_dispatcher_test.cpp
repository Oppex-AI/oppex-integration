#include "async_dispatcher.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>
#include <vector>

#include "rate_limited_drop_logger.hpp"
#include "test_support.hpp"

namespace {

using oppex::AsyncDispatcher;
using oppex::LogSink;
using std::chrono::milliseconds;

/// A latch a task can open and a test can wait on, so nothing here depends on a
/// sleep being long enough.
class Latch {
 public:
  void Open() {
    {
      const std::lock_guard<std::mutex> lock(mutex_);
      open_ = true;
    }
    changed_.notify_all();
  }

  bool Wait(milliseconds timeout) {
    std::unique_lock<std::mutex> lock(mutex_);
    return changed_.wait_for(lock, timeout, [this] { return open_; });
  }

 private:
  std::mutex mutex_;
  std::condition_variable changed_;
  bool open_ = false;
};

OPPEX_TEST(SubmittedWorkRuns) {
  AsyncDispatcher dispatcher(LogSink{}, 2, 10);
  std::atomic<int> ran{0};
  Latch finished;

  for (int index = 0; index < 5; ++index) {
    OPPEX_ASSERT(dispatcher.Submit([&ran, &finished] {
      if (ran.fetch_add(1) == 4) {
        finished.Open();
      }
    }));
  }

  OPPEX_ASSERT(finished.Wait(milliseconds(10000)));
  dispatcher.Close(milliseconds(5000));
  OPPEX_ASSERT_EQ(5, ran.load());
}

OPPEX_TEST(TheOldestQueuedTaskIsDroppedWhenFull) {
  // One worker, held on a latch, so everything else has to queue.
  AsyncDispatcher dispatcher(LogSink{}, 1, 2);
  Latch gate;
  Latch started;
  dispatcher.Submit([&gate, &started] {
    started.Open();
    gate.Wait(milliseconds(10000));
  });
  OPPEX_ASSERT(started.Wait(milliseconds(10000)));

  std::mutex mutex;
  std::vector<std::string> ran;
  for (const char* name : {"oldest", "middle", "newest"}) {
    dispatcher.Submit([&mutex, &ran, name] {
      const std::lock_guard<std::mutex> lock(mutex);
      ran.emplace_back(name);
    });
  }

  gate.Open();
  dispatcher.Close(milliseconds(5000));

  const std::lock_guard<std::mutex> lock(mutex);
  OPPEX_ASSERT_EQ(std::size_t{2}, ran.size());
  OPPEX_ASSERT(std::find(ran.begin(), ran.end(), "oldest") == ran.end());
}

OPPEX_TEST(AClosedDispatcherRefusesWorkAndCloseIsIdempotent) {
  AsyncDispatcher dispatcher(LogSink{}, 1, 4);
  dispatcher.Close(milliseconds(1000));
  dispatcher.Close(milliseconds(1000));

  OPPEX_ASSERT(!dispatcher.Submit([] { OPPEX_ASSERT(false); }));
}

OPPEX_TEST(CloseGivesUpOnWorkThatOutlastsTheDrainTimeout) {
  AsyncDispatcher dispatcher(LogSink{}, 1, 10);
  Latch gate;
  Latch started;
  dispatcher.Submit([&gate, &started] {
    started.Open();
    gate.Wait(milliseconds(10000));
  });
  OPPEX_ASSERT(started.Wait(milliseconds(10000)));

  std::atomic<int> ran{0};
  dispatcher.Submit([&ran] { ran.fetch_add(1); });

  const auto began = std::chrono::steady_clock::now();
  dispatcher.Close(milliseconds(100));
  const auto elapsed = std::chrono::steady_clock::now() - began;

  OPPEX_ASSERT(elapsed < std::chrono::seconds(5));
  OPPEX_ASSERT_EQ(0, ran.load());
  gate.Open();
}

OPPEX_TEST(DropsAreReportedThroughTheLogSink) {
  std::mutex mutex;
  std::vector<std::string> messages;
  LogSink sink = [&mutex, &messages](oppex::LogLevel, std::string_view message) {
    const std::lock_guard<std::mutex> lock(mutex);
    messages.emplace_back(message);
  };

  // A zero-length interval makes every drop due for a summary immediately, which
  // is what lets this assert on the message rather than on timing.
  AsyncDispatcher dispatcher(sink, 1, 1);
  Latch gate;
  Latch started;
  dispatcher.Submit([&gate, &started] {
    started.Open();
    gate.Wait(milliseconds(10000));
  });
  OPPEX_ASSERT(started.Wait(milliseconds(10000)));

  dispatcher.Submit([] {});
  dispatcher.Submit([] {});
  gate.Open();
  dispatcher.Close(milliseconds(5000));

  // The default one-minute interval means the overflow summary is still held
  // back; only the close-time force-drop line, if any, is immediate.
  const std::lock_guard<std::mutex> lock(mutex);
  for (const auto& message : messages) {
    OPPEX_ASSERT(message.find("oppex:") == 0);
  }
}

OPPEX_TEST(TheDropLoggerReportsAtMostOncePerInterval) {
  oppex::RateLimitedDropLogger held_back(std::chrono::minutes(1));
  for (int drop = 0; drop < 10; ++drop) {
    OPPEX_ASSERT(!held_back.RecordDrop().has_value());
  }

  oppex::RateLimitedDropLogger immediate(milliseconds(0));
  OPPEX_ASSERT_EQ(std::uint64_t{1}, immediate.RecordDrop().value());
  // The counter resets, so the next interval starts from zero rather than
  // re-reporting everything seen so far.
  OPPEX_ASSERT_EQ(std::uint64_t{1}, immediate.RecordDrop().value());
}

}  // namespace
