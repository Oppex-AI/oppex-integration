/*
 * The same example through the C ABI.
 *
 *   OPPEX_API_KEY=... OPPEX_SERVICE_KEY=... ./oppex_example_plain_c
 */

#include "oppex/oppex.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
  oppex_client_options options;
  oppex_incident_request request;
  oppex_incident_response response;
  oppex_error error;
  oppex_client* client;
  oppex_status status;

  memset(&options, 0, sizeof(options));
  options.api_key = getenv("OPPEX_API_KEY");
  options.service_key = getenv("OPPEX_SERVICE_KEY");

  client = oppex_client_create(&options, &error);
  if (client == NULL) {
    fprintf(stderr, "oppex example failed: %s\n", error.message);
    return 1;
  }

  memset(&request, 0, sizeof(request));
  request.title = "Checkout latency breached the SLO";
  request.source = "checkout-api";
  request.severity = OPPEX_SEVERITY_HIGH;
  request.priority = 2;
  request.component = "payments";
  request.group = "platform";
  request.type = "latency";
  request.details = "{\"p99Millis\":1200,\"threshold\":800}";

  memset(&response, 0, sizeof(response));
  status = oppex_client_post(client, &request, &response, &error);
  if (status != OPPEX_OK) {
    fprintf(stderr, "oppex example failed: %s\n", error.message);
    oppex_client_destroy(client);
    return 1;
  }

  printf("incident %s created (code %d)\n",
         response.incident_id != NULL ? response.incident_id : "(none)", response.code);
  oppex_incident_response_free(&response);

  /* Fire and forget. Validation still fails fast here. */
  memset(&request, 0, sizeof(request));
  request.title = "Background job queue is backing up";
  request.source = "worker";
  request.severity = OPPEX_SEVERITY_LOW;
  oppex_client_post_async(client, &request, &error);

  /* Destroying closes first, draining queued incidents for up to ten seconds. */
  oppex_client_destroy(client);
  return 0;
}
