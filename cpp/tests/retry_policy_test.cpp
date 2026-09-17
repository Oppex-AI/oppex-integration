#include "retry_policy.hpp"

#include <chrono>
#include <string>

#include "interrupt.hpp"
#include "oppex/oppex.hpp"
#include "test_support.hpp"

namespace {

using oppex::ErrorKind;
using oppex::IncidentError;
using oppex::IncidentResponse;
using oppex::Interrupt;
using std::chrono::milliseconds;

const oppex::retry::Delays& FastDelays() {
  static const oppex::retry::Delays kDelays(5, milliseconds(1));
  return kDelays;
}

OPPEX_TEST(TheRetryableStatusListIsExplicit) {
  for (const int status : {429, 500, 502, 503, 504}) {
    OPPEX_ASSERT(oppex::retry::IsRetryableStatus(status));
  }
  for (const int status : {400, 401, 403, 404, 409, 422, 501, 505}) {
    OPPEX_ASSERT(!oppex::retry::IsRetryableStatus(status));
  }
}

OPPEX_TEST(TheScheduleDoublesFromHalfASecond) {
  const oppex::retry::Delays expected{milliseconds(500), milliseconds(1000), milliseconds(2000),
                                      milliseconds(4000), milliseconds(8000)};
  OPPEX_ASSERT(expected == oppex::retry::DefaultDelays());
}

OPPEX_TEST(TheFirstSuccessStopsTheLoop) {
  Interrupt interrupt;
  int attempts = 0;

  const IncidentResponse response =
      oppex::retry::Execute(FastDelays(), interrupt, [&attempts]() -> IncidentResponse {
        ++attempts;
        if (attempts < 3) {
          throw IncidentError(ErrorKind::kDelivery, "503", 503, true);
        }
        IncidentResponse delivered;
        delivered.successful = true;
        return delivered;
      });

  OPPEX_ASSERT_EQ(true, response.successful);
  OPPEX_ASSERT_EQ(3, attempts);
}

OPPEX_TEST(ANonRetryableFailureIsNotRetried) {
  Interrupt interrupt;
  int attempts = 0;

  OPPEX_ASSERT_THROWS(IncidentError,
                      oppex::retry::Execute(FastDelays(), interrupt,
                                            [&attempts]() -> IncidentResponse {
                                              ++attempts;
                                              throw IncidentError(ErrorKind::kDelivery, "401", 401,
                                                                  false);
                                            }));
  OPPEX_ASSERT_EQ(1, attempts);
}

OPPEX_TEST(AnExhaustedHttpFailureKeepsItsOriginalMessage) {
  Interrupt interrupt;
  int attempts = 0;

  try {
    oppex::retry::Execute(FastDelays(), interrupt, [&attempts]() -> IncidentResponse {
      ++attempts;
      throw IncidentError(ErrorKind::kDelivery, "Oppex returned HTTP 503", 503, true);
    });
    OPPEX_ASSERT(false);
  } catch (const IncidentError& failure) {
    OPPEX_ASSERT_EQ(static_cast<int>(FastDelays().size()) + 1, attempts);
    OPPEX_ASSERT_EQ(std::string("Oppex returned HTTP 503"), std::string(failure.what()));
  }
}

OPPEX_TEST(OnlyAFailureThatNeverReachedAStatusLineIsAnnotated) {
  Interrupt interrupt;

  try {
    oppex::retry::Execute(FastDelays(), interrupt, []() -> IncidentResponse {
      throw IncidentError(ErrorKind::kDelivery, "connection refused", oppex::kNoStatusCode, true);
    });
    OPPEX_ASSERT(false);
  } catch (const IncidentError& failure) {
    OPPEX_ASSERT_EQ(std::string("connection refused (after 6 attempts)"),
                    std::string(failure.what()));
  }
}

OPPEX_TEST(ASignalledInterruptEndsTheBackoffImmediately) {
  Interrupt interrupt;
  interrupt.Signal();
  const auto began = std::chrono::steady_clock::now();

  try {
    // The production schedule, deliberately: the point is that the wait is
    // abandoned rather than served.
    oppex::retry::Execute(oppex::retry::DefaultDelays(), interrupt, []() -> IncidentResponse {
      throw IncidentError(ErrorKind::kDelivery, "503", 503, true);
    });
    OPPEX_ASSERT(false);
  } catch (const IncidentError& failure) {
    OPPEX_ASSERT(std::string(failure.what()).find("interrupted") != std::string::npos);
  }

  OPPEX_ASSERT(std::chrono::steady_clock::now() - began < std::chrono::seconds(1));
}

}  // namespace
