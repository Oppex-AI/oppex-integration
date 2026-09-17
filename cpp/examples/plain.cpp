// Posts one incident synchronously and queues one more.
//
//   OPPEX_API_KEY=... OPPEX_SERVICE_KEY=... ./oppex_example_plain

#include <cstdlib>
#include <iostream>

#include "oppex/oppex.hpp"

namespace {

std::string Required(const char* name) {
  const char* value = std::getenv(name);
  if (value == nullptr || *value == '\0') {
    throw std::runtime_error(std::string(name) + " is not set");
  }
  return value;
}

}  // namespace

int main() {
  try {
    oppex::ClientOptions options;
    options.api_key = Required("OPPEX_API_KEY");
    options.service_key = Required("OPPEX_SERVICE_KEY");
    options.log_sink = [](oppex::LogLevel, std::string_view message) {
      std::clog << message << "\n";
    };

    // The destructor closes, draining queued incidents for up to ten seconds.
    oppex::Client client(std::move(options));

    oppex::IncidentRequest request;
    request.title = "Checkout latency breached the SLO";
    request.source = "checkout-api";
    request.severity = oppex::Severity::kHigh;
    request.priority = 2;
    request.component = "payments";
    request.group = "platform";
    request.type = "latency";
    request.details = R"({"p99Millis":1200,"threshold":800})";

    const oppex::IncidentResponse response = client.Post(request);
    std::cout << "incident " << response.incident_id.value_or("(none)") << " created (code "
              << response.code << ")\n";

    // Fire and forget. Validation still fails fast here; a delivery failure
    // after this point is logged rather than thrown.
    oppex::IncidentRequest queued;
    queued.title = "Background job queue is backing up";
    queued.source = "worker";
    queued.severity = oppex::Severity::kLow;
    client.PostAsync(std::move(queued));
    return 0;
  } catch (const std::exception& failure) {
    std::cerr << "oppex example failed: " << failure.what() << "\n";
    return 1;
  }
}
