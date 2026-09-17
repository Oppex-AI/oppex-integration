# frozen_string_literal: true

require "net/http"
require "uri"

require_relative "../endpoint"
require_relative "../errors"
require_relative "retry_executor"
require_relative "wire_codec"

module Oppex
  module Internal
    # The HTTP adapter. Not public API.
    class HttpExecutor
      OPEN_TIMEOUT_SECONDS = 3
      READ_TIMEOUT_SECONDS = 5
      WRITE_TIMEOUT_SECONDS = 5
      # The API returns a small envelope. Anything larger is a misbehaving proxy,
      # and reading it in full would let that proxy dictate this client's memory
      # use.
      MAX_RESPONSE_BYTES = 1024 * 1024

      # Resolves the target URL.
      #
      # The override exists so tests and the external smoke consumer can point the
      # whole delivery path at a loopback server. It is deliberately not client
      # configuration, which would add a public knob that exists only to ease
      # testing.
      def self.resolve_endpoint
        override = ENV.fetch("OPPEX_TEST_ENDPOINT_URL", nil)
        override.nil? || override.empty? ? Oppex::DEFAULT_ENDPOINT : override
      end

      def initialize(api_key, endpoint: nil)
        @api_key = api_key
        @uri = URI.parse(endpoint || self.class.resolve_endpoint)
      end

      # Performs one attempt. Every failure it raises is an IncidentError whose
      # +retryable?+ already carries the retry decision, so the retry policy never
      # has to know which library raised what.
      def execute(payload)
        response = send_request(payload)
        status = response.code.to_i
        body = truncate(response.body)

        return WireCodec.parse_response(status, body) if (200...300).cover?(status)

        raise status_failure(status, body)
      end

      def close
        # Net::HTTP instances are not thread safe, so this executor opens a
        # connection per attempt rather than holding a pool. There is nothing to
        # release here; the method exists so the client's lifecycle stays the same
        # shape as every other Oppex SDK's.
        nil
      end

      private

      def send_request(payload)
        request = Net::HTTP::Post.new(@uri)
        request["Content-Type"] = "application/json"
        request["Accept"] = "application/json"
        request["X-API-KEY"] = @api_key
        request.body = payload

        Net::HTTP.start(@uri.hostname, @uri.port, use_ssl: @uri.scheme == "https",
                                                  open_timeout: OPEN_TIMEOUT_SECONDS,
                                                  read_timeout: READ_TIMEOUT_SECONDS,
                                                  write_timeout: WRITE_TIMEOUT_SECONDS) do |http|
          http.request(request)
        end
      rescue StandardError => e
        # No status line was received, so the failure is transport-level and
        # retryable regardless of which library raised it. Catching StandardError
        # rather than an enumerated list is deliberate: Net::HTTP, OpenSSL,
        # resolv and socket code between them raise well over a dozen classes, and
        # an omission would escape as a raw exception from a public method.
        raise IncidentError.new("incident delivery failed before a response was received",
                                retryable: true, cause_error: e)
      end

      def truncate(body)
        return body if body.nil? || body.bytesize <= MAX_RESPONSE_BYTES

        body.byteslice(0, MAX_RESPONSE_BYTES)
      end

      # Turns a non-2xx response into a delivery failure, adding the API's own
      # message when the body carries one.
      def status_failure(status, body)
        message = "Oppex returned HTTP #{status}"
        detail = begin
          WireCodec.parse_response(status, body).message
        rescue IncidentError
          nil # The status code remains sufficient when the body is not JSON.
        end
        message = "#{message}: #{detail}" if detail && !detail.strip.empty?

        IncidentError.new(message, status_code: status, retryable: RetryExecutor.retryable_status?(status))
      end
    end
  end
end
