# frozen_string_literal: true

# Post incidents to the Oppex incident API.
#
#   POST https://api.oppex.ai/api/v1/incident/post
#
#   client = Oppex::IncidentClient.new(api_key: "api-key", service_key: "service-key")
#   request = Oppex::IncidentRequest.new(
#     title: "Checkout latency breached the SLO",
#     source: "checkout-api",
#     severity: Oppex::Severity::HIGH
#   )
#   response = client.post(request)
#   client.close
#
# The service key is optional. A client built with only an +api_key+ posts with
# IncidentClient#post_with_service_routing, which omits +serviceKey+ from the
# payload so the API resolves the target service itself.
#
# Create one client per application, share it across threads, and close it during
# application shutdown.
module Oppex
end

require_relative "oppex_sdk/version"
require_relative "oppex_sdk/endpoint"
require_relative "oppex_sdk/errors"
require_relative "oppex_sdk/logging"
require_relative "oppex_sdk/severity"
require_relative "oppex_sdk/incident_request"
require_relative "oppex_sdk/incident_response"
require_relative "oppex_sdk/incident_client"
