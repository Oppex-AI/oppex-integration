/*
 * Exercises the C ABI from a translation unit compiled as C, not C++.
 *
 * That is the point of the file: it proves include/oppex/oppex.h is valid C and
 * that the ABI is usable without a C++ compiler, which a test written in C++
 * cannot prove no matter what it calls.
 *
 * Network-free: every case here fails validation before any HTTP attempt.
 */

#include "oppex/oppex.h"

#include <stdio.h>
#include <string.h>

static int Fail(char* report, size_t capacity, const char* message) {
  snprintf(report, capacity, "%s", message);
  return 1;
}

int oppex_run_c_api_checks(char* report, size_t capacity);

int oppex_run_c_api_checks(char* report, size_t capacity) {
  oppex_error error;
  oppex_client_options options;
  oppex_incident_request request;
  oppex_client* client;
  oppex_status status;

  if (strcmp(oppex_version(), "") == 0) {
    return Fail(report, capacity, "oppex_version returned an empty string");
  }

  /* A blank API key is refused, and the error carries a message. */
  memset(&options, 0, sizeof(options));
  options.api_key = "   ";
  client = oppex_client_create(&options, &error);
  if (client != NULL) {
    oppex_client_destroy(client);
    return Fail(report, capacity, "a blank api_key must be refused");
  }
  if (error.message[0] == '\0') {
    return Fail(report, capacity, "a refused create must fill the error message");
  }

  /* A valid client is created, and the strings are copied rather than borrowed. */
  memset(&options, 0, sizeof(options));
  options.api_key = "external-consumer-api-key";
  options.service_key = "external-consumer-service-key";
  client = oppex_client_create(&options, &error);
  if (client == NULL) {
    return Fail(report, capacity, error.message);
  }

  /* An invalid incident is rejected before any network call. */
  memset(&request, 0, sizeof(request));
  request.title = "";
  request.source = "c-api-test";
  request.severity = OPPEX_SEVERITY_MEDIUM;
  status = oppex_client_post(client, &request, NULL, &error);
  if (status != OPPEX_ERROR_INVALID_REQUEST) {
    oppex_client_destroy(client);
    return Fail(report, capacity, "a blank title must be rejected");
  }

  /* Service routing refuses a request that carries its own service key, and that
     precondition fails before any network call. */
  memset(&request, 0, sizeof(request));
  request.title = "Service routing check";
  request.source = "c-api-test";
  request.severity = OPPEX_SEVERITY_LOW;
  request.service_key = "external-consumer-service-key";
  status = oppex_client_post_with_service_routing(client, &request, NULL, &error);
  if (status != OPPEX_ERROR_INVALID_REQUEST) {
    oppex_client_destroy(client);
    return Fail(report, capacity, "service routing must refuse a request service key");
  }

  /* Every call after close reports a closed client rather than crashing. */
  oppex_client_close(client);
  memset(&request, 0, sizeof(request));
  request.title = "Closed client check";
  request.source = "c-api-test";
  request.severity = OPPEX_SEVERITY_LOW;
  status = oppex_client_post(client, &request, NULL, &error);
  if (status != OPPEX_ERROR_CLIENT_CLOSED) {
    oppex_client_destroy(client);
    return Fail(report, capacity, "a post after close must report a closed client");
  }
  status = oppex_client_post_async(client, &request, &error);
  if (status != OPPEX_ERROR_CLIENT_CLOSED) {
    oppex_client_destroy(client);
    return Fail(report, capacity, "an async post after close must report a closed client");
  }

  oppex_client_destroy(client);

  /* Null arguments are reported, not dereferenced. */
  status = oppex_client_post(NULL, NULL, NULL, &error);
  if (status != OPPEX_ERROR_INVALID_REQUEST) {
    return Fail(report, capacity, "null arguments must be reported");
  }

  /* Freeing a zeroed response, and a null one, are both safe. */
  {
    oppex_incident_response response;
    memset(&response, 0, sizeof(response));
    oppex_incident_response_free(&response);
    oppex_incident_response_free(NULL);
  }

  report[0] = '\0';
  return 0;
}
