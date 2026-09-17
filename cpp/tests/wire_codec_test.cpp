#include "wire_codec.hpp"

#include <string>

#include "oppex/oppex.hpp"
#include "test_support.hpp"

namespace {

using oppex::ErrorKind;
using oppex::IncidentError;
using oppex::IncidentRequest;
using oppex::Severity;
using oppex::wire::Normalize;
using oppex::wire::ParseResponse;
using oppex::wire::SerializeRequest;

IncidentRequest Valid() {
  IncidentRequest request;
  request.title = "title";
  request.source = "source";
  request.severity = Severity::kMedium;
  return request;
}

OPPEX_TEST(NormalizeAppliesTheDocumentedDefaults) {
  const auto normalized = Normalize(Valid());

  OPPEX_ASSERT_EQ(1, normalized.priority);
  OPPEX_ASSERT(normalized.src_timestamp > 0);
  OPPEX_ASSERT(!normalized.component.has_value());
}

OPPEX_TEST(NormalizeKeepsExplicitValues) {
  auto request = Valid();
  request.priority = 4;
  request.src_timestamp = 1700000000000LL;
  request.service_key = "request-service-key";
  request.type = "latency";

  const auto normalized = Normalize(request);

  OPPEX_ASSERT_EQ(4, normalized.priority);
  OPPEX_ASSERT_EQ(1700000000000LL, normalized.src_timestamp);
  OPPEX_ASSERT_EQ(std::string("request-service-key"), *normalized.service_key);
  OPPEX_ASSERT_EQ(std::string("latency"), *normalized.type);
}

OPPEX_TEST(NormalizeRejectsBlankRequiredFields) {
  auto blank_title = Valid();
  blank_title.title = "   ";
  OPPEX_ASSERT_THROWS(IncidentError, (void)Normalize(blank_title));

  auto blank_source = Valid();
  blank_source.source = "";
  OPPEX_ASSERT_THROWS(IncidentError, (void)Normalize(blank_source));
}

OPPEX_TEST(NormalizeEnforcesTheSourceLengthCap) {
  auto at_cap = Valid();
  at_cap.source = std::string(oppex::kMaxSourceLength, 'a');
  (void)Normalize(at_cap);

  auto over_cap = Valid();
  over_cap.source = std::string(oppex::kMaxSourceLength + 1, 'a');
  OPPEX_ASSERT_THROWS(IncidentError, (void)Normalize(over_cap));
}

OPPEX_TEST(NormalizeRejectsOutOfRangeValues) {
  for (const int severity : {0, 6, 99}) {
    auto request = Valid();
    request.severity = static_cast<Severity>(severity);
    OPPEX_ASSERT_THROWS(IncidentError, (void)Normalize(request));
  }
  for (const int priority : {-1, 6}) {
    auto request = Valid();
    request.priority = priority;
    OPPEX_ASSERT_THROWS(IncidentError, (void)Normalize(request));
  }

  auto negative_time = Valid();
  negative_time.src_timestamp = -1;
  OPPEX_ASSERT_THROWS(IncidentError, (void)Normalize(negative_time));
}

OPPEX_TEST(NormalizeRejectsABlankOptionalField) {
  auto blank_component = Valid();
  blank_component.component = "  ";
  OPPEX_ASSERT_THROWS(IncidentError, (void)Normalize(blank_component));

  auto blank_service_key = Valid();
  blank_service_key.service_key = "";
  OPPEX_ASSERT_THROWS(IncidentError, (void)Normalize(blank_service_key));
}

OPPEX_TEST(SerializeOmitsAbsentOptionalFields) {
  auto request = Valid();
  request.severity = Severity::kHigh;
  request.priority = 2;
  request.src_timestamp = 1700000000000LL;

  const std::string payload = SerializeRequest(Normalize(request), std::nullopt);

  OPPEX_ASSERT_EQ(
      std::string(R"({"title":"title","source":"source","severity":4,"priority":2,)"
                  R"("srcTimestamp":1700000000000})"),
      payload);
}

OPPEX_TEST(SerializeUsesTheAgreedFieldNamesAndOrder) {
  auto request = Valid();
  request.severity = Severity::kLow;
  request.src_timestamp = 1;
  request.component = "api";
  request.group = "payments";
  request.type = "latency";
  request.details = R"({"p99":1200})";

  const std::string payload = SerializeRequest(Normalize(request), "resolved-service-key");

  OPPEX_ASSERT_EQ(
      std::string(R"({"serviceKey":"resolved-service-key","title":"title","source":"source",)"
                  R"("severity":2,"priority":1,"srcTimestamp":1,"component":"api",)"
                  R"("group":"payments","type":"latency","detailsJSON":"{\"p99\":1200}"})"),
      payload);
}

OPPEX_TEST(ParseReadsTheEnvelope) {
  const auto response =
      ParseResponse(200, R"({"success":true,"code":201,"message":"created","data":"INC-1"})");

  OPPEX_ASSERT_EQ(true, response.successful);
  OPPEX_ASSERT_EQ(201, response.code);
  OPPEX_ASSERT_EQ(std::string("created"), *response.message);
  OPPEX_ASSERT_EQ(std::string("INC-1"), *response.incident_id);
}

OPPEX_TEST(ParseFallsBackToTheHttpStatus) {
  const auto response = ParseResponse(202, "   ");

  OPPEX_ASSERT_EQ(true, response.successful);
  OPPEX_ASSERT_EQ(202, response.code);
  OPPEX_ASSERT(!response.incident_id.has_value());
}

OPPEX_TEST(ParseNeverEchoesANonJsonBody) {
  try {
    (void)ParseResponse(502, "<html>X-API-KEY: super-secret</html>");
    OPPEX_ASSERT(false);
  } catch (const IncidentError& failure) {
    OPPEX_ASSERT(failure.kind() == ErrorKind::kDelivery);
    OPPEX_ASSERT(std::string(failure.what()).find("super-secret") == std::string::npos);
    OPPEX_ASSERT_EQ(502, failure.status_code());
  }
}

}  // namespace
