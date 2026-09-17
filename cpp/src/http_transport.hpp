// The libcurl adapter. It owns the connection handles, so closing a client
// releases the sockets that client opened and no others. Not public API.

#ifndef OPPEX_SRC_HTTP_TRANSPORT_HPP
#define OPPEX_SRC_HTTP_TRANSPORT_HPP

#include <chrono>
#include <string>
#include <string_view>

#include "oppex/oppex.hpp"

namespace oppex {

inline constexpr std::chrono::seconds kConnectTimeout{3};
/// Bounds a whole attempt so a server that trickles bytes forever cannot hold a
/// delivery open past the sum of its phase timeouts.
inline constexpr std::chrono::seconds kAttemptTimeout{8};
inline constexpr long kMaxConnections = 20;
/// The API returns a small envelope. Anything larger is a misbehaving proxy, and
/// reading it in full would let that proxy dictate this client's memory use.
inline constexpr std::size_t kMaxResponseBytes = 1024 * 1024;

class HttpTransport {
 public:
  HttpTransport(std::string api_key, std::string endpoint);
  ~HttpTransport();

  HttpTransport(const HttpTransport&) = delete;
  HttpTransport& operator=(const HttpTransport&) = delete;

  /// Performs one attempt. Every failure it throws is an IncidentError whose
  /// retryable() already carries the retry decision, so the retry policy never
  /// has to know what libcurl reported.
  ///
  /// A libcurl easy handle is not thread safe, so one is created per attempt.
  /// The shared connection cache, which is thread safe under a lock, is what
  /// still gives connection reuse across attempts and threads.
  [[nodiscard]] IncidentResponse Send(std::string_view payload) const;

  /// Resolves the target URL. The override exists so tests and the external
  /// smoke consumer can point the whole delivery path at a loopback server; it
  /// is deliberately not client configuration, which would add a public knob
  /// that exists only to ease testing.
  [[nodiscard]] static std::string ResolveEndpoint();

 private:
  struct Shared;

  std::string api_key_;
  std::string endpoint_;
  Shared* shared_;
};

}  // namespace oppex

#endif  // OPPEX_SRC_HTTP_TRANSPORT_HPP
