#include "wire_codec.hpp"

#include <chrono>

#include "json.hpp"

namespace oppex::wire {
namespace {

bool IsBlank(std::string_view value) {
  return value.find_first_not_of(" \t\n\r\f\v") == std::string_view::npos;
}

void RequireNonBlank(std::string_view value, std::string_view field) {
  if (IsBlank(value)) {
    throw IncidentError(ErrorKind::kInvalidRequest, std::string(field) + " must not be blank");
  }
}

/// An optional field may be absent, but a present-yet-blank value is nearly
/// always a bug at the call site, so it is rejected rather than silently sent.
std::optional<std::string> RejectBlank(const std::optional<std::string>& value,
                                       std::string_view field) {
  if (value.has_value() && IsBlank(*value)) {
    throw IncidentError(ErrorKind::kInvalidRequest,
                        std::string(field) + " must not be blank when supplied");
  }
  return value;
}

std::int64_t NowMillis() {
  using std::chrono::duration_cast;
  using std::chrono::milliseconds;
  return duration_cast<milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

void AppendField(std::string& out, bool& first, std::string_view name) {
  if (first) {
    first = false;
  } else {
    out.push_back(',');
  }
  json::AppendEscaped(out, name);
  out.push_back(':');
}

void AppendOptionalString(std::string& out, bool& first, std::string_view name,
                          const std::optional<std::string>& value) {
  if (!value.has_value()) {
    return;
  }
  AppendField(out, first, name);
  json::AppendEscaped(out, *value);
}

void AppendNumber(std::string& out, bool& first, std::string_view name, std::int64_t value) {
  AppendField(out, first, name);
  out.append(std::to_string(value));
}

}  // namespace

NormalizedRequest Normalize(const IncidentRequest& request) {
  RequireNonBlank(request.title, "title");
  RequireNonBlank(request.source, "source");
  if (request.source.size() > kMaxSourceLength) {
    throw IncidentError(ErrorKind::kInvalidRequest,
                        "source must not exceed " + std::to_string(kMaxSourceLength) + " bytes");
  }
  if (!IsValidSeverity(request.severity)) {
    throw IncidentError(ErrorKind::kInvalidRequest, "severity must be between 1 and 5");
  }

  const int priority = request.priority == 0 ? 1 : request.priority;
  if (priority < 1 || priority > 5) {
    throw IncidentError(ErrorKind::kInvalidRequest, "priority must be between 1 and 5");
  }

  const std::int64_t timestamp =
      request.src_timestamp == 0 ? NowMillis() : request.src_timestamp;
  if (timestamp <= 0) {
    throw IncidentError(ErrorKind::kInvalidRequest, "srcTimestamp must be greater than zero");
  }

  return NormalizedRequest{
      .title = request.title,
      .source = request.source,
      .severity = static_cast<int>(request.severity),
      .priority = priority,
      .src_timestamp = timestamp,
      .service_key = RejectBlank(request.service_key, "serviceKey"),
      .component = RejectBlank(request.component, "component"),
      .group = RejectBlank(request.group, "group"),
      .type = RejectBlank(request.type, "type"),
      .details = RejectBlank(request.details, "details"),
  };
}

std::string SerializeRequest(const NormalizedRequest& request,
                             const std::optional<std::string>& resolved_service_key) {
  std::string out;
  out.reserve(512);
  out.push_back('{');

  bool first = true;
  AppendOptionalString(out, first, "serviceKey", resolved_service_key);
  AppendField(out, first, "title");
  json::AppendEscaped(out, request.title);
  AppendField(out, first, "source");
  json::AppendEscaped(out, request.source);
  AppendNumber(out, first, "severity", request.severity);
  AppendNumber(out, first, "priority", request.priority);
  AppendNumber(out, first, "srcTimestamp", request.src_timestamp);
  AppendOptionalString(out, first, "component", request.component);
  AppendOptionalString(out, first, "group", request.group);
  AppendOptionalString(out, first, "type", request.type);
  AppendOptionalString(out, first, "detailsJSON", request.details);

  out.push_back('}');
  return out;
}

IncidentResponse ParseResponse(int http_status, std::string_view body) {
  IncidentResponse response;
  response.successful = http_status >= 200 && http_status < 300;
  response.code = http_status;
  if (body.empty() || IsBlank(body)) {
    return response;
  }

  const auto parsed = json::Parse(body);
  const json::Object* envelope = parsed.has_value() ? parsed->AsObject() : nullptr;
  if (envelope == nullptr) {
    throw IncidentError(ErrorKind::kDelivery,
                        "Oppex returned a non-JSON response (status " +
                            std::to_string(http_status) + ")",
                        http_status);
  }

  if (const auto member = envelope->find("success"); member != envelope->end()) {
    if (const auto value = member->second.AsBool()) {
      response.successful = *value;
    }
  }
  if (const auto member = envelope->find("code"); member != envelope->end()) {
    if (const auto value = member->second.AsInt()) {
      response.code = static_cast<int>(*value);
    }
  }
  if (const auto member = envelope->find("message"); member != envelope->end()) {
    if (const auto* value = member->second.AsString()) {
      response.message = *value;
    }
  }
  if (const auto member = envelope->find("data"); member != envelope->end()) {
    if (const auto* value = member->second.AsString()) {
      response.incident_id = *value;
    }
  }
  return response;
}

}  // namespace oppex::wire
