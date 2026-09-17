# frozen_string_literal: true

# Exercises the published Ruby SDK surface from outside the project, mirroring
# .github/smoke/java/ExternalConsumer.java: only supported API, loaded from the
# installed gem rather than a path into this repository, network-free, and a
# fixed sentinel the workflow greps for.
#
# "Network-free" does not mean "never attempts an HTTP call". Port 1 on loopback
# refuses the connection immediately, so a fully valid request pointed at it
# still reaches the real transport and fails there, genuinely exercising that
# path without touching the actual Oppex service.

require "oppex_sdk"

def check_real_transport_failure
  ENV["OPPEX_TEST_ENDPOINT_URL"] = "http://127.0.0.1:1"
  client = Oppex::IncidentClient.new(api_key: "wrong-api-key", service_key: "wrong-service-key")
  request = Oppex::IncidentRequest.new(title: "valid title", source: "github-actions",
                                       severity: Oppex::Severity::MEDIUM)

  begin
    client.post(request)
    raise "a refused connection must fail"
  rescue Oppex::IncidentError => e
    raise "a refused connection must carry no HTTP status" if e.http_status?
    # Five retries plus the first attempt, so the message carries the count.
    raise "an exhausted network failure must report its attempts: #{e.message}" unless e.message.include?("attempts")
  end

  client.close
ensure
  ENV.delete("OPPEX_TEST_ENDPOINT_URL")
end

def check_validation
  # A blank title fails before any HTTP attempt.
  begin
    Oppex::IncidentRequest.new(title: "  ", source: "github-actions", severity: Oppex::Severity::MEDIUM)
    raise "a blank title must be rejected"
  rescue ArgumentError
    nil
  end

  client = Oppex::IncidentClient.new(api_key: "external-consumer-api-key",
                                     service_key: "external-consumer-service-key")
  request = Oppex::IncidentRequest.new(title: "Closed client test", source: "github-actions",
                                       severity: Oppex::Severity::LOW)
  client.close

  begin
    client.post(request)
    raise "a post after close must report a closed client"
  rescue Oppex::ClientClosedError
    nil
  end
end

# The precondition fails before any network call.
def check_service_routing
  Oppex::IncidentClient.open(api_key: "external-consumer-api-key") do |client|
    keyed = Oppex::IncidentRequest.new(title: "Service routing test", source: "github-actions",
                                       severity: Oppex::Severity::LOW,
                                       service_key: "external-consumer-service-key")
    begin
      client.post_with_service_routing(keyed)
      raise "service routing must refuse a request service key"
    rescue ArgumentError
      nil
    end
  end
end

raise "unexpected endpoint" unless Oppex::DEFAULT_ENDPOINT == "https://api.oppex.ai/api/v1/incident/post"
raise "unexpected severity mapping" unless Oppex::Severity::MEDIUM == 3

check_real_transport_failure
check_validation
check_service_routing

puts "EXTERNAL_CONSUMER_OK ruby=#{RUBY_VERSION} sdk=#{Oppex::VERSION}"
