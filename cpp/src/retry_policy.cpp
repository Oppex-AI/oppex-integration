#include "retry_policy.hpp"

namespace oppex::retry {
namespace {

using std::chrono::milliseconds;

/// Annotates only a failure that never reached a status line. An HTTP failure
/// keeps the message its status already explains.
[[noreturn]] void RethrowWithAttemptCount(const IncidentError& failure, std::size_t attempts) {
  if (failure.has_http_status() || attempts < 2) {
    throw failure;
  }
  throw IncidentError(failure.kind(),
                      std::string(failure.what()) + " (after " + std::to_string(attempts) +
                          " attempts)",
                      failure.status_code(), failure.retryable());
}

}  // namespace

const Delays& DefaultDelays() {
  static const Delays kDelays{milliseconds(500), milliseconds(1000), milliseconds(2000),
                              milliseconds(4000), milliseconds(8000)};
  return kDelays;
}

bool IsRetryableStatus(int status) noexcept {
  return status == 429 || status == 500 || status == 502 || status == 503 || status == 504;
}

IncidentResponse Execute(const Delays& delays, Interrupt& interrupt,
                         const std::function<IncidentResponse()>& operation) {
  for (std::size_t attempt = 0;; ++attempt) {
    try {
      return operation();
    } catch (const IncidentError& failure) {
      if (!failure.retryable() || attempt >= delays.size()) {
        RethrowWithAttemptCount(failure, attempt + 1);
      }
      if (interrupt.Wait(delays[attempt])) {
        throw IncidentError(ErrorKind::kDelivery,
                            "incident delivery was interrupted during retry");
      }
    }
  }
}

}  // namespace oppex::retry
