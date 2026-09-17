// The retry policy. Not public API.

#ifndef OPPEX_SRC_RETRY_POLICY_HPP
#define OPPEX_SRC_RETRY_POLICY_HPP

#include <chrono>
#include <functional>
#include <vector>

#include "interrupt.hpp"
#include "oppex/oppex.hpp"

namespace oppex::retry {

using Delays = std::vector<std::chrono::milliseconds>;

/// Five retries after the first attempt, doubling, without jitter. Deliberately
/// not configurable.
[[nodiscard]] const Delays& DefaultDelays();

/// An explicit list rather than "any 5xx". Widening it is a deliberate policy
/// change, not an incidental one.
[[nodiscard]] bool IsRetryableStatus(int status) noexcept;

/// Runs `operation` until it succeeds, fails with a non-retryable error, or
/// exhausts `delays`.
///
/// Only the final failure is thrown. Individual attempts are never logged, so a
/// saturated Oppex API cannot flood the host's logs.
IncidentResponse Execute(const Delays& delays, Interrupt& interrupt,
                         const std::function<IncidentResponse()>& operation);

}  // namespace oppex::retry

#endif  // OPPEX_SRC_RETRY_POLICY_HPP
