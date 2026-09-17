// Renders the wire payload and decodes the response envelope. Not public API.

#ifndef OPPEX_SRC_WIRE_CODEC_HPP
#define OPPEX_SRC_WIRE_CODEC_HPP

#include <optional>
#include <string>
#include <string_view>

#include "oppex/oppex.hpp"

namespace oppex::wire {

/// A request whose defaults are resolved and whose fields are validated. The
/// type exists so the transport and the codec cannot be handed raw input.
struct NormalizedRequest {
  std::string title;
  std::string source;
  int severity = 0;
  int priority = 1;
  std::int64_t src_timestamp = 0;
  std::optional<std::string> service_key;
  std::optional<std::string> component;
  std::optional<std::string> group;
  std::optional<std::string> type;
  std::optional<std::string> details;
};

/// Validates a request and applies the documented defaults. This is the single
/// place defaults are resolved, so a synchronous and a queued post can never
/// disagree about what was sent.
///
/// Throws IncidentError with ErrorKind::kInvalidRequest.
[[nodiscard]] NormalizedRequest Normalize(const IncidentRequest& request);

/// Renders the payload. An absent resolved service key is omitted entirely so
/// the API routes the incident by its own rules, and every other absent optional
/// field is omitted rather than sent as null.
[[nodiscard]] std::string SerializeRequest(const NormalizedRequest& request,
                                           const std::optional<std::string>& resolved_service_key);

/// Decodes a response body, falling back to the HTTP status for any field the
/// body does not carry.
///
/// A body that is not JSON is never echoed into the thrown error: a proxy or WAF
/// can return an error page that repeats request headers, including X-API-KEY,
/// and that text would then leak into the host's logs.
///
/// Throws IncidentError with ErrorKind::kDelivery.
[[nodiscard]] IncidentResponse ParseResponse(int http_status, std::string_view body);

}  // namespace oppex::wire

#endif  // OPPEX_SRC_WIRE_CODEC_HPP
