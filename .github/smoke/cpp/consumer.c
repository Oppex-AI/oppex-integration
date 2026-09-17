/*
 * The same checks through the installed C ABI, compiled as C.
 *
 * That is the point of this file: it proves <oppex/oppex.h> is usable from a
 * plain C translation unit linked against the installed library, which no
 * consumer written in C++ can prove.
 *
 * Network-free: every case here fails validation before any HTTP attempt.
 */

#include <oppex/oppex.h>

#include <stdio.h>
#include <string.h>

static int Fail(const char* message) {
  fprintf(stderr, "%s\n", message);
  return 1;
}

int main(void) {
  oppex_client_options options;
  oppex_incident_request request;
  oppex_error error;
  oppex_client* client;
  oppex_status status;

  if (strcmp(OPPEX_DEFAULT_ENDPOINT, "https://api.oppex.ai/api/v1/incident/post") != 0) {
    return Fail("unexpected endpoint");
  }
  if (OPPEX_SEVERITY_MEDIUM != 3) {
    return Fail("unexpected severity mapping");
  }

  memset(&options, 0, sizeof(options));
  options.api_key = "   ";
  client = oppex_client_create(&options, &error);
  if (client != NULL) {
    oppex_client_destroy(client);
    return Fail("a blank api_key must be refused");
  }

  memset(&options, 0, sizeof(options));
  options.api_key = "external-consumer-api-key";
  options.service_key = "external-consumer-service-key";
  client = oppex_client_create(&options, &error);
  if (client == NULL) {
    return Fail(error.message);
  }

  memset(&request, 0, sizeof(request));
  request.title = "  ";
  request.source = "github-actions";
  request.severity = OPPEX_SEVERITY_MEDIUM;
  status = oppex_client_post(client, &request, NULL, &error);
  if (status != OPPEX_ERROR_INVALID_REQUEST) {
    oppex_client_destroy(client);
    return Fail("a blank title must be rejected");
  }

  /* Service routing refuses a request that carries its own service key. */
  memset(&request, 0, sizeof(request));
  request.title = "Service routing test";
  request.source = "github-actions";
  request.severity = OPPEX_SEVERITY_LOW;
  request.service_key = "external-consumer-service-key";
  status = oppex_client_post_with_service_routing(client, &request, NULL, &error);
  if (status != OPPEX_ERROR_INVALID_REQUEST) {
    oppex_client_destroy(client);
    return Fail("service routing must refuse a request service key");
  }

  oppex_client_close(client);
  memset(&request, 0, sizeof(request));
  request.title = "Closed client test";
  request.source = "github-actions";
  request.severity = OPPEX_SEVERITY_LOW;
  status = oppex_client_post(client, &request, NULL, &error);
  if (status != OPPEX_ERROR_CLIENT_CLOSED) {
    oppex_client_destroy(client);
    return Fail("a post after close must report a closed client");
  }

  oppex_client_destroy(client);
  printf("EXTERNAL_CONSUMER_C_OK cpp sdk=%s\n", oppex_version());
  return 0;
}
