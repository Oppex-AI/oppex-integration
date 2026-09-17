#include "http_transport.hpp"

#include <curl/curl.h>

#include <array>
#include <cstdlib>
#include <mutex>
#include <utility>

#include "retry_policy.hpp"
#include "wire_codec.hpp"

namespace oppex {
namespace {

/// libcurl's global initialisation is not thread safe and must happen once per
/// process. std::call_once through a function-local static gives exactly that,
/// no matter how many clients a host creates or from which thread.
void EnsureCurlInitialized() {
  static const bool initialized = [] {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    return true;
  }();
  (void)initialized;
}

std::size_t AppendBody(char* data, std::size_t size, std::size_t count, void* user_data) {
  auto* body = static_cast<std::string*>(user_data);
  const std::size_t length = size * count;
  if (body->size() + length > kMaxResponseBytes) {
    // Returning short tells libcurl to abort the transfer, which is how the cap
    // is enforced rather than merely checked after the fact.
    return 0;
  }
  body->append(data, length);
  return length;
}

/// Turns a non-2xx response into a delivery failure, adding the API's own
/// message when the body carries one.
IncidentError StatusFailure(int status, std::string_view body) {
  std::string message = "Oppex returned HTTP " + std::to_string(status);
  try {
    const IncidentResponse parsed = wire::ParseResponse(status, body);
    if (parsed.message.has_value() && !parsed.message->empty()) {
      message += ": " + *parsed.message;
    }
  } catch (const IncidentError&) {
    // The status code remains sufficient when the body is not JSON.
  }
  return IncidentError(ErrorKind::kDelivery, message, status, retry::IsRetryableStatus(status));
}

}  // namespace

/// The connection cache shared by every attempt this transport makes. libcurl
/// serialises access through the callbacks registered here, so easy handles
/// created on different threads still reuse connections safely.
struct HttpTransport::Shared {
  CURLSH* handle = nullptr;
  std::array<std::mutex, CURL_LOCK_DATA_LAST> locks;

  static void Lock(CURL*, curl_lock_data data, curl_lock_access, void* user_data) {
    static_cast<Shared*>(user_data)->locks[data].lock();
  }

  static void Unlock(CURL*, curl_lock_data data, void* user_data) {
    static_cast<Shared*>(user_data)->locks[data].unlock();
  }
};

HttpTransport::HttpTransport(std::string api_key, std::string endpoint)
    : api_key_(std::move(api_key)), endpoint_(std::move(endpoint)), shared_(new Shared()) {
  EnsureCurlInitialized();
  shared_->handle = curl_share_init();
  if (shared_->handle != nullptr) {
    curl_share_setopt(shared_->handle, CURLSHOPT_LOCKFUNC, Shared::Lock);
    curl_share_setopt(shared_->handle, CURLSHOPT_UNLOCKFUNC, Shared::Unlock);
    curl_share_setopt(shared_->handle, CURLSHOPT_USERDATA, shared_);
    curl_share_setopt(shared_->handle, CURLSHOPT_SHARE, CURL_LOCK_DATA_CONNECT);
    curl_share_setopt(shared_->handle, CURLSHOPT_SHARE, CURL_LOCK_DATA_SSL_SESSION);
    curl_share_setopt(shared_->handle, CURLSHOPT_SHARE, CURL_LOCK_DATA_DNS);
  }
}

HttpTransport::~HttpTransport() {
  if (shared_->handle != nullptr) {
    curl_share_cleanup(shared_->handle);
  }
  delete shared_;
}

std::string HttpTransport::ResolveEndpoint() {
  const char* override_url = std::getenv("OPPEX_TEST_ENDPOINT_URL");
  if (override_url != nullptr && *override_url != '\0') {
    return override_url;
  }
  return std::string(kDefaultEndpoint);
}

IncidentResponse HttpTransport::Send(std::string_view payload) const {
  CURL* easy = curl_easy_init();
  if (easy == nullptr) {
    throw IncidentError(ErrorKind::kDelivery, "could not create an HTTP handle");
  }

  std::string body;
  curl_slist* headers = nullptr;
  headers = curl_slist_append(headers, "Content-Type: application/json");
  headers = curl_slist_append(headers, "Accept: application/json");
  headers = curl_slist_append(headers, ("X-API-KEY: " + api_key_).c_str());
  // libcurl adds "Expect: 100-continue" for larger bodies, which costs a round
  // trip against servers that never answer it.
  headers = curl_slist_append(headers, "Expect:");

  curl_easy_setopt(easy, CURLOPT_URL, endpoint_.c_str());
  curl_easy_setopt(easy, CURLOPT_POST, 1L);
  curl_easy_setopt(easy, CURLOPT_POSTFIELDS, payload.data());
  curl_easy_setopt(easy, CURLOPT_POSTFIELDSIZE, static_cast<long>(payload.size()));
  curl_easy_setopt(easy, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(easy, CURLOPT_WRITEFUNCTION, AppendBody);
  curl_easy_setopt(easy, CURLOPT_WRITEDATA, &body);
  curl_easy_setopt(easy, CURLOPT_CONNECTTIMEOUT_MS,
                   static_cast<long>(kConnectTimeout / std::chrono::milliseconds(1)));
  curl_easy_setopt(easy, CURLOPT_TIMEOUT_MS,
                   static_cast<long>(kAttemptTimeout / std::chrono::milliseconds(1)));
  curl_easy_setopt(easy, CURLOPT_MAXCONNECTS, kMaxConnections);
  // Signals are not thread safe, and libcurl's alarm-based DNS timeout uses
  // them unless this is set.
  curl_easy_setopt(easy, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(easy, CURLOPT_SSL_VERIFYPEER, 1L);
  curl_easy_setopt(easy, CURLOPT_SSL_VERIFYHOST, 2L);
  if (shared_->handle != nullptr) {
    curl_easy_setopt(easy, CURLOPT_SHARE, shared_->handle);
  }

  const CURLcode result = curl_easy_perform(easy);
  long status = 0;
  curl_easy_getinfo(easy, CURLINFO_RESPONSE_CODE, &status);

  curl_slist_free_all(headers);
  curl_easy_cleanup(easy);

  if (result != CURLE_OK) {
    // No status line was received, so the failure is transport-level and
    // retryable regardless of what libcurl reported. curl_easy_strerror returns
    // a fixed description, never anything derived from the response body.
    throw IncidentError(ErrorKind::kDelivery,
                        std::string("incident delivery failed before a response was received: ") +
                            curl_easy_strerror(result),
                        kNoStatusCode, true);
  }

  const int http_status = static_cast<int>(status);
  if (http_status >= 200 && http_status < 300) {
    return wire::ParseResponse(http_status, body);
  }
  throw StatusFailure(http_status, body);
}

}  // namespace oppex
