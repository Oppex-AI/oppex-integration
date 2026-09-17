#include <atomic>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <utility>

#include "async_dispatcher.hpp"
#include "http_transport.hpp"
#include "interrupt.hpp"
#include "oppex/oppex.hpp"
#include "retry_policy.hpp"
#include "version.hpp"
#include "wire_codec.hpp"

namespace oppex {
namespace {

bool IsBlank(std::string_view value) {
  return value.find_first_not_of(" \t\n\r\f\v") == std::string_view::npos;
}

void RequireServiceRoutable(const wire::NormalizedRequest& request) {
  if (request.service_key.has_value()) {
    throw IncidentError(ErrorKind::kInvalidRequest,
                        "request must not carry a serviceKey when service routing is used");
  }
}

}  // namespace

bool IsValidSeverity(Severity severity) noexcept {
  const int value = static_cast<int>(severity);
  return value >= 1 && value <= 5;
}

std::string_view SeverityName(Severity severity) noexcept {
  switch (severity) {
    case Severity::kLowest:
      return "LOWEST";
    case Severity::kLow:
      return "LOW";
    case Severity::kMedium:
      return "MEDIUM";
    case Severity::kHigh:
      return "HIGH";
    case Severity::kCritical:
      return "CRITICAL";
    default:
      return "UNKNOWN";
  }
}

std::string_view Version() noexcept { return OPPEX_SDK_VERSION; }

IncidentError::IncidentError(ErrorKind kind, const std::string& message, int status_code,
                             bool retryable)
    : std::runtime_error(message), kind_(kind), status_code_(status_code), retryable_(retryable) {}

/// Everything a queued delivery needs. Held behind a shared_ptr so a task that
/// outlives Close still has a live transport rather than a dangling reference.
class Client::Impl {
 public:
  explicit Impl(ClientOptions options)
      : service_key_(options.service_key.has_value() && !IsBlank(*options.service_key)
                         ? options.service_key
                         : std::nullopt),
        log_sink_(std::move(options.log_sink)),
        delivery_(std::make_shared<Delivery>(std::move(options.api_key),
                                             HttpTransport::ResolveEndpoint())),
        dispatcher_(log_sink_) {}

  ~Impl() { Close(); }

  IncidentResponse Post(const IncidentRequest& request) {
    EnsureOpen();
    auto normalized = wire::Normalize(request);
    if (!normalized.service_key.has_value() && !service_key_.has_value()) {
      throw IncidentError(ErrorKind::kInvalidRequest,
                          "no serviceKey is configured on the client or the request; supply one "
                          "or use PostWithServiceRouting");
    }
    return delivery_->Deliver(normalized, service_key_);
  }

  IncidentResponse PostWithServiceRouting(const IncidentRequest& request) {
    EnsureOpen();
    auto normalized = wire::Normalize(request);
    RequireServiceRoutable(normalized);
    return delivery_->Deliver(normalized, std::nullopt);
  }

  void PostAsync(const IncidentRequest& request) {
    EnsureOpen();
    auto normalized = wire::Normalize(request);
    if (!normalized.service_key.has_value() && !service_key_.has_value()) {
      throw IncidentError(ErrorKind::kInvalidRequest,
                          "no serviceKey is configured on the client or the request; supply one "
                          "or use PostAsyncWithServiceRouting");
    }
    Submit(std::move(normalized), service_key_);
  }

  void PostAsyncWithServiceRouting(const IncidentRequest& request) {
    EnsureOpen();
    auto normalized = wire::Normalize(request);
    RequireServiceRoutable(normalized);
    Submit(std::move(normalized), std::nullopt);
  }

  void Close() noexcept {
    if (closed_.exchange(true)) {
      return;
    }
    // Signalled before the drain so a worker sitting in an eight-second backoff
    // gives up now instead of consuming the whole drain budget.
    delivery_->interrupt.Signal();
    dispatcher_.Close(kCloseDrainTimeout);
  }

 private:
  /// The parts a queued task keeps alive. Separated from Impl so the task
  /// captures only what it needs, and nothing that Close tears down.
  struct Delivery {
    Delivery(std::string api_key, std::string endpoint)
        : transport(std::move(api_key), std::move(endpoint)) {}

    IncidentResponse Deliver(const wire::NormalizedRequest& request,
                             const std::optional<std::string>& default_service_key) {
      const auto& service_key =
          request.service_key.has_value() ? request.service_key : default_service_key;
      const std::string payload = wire::SerializeRequest(request, service_key);
      return retry::Execute(retry::DefaultDelays(), interrupt,
                            [this, &payload] { return transport.Send(payload); });
    }

    HttpTransport transport;
    Interrupt interrupt;
  };

  void EnsureOpen() const {
    if (closed_.load()) {
      throw IncidentError(ErrorKind::kClientClosed, "the incident client is closed");
    }
  }

  void Submit(wire::NormalizedRequest request,
              const std::optional<std::string>& default_service_key) {
    auto delivery = delivery_;
    auto log_sink = log_sink_;
    std::optional<std::string> service_key = default_service_key;
    const bool accepted = dispatcher_.Submit(
        [delivery, log_sink, request = std::move(request), service_key = std::move(service_key)] {
          // No closed check here: Close drains the dispatcher before the last
          // reference to Delivery goes away, so a task queued before Close still
          // has a live transport, and a task submitted after Close was already
          // refused below.
          try {
            delivery->Deliver(request, service_key);
          } catch (const IncidentError& failure) {
            if (log_sink) {
              log_sink(LogLevel::kDebug,
                       std::string("oppex: queued incident delivery failed: ") + failure.what());
            }
          }
        });
    if (!accepted) {
      throw IncidentError(ErrorKind::kClientClosed, "the incident client is closed");
    }
  }

  std::optional<std::string> service_key_;
  LogSink log_sink_;
  std::shared_ptr<Delivery> delivery_;
  AsyncDispatcher dispatcher_;
  std::atomic<bool> closed_{false};
};

Client::Client(ClientOptions options) {
  if (IsBlank(options.api_key)) {
    throw IncidentError(ErrorKind::kInvalidRequest, "apiKey must not be blank");
  }
  impl_ = std::make_unique<Impl>(std::move(options));
}

Client::~Client() = default;
Client::Client(Client&&) noexcept = default;
Client& Client::operator=(Client&&) noexcept = default;

IncidentResponse Client::Post(const IncidentRequest& request) { return impl_->Post(request); }

IncidentResponse Client::PostWithServiceRouting(const IncidentRequest& request) {
  return impl_->PostWithServiceRouting(request);
}

void Client::PostAsync(IncidentRequest request) { impl_->PostAsync(request); }

void Client::PostAsyncWithServiceRouting(IncidentRequest request) {
  impl_->PostAsyncWithServiceRouting(request);
}

void Client::Close() noexcept {
  if (impl_) {
    impl_->Close();
  }
}

}  // namespace oppex
