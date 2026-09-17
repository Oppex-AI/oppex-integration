/*
 * Oppex incident API client, C interface.
 *
 *   POST https://api.oppex.ai/api/v1/incident/post
 *
 * This is a thin, stable ABI over the same implementation the C++ header
 * exposes. Nothing here throws; every call reports through its return code and
 * fills an oppex_error the caller owns by value, so there is no error object to
 * free and no exception to cross the ABI boundary.
 *
 * Create one oppex_client per application, share it across threads, and destroy
 * it during shutdown.
 */

#ifndef OPPEX_OPPEX_H
#define OPPEX_OPPEX_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** The Oppex incident endpoint every client posts to. */
#define OPPEX_DEFAULT_ENDPOINT "https://api.oppex.ai/api/v1/incident/post"

/** Reported in oppex_error::status_code when no HTTP status line was received. */
#define OPPEX_NO_STATUS_CODE (-1)

/** The largest message oppex_error carries, including the terminator. */
#define OPPEX_ERROR_MESSAGE_CAPACITY 512

/** Severity wire values, 1 (lowest) through 5 (highest). */
enum {
  OPPEX_SEVERITY_LOWEST = 1,
  OPPEX_SEVERITY_LOW = 2,
  OPPEX_SEVERITY_MEDIUM = 3,
  OPPEX_SEVERITY_HIGH = 4,
  OPPEX_SEVERITY_CRITICAL = 5
};

/** The outcome of a call. Zero is success; every other value is a failure. */
typedef enum oppex_status {
  OPPEX_OK = 0,
  /** Validation failed. Nothing was sent. */
  OPPEX_ERROR_INVALID_REQUEST = 1,
  /** The call happened after oppex_client_close or oppex_client_destroy. */
  OPPEX_ERROR_CLIENT_CLOSED = 2,
  /** Delivery was attempted and failed. */
  OPPEX_ERROR_DELIVERY = 3
} oppex_status;

/**
 * Failure detail, owned by the caller by value. A fixed message buffer avoids
 * any allocation or ownership question at the ABI boundary; a message longer
 * than the buffer is truncated, never split across calls.
 */
typedef struct oppex_error {
  /** The HTTP status, or OPPEX_NO_STATUS_CODE. */
  int status_code;
  /** Non-zero when the failure was eligible for retry. */
  int retryable;
  char message[OPPEX_ERROR_MESSAGE_CAPACITY];
} oppex_error;

/**
 * Client configuration. The strings are copied during construction, so the
 * caller may free or reuse them immediately afterwards.
 */
typedef struct oppex_client_options {
  /** Required, non-blank. */
  const char* api_key;
  /** NULL for none. */
  const char* service_key;
} oppex_client_options;

/**
 * An incident. Every const char* field is copied when the call is made.
 *
 * title and source are required and non-blank; severity is required. NULL means
 * "absent" for every optional field, and an absent field is omitted from the
 * payload rather than sent as null. priority defaults to 1 when zero, and
 * src_timestamp defaults to the current time when zero.
 */
typedef struct oppex_incident_request {
  const char* title;
  const char* source;
  int severity;
  int priority;
  long long src_timestamp;
  const char* service_key;
  const char* component;
  const char* group;
  const char* type;
  const char* details;
} oppex_incident_request;

/**
 * A delivered incident's result. message and incident_id are heap-allocated and
 * may be NULL; release them with oppex_incident_response_free.
 */
typedef struct oppex_incident_response {
  int successful;
  int code;
  char* message;
  char* incident_id;
} oppex_incident_response;

/** An opaque client handle. */
typedef struct oppex_client oppex_client;

/**
 * Creates a client.
 *
 * Returns NULL and fills error on failure. error may be NULL if the caller does
 * not want the detail.
 */
oppex_client* oppex_client_create(const oppex_client_options* options, oppex_error* error);

/**
 * Drains queued work for up to ten seconds, then releases every owned resource.
 * Idempotent and safe from any thread.
 */
void oppex_client_close(oppex_client* client);

/** Closes the client if it is still open, then frees it. NULL is ignored. */
void oppex_client_destroy(oppex_client* client);

/**
 * Posts on the calling thread, including any retry delays. The request's own
 * service key overrides the client's.
 *
 * On OPPEX_OK, response is filled and must be released with
 * oppex_incident_response_free. response and error may each be NULL.
 */
oppex_status oppex_client_post(oppex_client* client, const oppex_incident_request* request,
                               oppex_incident_response* response, oppex_error* error);

/**
 * Posts without a service key so Oppex resolves the target service itself. The
 * request must not carry its own service key.
 */
oppex_status oppex_client_post_with_service_routing(oppex_client* client,
                                                    const oppex_incident_request* request,
                                                    oppex_incident_response* response,
                                                    oppex_error* error);

/** Queues a best-effort delivery and returns immediately. */
oppex_status oppex_client_post_async(oppex_client* client, const oppex_incident_request* request,
                                     oppex_error* error);

/** Queues a best-effort service-routed delivery. */
oppex_status oppex_client_post_async_with_service_routing(oppex_client* client,
                                                          const oppex_incident_request* request,
                                                          oppex_error* error);

/** Releases the strings inside a response and zeroes it. NULL is ignored. */
void oppex_incident_response_free(oppex_incident_response* response);

/** Returns the SDK version, as "MAJOR.MINOR.PATCH". Never NULL. */
const char* oppex_version(void);

#ifdef __cplusplus
}  /* extern "C" */
#endif

#endif /* OPPEX_OPPEX_H */
