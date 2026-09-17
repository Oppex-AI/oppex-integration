// The C ABI. A thin, exception-free wrapper over the same implementation the C++
// header exposes.
//
// Every entry point is noexcept in effect: each one catches everything and
// reports through its return code, so no exception can cross the ABI boundary
// into a caller that has no way to handle one.

#include "oppex/oppex.h"

#include <cstring>
#include <exception>
#include <new>
#include <optional>
#include <string>

#include "oppex/oppex.hpp"
#include "version.hpp"

namespace {

std::optional<std::string> Optional(const char* value) {
  return value != nullptr ? std::optional<std::string>(value) : std::nullopt;
}

void Clear(oppex_error* error) {
  if (error != nullptr) {
    error->status_code = OPPEX_NO_STATUS_CODE;
    error->retryable = 0;
    error->message[0] = '\0';
  }
}

void Fill(oppex_error* error, const std::string& message, int status_code, int retryable) {
  if (error == nullptr) {
    return;
  }
  error->status_code = status_code;
  error->retryable = retryable;
  // Truncated rather than split: a message longer than the buffer is a
  // diagnostic, and the status code carries the part callers branch on.
  const std::size_t length = std::min(message.size(), sizeof(error->message) - 1);
  std::memcpy(error->message, message.data(), length);
  error->message[length] = '\0';
}

oppex_status StatusFor(oppex::ErrorKind kind) {
  switch (kind) {
    case oppex::ErrorKind::kInvalidRequest:
      return OPPEX_ERROR_INVALID_REQUEST;
    case oppex::ErrorKind::kClientClosed:
      return OPPEX_ERROR_CLIENT_CLOSED;
    case oppex::ErrorKind::kDelivery:
      return OPPEX_ERROR_DELIVERY;
  }
  return OPPEX_ERROR_DELIVERY;
}

/// Duplicates a string onto the heap for the caller to free. Returns nullptr
/// when the value is absent or the allocation fails; a response whose optional
/// text could not be allocated is still a usable response.
char* Duplicate(const std::optional<std::string>& value) {
  if (!value.has_value()) {
    return nullptr;
  }
  auto* copy = static_cast<char*>(std::malloc(value->size() + 1));
  if (copy == nullptr) {
    return nullptr;
  }
  std::memcpy(copy, value->c_str(), value->size() + 1);
  return copy;
}

oppex::IncidentRequest ToCppRequest(const oppex_incident_request& request) {
  oppex::IncidentRequest converted;
  converted.title = request.title != nullptr ? request.title : "";
  converted.source = request.source != nullptr ? request.source : "";
  converted.severity = static_cast<oppex::Severity>(request.severity);
  converted.priority = request.priority;
  converted.src_timestamp = static_cast<std::int64_t>(request.src_timestamp);
  converted.service_key = Optional(request.service_key);
  converted.component = Optional(request.component);
  converted.group = Optional(request.group);
  converted.type = Optional(request.type);
  converted.details = Optional(request.details);
  return converted;
}

void ToCResponse(const oppex::IncidentResponse& source, oppex_incident_response* out) {
  if (out == nullptr) {
    return;
  }
  out->successful = source.successful ? 1 : 0;
  out->code = source.code;
  out->message = Duplicate(source.message);
  out->incident_id = Duplicate(source.incident_id);
}

/// Runs an operation that may throw and converts the outcome to a status code.
template <typename Operation>
oppex_status Guard(oppex_error* error, Operation&& operation) {
  Clear(error);
  try {
    return std::forward<Operation>(operation)();
  } catch (const oppex::IncidentError& failure) {
    Fill(error, failure.what(), failure.status_code(), failure.retryable() ? 1 : 0);
    return StatusFor(failure.kind());
  } catch (const std::exception& failure) {
    Fill(error, failure.what(), OPPEX_NO_STATUS_CODE, 0);
    return OPPEX_ERROR_DELIVERY;
  } catch (...) {
    Fill(error, "unknown failure", OPPEX_NO_STATUS_CODE, 0);
    return OPPEX_ERROR_DELIVERY;
  }
}

oppex_status PostThrough(oppex_client* client, const oppex_incident_request* request,
                         oppex_incident_response* response, oppex_error* error, bool service_routing) {
  return Guard(error, [&]() -> oppex_status {
    if (client == nullptr || request == nullptr) {
      Fill(error, "client and request must not be null", OPPEX_NO_STATUS_CODE, 0);
      return OPPEX_ERROR_INVALID_REQUEST;
    }
    auto* cpp_client = reinterpret_cast<oppex::Client*>(client);
    const oppex::IncidentRequest converted = ToCppRequest(*request);
    const oppex::IncidentResponse result = service_routing
                                               ? cpp_client->PostWithServiceRouting(converted)
                                               : cpp_client->Post(converted);
    ToCResponse(result, response);
    return OPPEX_OK;
  });
}

oppex_status EnqueueThrough(oppex_client* client, const oppex_incident_request* request,
                            oppex_error* error, bool service_routing) {
  return Guard(error, [&]() -> oppex_status {
    if (client == nullptr || request == nullptr) {
      Fill(error, "client and request must not be null", OPPEX_NO_STATUS_CODE, 0);
      return OPPEX_ERROR_INVALID_REQUEST;
    }
    auto* cpp_client = reinterpret_cast<oppex::Client*>(client);
    oppex::IncidentRequest converted = ToCppRequest(*request);
    if (service_routing) {
      cpp_client->PostAsyncWithServiceRouting(std::move(converted));
    } else {
      cpp_client->PostAsync(std::move(converted));
    }
    return OPPEX_OK;
  });
}

}  // namespace

extern "C" {

oppex_client* oppex_client_create(const oppex_client_options* options, oppex_error* error) {
  Clear(error);
  if (options == nullptr) {
    Fill(error, "options must not be null", OPPEX_NO_STATUS_CODE, 0);
    return nullptr;
  }
  try {
    oppex::ClientOptions converted;
    converted.api_key = options->api_key != nullptr ? options->api_key : "";
    converted.service_key = Optional(options->service_key);
    return reinterpret_cast<oppex_client*>(new oppex::Client(std::move(converted)));
  } catch (const oppex::IncidentError& failure) {
    Fill(error, failure.what(), failure.status_code(), failure.retryable() ? 1 : 0);
  } catch (const std::exception& failure) {
    Fill(error, failure.what(), OPPEX_NO_STATUS_CODE, 0);
  } catch (...) {
    Fill(error, "unknown failure", OPPEX_NO_STATUS_CODE, 0);
  }
  return nullptr;
}

void oppex_client_close(oppex_client* client) {
  if (client != nullptr) {
    reinterpret_cast<oppex::Client*>(client)->Close();
  }
}

void oppex_client_destroy(oppex_client* client) {
  delete reinterpret_cast<oppex::Client*>(client);
}

oppex_status oppex_client_post(oppex_client* client, const oppex_incident_request* request,
                               oppex_incident_response* response, oppex_error* error) {
  return PostThrough(client, request, response, error, /*service_routing=*/false);
}

oppex_status oppex_client_post_with_service_routing(oppex_client* client,
                                                    const oppex_incident_request* request,
                                                    oppex_incident_response* response,
                                                    oppex_error* error) {
  return PostThrough(client, request, response, error, /*service_routing=*/true);
}

oppex_status oppex_client_post_async(oppex_client* client, const oppex_incident_request* request,
                                     oppex_error* error) {
  return EnqueueThrough(client, request, error, /*service_routing=*/false);
}

oppex_status oppex_client_post_async_with_service_routing(oppex_client* client,
                                                          const oppex_incident_request* request,
                                                          oppex_error* error) {
  return EnqueueThrough(client, request, error, /*service_routing=*/true);
}

void oppex_incident_response_free(oppex_incident_response* response) {
  if (response == nullptr) {
    return;
  }
  std::free(response->message);
  std::free(response->incident_id);
  response->message = nullptr;
  response->incident_id = nullptr;
  response->successful = 0;
  response->code = 0;
}

const char* oppex_version(void) { return OPPEX_SDK_VERSION; }

}  // extern "C"
