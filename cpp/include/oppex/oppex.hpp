// Oppex incident API client, C++ interface.
//
//   POST https://api.oppex.ai/api/v1/incident/post
//
// Create one oppex::Client per application, share it across threads, and let it
// go out of scope (or call close()) during application shutdown.
//
// This header is deliberately free of libcurl and of every other implementation
// detail: the client holds a pimpl, so a consumer needs no transitive include
// path and is not bound to this SDK's own dependency versions.

#ifndef OPPEX_OPPEX_HPP
#define OPPEX_OPPEX_HPP

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace oppex {

/// The Oppex incident endpoint every client posts to.
inline constexpr std::string_view kDefaultEndpoint = "https://api.oppex.ai/api/v1/incident/post";

/// The status code reported when delivery failed before any HTTP status line
/// was received.
inline constexpr int kNoStatusCode = -1;

/// The maximum length of IncidentRequest::source, in bytes.
inline constexpr std::size_t kMaxSourceLength = 255;

/// Oppex incident severity, on a scale from 1 (lowest) to 5 (highest). The
/// enumerator values are the wire values.
enum class Severity : int {
  kLowest = 1,
  kLow = 2,
  kMedium = 3,
  kHigh = 4,
  kCritical = 5,
};

/// Returns whether the value is within the Oppex scale of 1 to 5. A scoped enum
/// still accepts any value of its underlying type, so this has to be checked at
/// runtime.
[[nodiscard]] bool IsValidSeverity(Severity severity) noexcept;

/// Returns the constant name for a severity, or "UNKNOWN".
[[nodiscard]] std::string_view SeverityName(Severity severity) noexcept;

/// A single incident submission.
///
/// title, source and severity are required. Every other field is optional, and
/// an absent optional field is left out of the payload rather than sent as null.
/// An optional field that is present but empty is rejected, because that is
/// nearly always a bug at the call site.
struct IncidentRequest {
  /// The incident headline. Required, non-blank.
  std::string title;

  /// The emitting system. Required, non-blank, at most kMaxSourceLength bytes.
  std::string source;

  /// Required.
  Severity severity{};

  /// 1 through 5.
  int priority = 1;

  /// Milliseconds since the Unix epoch. Zero means the current time.
  std::int64_t src_timestamp = 0;

  /// Overrides the service key configured on the client.
  std::optional<std::string> service_key;

  std::optional<std::string> component;
  std::optional<std::string> group;
  std::optional<std::string> type;

  /// JSON text sent in the wire-level detailsJSON field.
  std::optional<std::string> details;
};

/// The result of a delivered incident.
struct IncidentResponse {
  /// The API's own success flag, defaulting to whether the HTTP status was 2xx
  /// when the body does not carry one.
  bool successful = false;

  /// The API's own code, defaulting to the HTTP status.
  int code = 0;

  std::optional<std::string> message;
  std::optional<std::string> incident_id;
};

/// What went wrong. Callers switch on this rather than matching message text.
enum class ErrorKind {
  /// The configuration or the incident failed validation. Nothing was sent.
  kInvalidRequest,
  /// The post happened after close().
  kClientClosed,
  /// Delivery was attempted and failed.
  kDelivery,
};

/// Every failure this SDK reports.
class IncidentError : public std::runtime_error {
 public:
  IncidentError(ErrorKind kind, const std::string& message, int status_code = kNoStatusCode,
                bool retryable = false);

  [[nodiscard]] ErrorKind kind() const noexcept { return kind_; }

  /// The HTTP status, or kNoStatusCode when no response arrived.
  [[nodiscard]] int status_code() const noexcept { return status_code_; }

  /// Whether the failure was eligible for retry.
  [[nodiscard]] bool retryable() const noexcept { return retryable_; }

  /// Whether an HTTP status was received at all.
  [[nodiscard]] bool has_http_status() const noexcept { return status_code_ != kNoStatusCode; }

 private:
  ErrorKind kind_;
  int status_code_;
  bool retryable_;
};

/// Severity of a log line this SDK emits.
enum class LogLevel { kDebug, kWarning };

/// Receives this SDK's internal logging. Invoked from worker threads as well as
/// the caller's, so an implementation must be thread safe.
using LogSink = std::function<void(LogLevel, std::string_view)>;

/// Configuration for a Client.
///
/// This is the whole configuration surface, deliberately. Timeouts, the retry
/// schedule, the retryable status list, the queue bound and the drain timeout are
/// part of the cross-language incident contract, not per-caller settings.
struct ClientOptions {
  /// Sent in the X-API-KEY header. Required, non-blank.
  std::string api_key;

  /// The default service for incidents that do not carry their own. When
  /// omitted, incidents must either supply one or be posted with
  /// Client::PostWithServiceRouting.
  std::optional<std::string> service_key;

  /// Defaults to discarding every message, so the SDK never writes anywhere the
  /// host did not ask for.
  LogSink log_sink;
};

/// Posts incidents to Oppex.
///
/// The client is thread safe and intended to be shared. Create one per
/// application, reuse it, and close it during shutdown; the destructor closes.
class Client {
 public:
  /// Throws IncidentError with ErrorKind::kInvalidRequest when the API key is
  /// missing or blank.
  explicit Client(ClientOptions options);
  ~Client();

  Client(const Client&) = delete;
  Client& operator=(const Client&) = delete;
  Client(Client&&) noexcept;
  Client& operator=(Client&&) noexcept;

  /// Posts on the calling thread, including any retry delays. The request's own
  /// service key overrides the client's.
  ///
  /// Throws IncidentError.
  IncidentResponse Post(const IncidentRequest& request);

  /// Posts without a service key so Oppex resolves the target service itself.
  /// The request must not carry its own service key. Otherwise identical to
  /// Post.
  IncidentResponse PostWithServiceRouting(const IncidentRequest& request);

  /// Queues a best-effort delivery and returns immediately.
  ///
  /// Validation, the closed check and the service-key check all still run on the
  /// calling thread and throw, so a misuse reaches the caller rather than a log
  /// line inside a worker. A delivery failure after queueing is logged at debug
  /// level.
  void PostAsync(IncidentRequest request);

  /// Queues a best-effort service-routed delivery. The request must not carry
  /// its own service key.
  void PostAsyncWithServiceRouting(IncidentRequest request);

  /// Drains queued work for up to ten seconds, then releases every owned
  /// resource. Idempotent, safe from any thread, and called by the destructor.
  void Close() noexcept;

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

/// Returns the SDK version, as "MAJOR.MINOR.PATCH".
[[nodiscard]] std::string_view Version() noexcept;

}  // namespace oppex

#endif  // OPPEX_OPPEX_HPP
