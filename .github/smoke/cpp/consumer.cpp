// Exercises the installed C++ SDK surface from outside its own project,
// mirroring .github/smoke/java/ExternalConsumer.java: only supported API,
// network-free, and a fixed sentinel the workflow greps for.
//
// "Network-free" does not mean "never attempts an HTTP call". Port 1 on loopback
// refuses the connection immediately, so a fully valid request pointed at it
// still reaches the real transport and fails there, genuinely exercising that
// path without touching the actual Oppex service.

#include <oppex/oppex.hpp>

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void Require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

oppex::IncidentRequest MakeRequest(const std::string& title) {
  oppex::IncidentRequest request;
  request.title = title;
  request.source = "github-actions";
  request.severity = oppex::Severity::kMedium;
  return request;
}

// Reaches the actual transport and requires it to fail with a connection
// refusal, not a validation error.
void CheckRealTransportFailure() {
  ::setenv("OPPEX_TEST_ENDPOINT_URL", "http://127.0.0.1:1", 1);

  oppex::ClientOptions options;
  options.api_key = "wrong-api-key";
  options.service_key = "wrong-service-key";
  oppex::Client client(std::move(options));

  try {
    (void)client.Post(MakeRequest("valid title"));
    Require(false, "a refused connection must fail");
  } catch (const oppex::IncidentError& failure) {
    Require(failure.kind() == oppex::ErrorKind::kDelivery, "a refused connection must be a delivery failure");
    Require(!failure.has_http_status(), "a refused connection must carry no HTTP status");
    // Five retries plus the first attempt, so the message carries the count.
    Require(std::string(failure.what()).find("attempts") != std::string::npos,
            "an exhausted network failure must report its attempts");
  }

  ::unsetenv("OPPEX_TEST_ENDPOINT_URL");
}

void CheckValidation() {
  oppex::ClientOptions options;
  options.api_key = "external-consumer-api-key";
  options.service_key = "external-consumer-service-key";
  oppex::Client client(std::move(options));

  // A blank title fails before any HTTP attempt.
  try {
    (void)client.Post(MakeRequest("   "));
    Require(false, "a blank title must be rejected");
  } catch (const oppex::IncidentError& failure) {
    Require(failure.kind() == oppex::ErrorKind::kInvalidRequest, "a blank title must be invalid");
  }

  client.Close();
  try {
    (void)client.Post(MakeRequest("Closed client test"));
    Require(false, "a post after Close must fail");
  } catch (const oppex::IncidentError& failure) {
    Require(failure.kind() == oppex::ErrorKind::kClientClosed, "a post after Close must report a closed client");
  }
}

// The precondition fails before any network call.
void CheckServiceRouting() {
  oppex::ClientOptions options;
  options.api_key = "external-consumer-api-key";
  oppex::Client client(std::move(options));

  auto keyed = MakeRequest("Service routing test");
  keyed.service_key = "external-consumer-service-key";

  try {
    (void)client.PostWithServiceRouting(keyed);
    Require(false, "service routing must refuse a request service key");
  } catch (const oppex::IncidentError& failure) {
    Require(failure.kind() == oppex::ErrorKind::kInvalidRequest,
            "a request service key under service routing must be invalid");
  }
}

}  // namespace

int main() {
  try {
    Require(oppex::kDefaultEndpoint == "https://api.oppex.ai/api/v1/incident/post", "unexpected endpoint");
    Require(static_cast<int>(oppex::Severity::kMedium) == 3, "unexpected severity mapping");

    CheckRealTransportFailure();
    CheckValidation();
    CheckServiceRouting();
  } catch (const std::exception& failure) {
    std::cerr << failure.what() << "\n";
    return 1;
  }

  std::cout << "EXTERNAL_CONSUMER_OK cpp sdk=" << oppex::Version() << "\n";
  return 0;
}
