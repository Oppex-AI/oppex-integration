#include <cstdlib>
#include <string>
#include <thread>
#include <vector>

#include "http_transport.hpp"
#include "json.hpp"
#include "oppex/oppex.hpp"
#include "test_support.hpp"

namespace {

using oppex::Client;
using oppex::ClientOptions;
using oppex::ErrorKind;
using oppex::IncidentError;
using oppex::IncidentRequest;
using oppex::IncidentResponse;
using oppex::Severity;
using oppex::test::StubServer;

constexpr const char* kCreated = R"({"success":true,"code":200,"message":"created","data":"INC-42"})";

/// Points the whole delivery path at the stub. The endpoint seam is an
/// environment variable rather than a client option, so the public surface never
/// grows a knob that exists only to ease testing; the harness runs tests one at
/// a time, so setting it per test is safe.
void UseServer(const StubServer& server) {
  ::setenv("OPPEX_TEST_ENDPOINT_URL", server.url().c_str(), 1);
}

Client MakeClient(bool with_service_key = true) {
  ClientOptions options;
  options.api_key = "api-key";
  if (with_service_key) {
    options.service_key = "client-service-key";
  }
  return Client(std::move(options));
}

IncidentRequest MakeRequest() {
  IncidentRequest request;
  request.title = "Checkout latency";
  request.source = "checkout-api";
  request.severity = Severity::kHigh;
  request.src_timestamp = 1700000000000LL;
  return request;
}

/// Parses a recorded body into an owned object, so no test holds a reference
/// into a temporary.
oppex::json::Object PayloadOf(const StubServer::RecordedRequest& sent) {
  const auto parsed = oppex::json::Parse(sent.body);
  OPPEX_ASSERT(parsed.has_value());
  const auto* object = parsed->AsObject();
  OPPEX_ASSERT(object != nullptr);
  return *object;
}

OPPEX_TEST(ABlankApiKeyIsRejected) {
  for (const char* api_key : {"", "   "}) {
    ClientOptions options;
    options.api_key = api_key;
    OPPEX_ASSERT_THROWS(IncidentError, Client{options});
  }
}

OPPEX_TEST(PostReturnsTheParsedResponse) {
  StubServer server({{200, kCreated}});
  UseServer(server);
  Client client = MakeClient();

  const IncidentResponse response = client.Post(MakeRequest());

  OPPEX_ASSERT_EQ(true, response.successful);
  OPPEX_ASSERT_EQ(std::string("INC-42"), *response.incident_id);
  OPPEX_ASSERT_EQ(std::string("created"), *response.message);
}

OPPEX_TEST(PostSendsTheAgreedHeadersAndPayload) {
  StubServer server({{200, kCreated}});
  UseServer(server);
  Client client = MakeClient();

  (void)client.Post(MakeRequest());
  const auto sent = server.NextRequest();

  OPPEX_ASSERT_EQ(std::string("api-key"), sent.Header("X-API-KEY"));
  OPPEX_ASSERT_EQ(std::string("application/json"), sent.Header("Content-Type"));
  OPPEX_ASSERT_EQ(std::string("application/json"), sent.Header("Accept"));

  const auto payload = PayloadOf(sent);
  OPPEX_ASSERT_EQ(std::string("client-service-key"), *payload.at("serviceKey").AsString());
  OPPEX_ASSERT_EQ(std::string("Checkout latency"), *payload.at("title").AsString());
  OPPEX_ASSERT_EQ(4, static_cast<int>(payload.at("severity").AsInt().value()));
  OPPEX_ASSERT_EQ(1, static_cast<int>(payload.at("priority").AsInt().value()));
  OPPEX_ASSERT_EQ(1700000000000LL, payload.at("srcTimestamp").AsInt().value());
  OPPEX_ASSERT(payload.find("component") == payload.end());
}

OPPEX_TEST(ARequestServiceKeyOverridesTheClients) {
  StubServer server({{200, kCreated}});
  UseServer(server);
  Client client = MakeClient();

  auto request = MakeRequest();
  request.service_key = "request-service-key";
  (void)client.Post(request);

  const auto payload = PayloadOf(server.NextRequest());
  OPPEX_ASSERT_EQ(std::string("request-service-key"), *payload.at("serviceKey").AsString());
}

OPPEX_TEST(AServiceKeyIsRequiredSomewhere) {
  StubServer server({{200, kCreated}});
  UseServer(server);
  Client client = MakeClient(/*with_service_key=*/false);

  OPPEX_ASSERT_THROWS(IncidentError, (void)client.Post(MakeRequest()));
  OPPEX_ASSERT_EQ(std::size_t{0}, server.RequestCount());
}

OPPEX_TEST(ServiceRoutingOmitsTheServiceKey) {
  StubServer server({{200, kCreated}});
  UseServer(server);
  Client client = MakeClient();

  (void)client.PostWithServiceRouting(MakeRequest());

  const auto payload = PayloadOf(server.NextRequest());
  OPPEX_ASSERT(payload.find("serviceKey") == payload.end());
}

OPPEX_TEST(ServiceRoutingRefusesARequestServiceKey) {
  StubServer server({{200, kCreated}});
  UseServer(server);
  Client client = MakeClient(/*with_service_key=*/false);

  auto request = MakeRequest();
  request.service_key = "request-service-key";

  OPPEX_ASSERT_THROWS(IncidentError, (void)client.PostWithServiceRouting(request));
  OPPEX_ASSERT_EQ(std::size_t{0}, server.RequestCount());
}

OPPEX_TEST(ARetryableStatusIsRetried) {
  StubServer server({{503, ""}, {200, kCreated}});
  UseServer(server);
  Client client = MakeClient();

  // One retry, so this test waits out the real first backoff step (500ms). The
  // schedule is contract, not configuration, so there is nothing to shorten.
  const IncidentResponse response = client.Post(MakeRequest());

  OPPEX_ASSERT_EQ(true, response.successful);
  server.NextRequest();
  server.NextRequest();
  server.AssertNoFurtherRequest();
}

OPPEX_TEST(ANonRetryableStatusFailsImmediately) {
  StubServer server({{401, R"({"success":false,"message":"invalid api key"})"}});
  UseServer(server);
  Client client = MakeClient();

  try {
    (void)client.Post(MakeRequest());
    OPPEX_ASSERT(false);
  } catch (const IncidentError& failure) {
    OPPEX_ASSERT(failure.kind() == ErrorKind::kDelivery);
    OPPEX_ASSERT_EQ(401, failure.status_code());
    OPPEX_ASSERT(!failure.retryable());
    OPPEX_ASSERT(std::string(failure.what()).find("invalid api key") != std::string::npos);
  }

  server.NextRequest();
  server.AssertNoFurtherRequest();
}

OPPEX_TEST(PostAsyncDeliversAndValidatesOnTheCallingThread) {
  StubServer server({{200, kCreated}});
  UseServer(server);

  Client without_key = MakeClient(/*with_service_key=*/false);
  OPPEX_ASSERT_THROWS(IncidentError, without_key.PostAsync(MakeRequest()));

  Client client = MakeClient();
  client.PostAsync(MakeRequest());

  const auto payload = PayloadOf(server.NextRequest());
  OPPEX_ASSERT_EQ(std::string("client-service-key"), *payload.at("serviceKey").AsString());
}

OPPEX_TEST(EveryPostFailsOnAClosedClient) {
  StubServer server({{200, kCreated}});
  UseServer(server);
  Client client = MakeClient();
  client.Close();
  client.Close();

  OPPEX_ASSERT_THROWS(IncidentError, (void)client.Post(MakeRequest()));
  OPPEX_ASSERT_THROWS(IncidentError, (void)client.PostWithServiceRouting(MakeRequest()));
  OPPEX_ASSERT_THROWS(IncidentError, client.PostAsync(MakeRequest()));
  OPPEX_ASSERT_EQ(std::size_t{0}, server.RequestCount());
}

OPPEX_TEST(TheClientIsShareableAcrossThreads) {
  StubServer server({{200, kCreated}});
  UseServer(server);
  Client client = MakeClient();

  std::vector<std::thread> callers;
  callers.reserve(8);
  for (int index = 0; index < 8; ++index) {
    callers.emplace_back([&client] { (void)client.Post(MakeRequest()); });
  }
  for (auto& caller : callers) {
    caller.join();
  }

  for (int delivered = 0; delivered < 8; ++delivered) {
    server.NextRequest();
  }
}

OPPEX_TEST(SeverityMapsToTheOppexScale) {
  OPPEX_ASSERT_EQ(3, static_cast<int>(Severity::kMedium));
  OPPEX_ASSERT(oppex::IsValidSeverity(Severity::kCritical));
  OPPEX_ASSERT(!oppex::IsValidSeverity(static_cast<Severity>(0)));
  OPPEX_ASSERT(!oppex::IsValidSeverity(static_cast<Severity>(6)));
  OPPEX_ASSERT_EQ(std::string("MEDIUM"), std::string(oppex::SeverityName(Severity::kMedium)));
  OPPEX_ASSERT_EQ(std::string("UNKNOWN"), std::string(oppex::SeverityName(static_cast<Severity>(9))));
}

OPPEX_TEST(TheEndpointOverrideIsOnlyAnOverride) {
  ::unsetenv("OPPEX_TEST_ENDPOINT_URL");
  OPPEX_ASSERT_EQ(std::string(oppex::kDefaultEndpoint), oppex::HttpTransport::ResolveEndpoint());
}

}  // namespace
