# frozen_string_literal: true

# Posts one incident synchronously and one asynchronously.
#
#   OPPEX_API_KEY=... OPPEX_SERVICE_KEY=... ruby -Ilib examples/plain.rb

require "oppex_sdk"

Oppex::IncidentClient.open(api_key: ENV.fetch("OPPEX_API_KEY"),
                           service_key: ENV.fetch("OPPEX_SERVICE_KEY")) do |client|
  response = client.post(
    Oppex::IncidentRequest.new(
      title: "Checkout latency breached the SLO",
      source: "checkout-api",
      severity: Oppex::Severity::HIGH,
      priority: 2,
      component: "payments",
      group: "platform",
      type: "latency",
      details: JSON.generate({ p99Millis: 1200, threshold: 800 })
    )
  )
  puts "incident #{response.incident_id} created (code #{response.code})"

  # Fire and forget. Validation still fails fast here; a delivery failure after
  # this point is logged rather than raised.
  client.post_async(
    Oppex::IncidentRequest.new(
      title: "Background job queue is backing up",
      source: "worker",
      severity: Oppex::Severity::LOW
    )
  )
end
# The block form closes the client on the way out, draining queued incidents for
# up to ten seconds.
