# frozen_string_literal: true

require "json"

require_relative "../errors"
require_relative "../incident_response"

module Oppex
  module Internal
    # Renders the wire payload and decodes the response envelope.
    #
    # Not public API; every method here may change in any release.
    module WireCodec
      # Wire field order. Ruby hashes preserve insertion order, and +to_json+
      # follows it, so the payload matches the other SDKs byte for byte.

      module_function

      # A nil resolved service key is omitted entirely so the API routes the
      # incident by its own rules. Every other absent optional field is omitted
      # rather than sent as null.
      def serialize_request(request, resolved_service_key)
        fields = {
          serviceKey: resolved_service_key,
          title: request.title,
          source: request.source,
          severity: request.severity,
          priority: request.priority,
          srcTimestamp: request.src_timestamp,
          component: request.component,
          group: request.group,
          type: request.type,
          detailsJSON: request.details
        }
        # One rejection covers every optional field, including the service key.
        # The required fields cannot be nil: IncidentRequest validated them.
        JSON.generate(fields.compact)
      end

      # Decodes a response body, falling back to the HTTP status for any field
      # the body does not carry.
      #
      # A body that is not JSON is never echoed into the raised error: a proxy or
      # WAF can return an error page that repeats request headers, including
      # X-API-KEY, and that text would then leak into the host's logs.
      def parse_response(http_status, body)
        successful = (200...300).cover?(http_status)
        return IncidentResponse.new(successful:, code: http_status, message: nil, incident_id: nil) if blank?(body)

        envelope = parse_json(body, http_status)
        IncidentResponse.new(
          successful: boolean_or(envelope["success"], successful),
          code: integer_or(envelope["code"], http_status),
          message: string_or_nil(envelope["message"]),
          incident_id: string_or_nil(envelope["data"])
        )
      end

      def blank?(body)
        body.nil? || body.strip.empty?
      end

      def parse_json(body, http_status)
        envelope = JSON.parse(body)
        unless envelope.is_a?(Hash)
          raise IncidentError.new("Oppex returned a non-object JSON response (status #{http_status})",
                                  status_code: http_status)
        end

        envelope
      rescue JSON::ParserError => e
        raise IncidentError.new("Oppex returned a non-JSON response (status #{http_status})",
                                status_code: http_status, cause_error: e)
      end

      def boolean_or(value, fallback)
        [true, false].include?(value) ? value : fallback
      end

      def integer_or(value, fallback)
        value.is_a?(Integer) ? value : fallback
      end

      def string_or_nil(value)
        value.is_a?(String) ? value : nil
      end
    end
  end
end
