# frozen_string_literal: true

require_relative "../errors"

module Oppex
  module Internal
    # The retry policy. Not public API.
    module RetryExecutor
      # Five retries after the first attempt, doubling, without jitter.
      # Deliberately not configurable.
      DEFAULT_DELAYS = [0.5, 1.0, 2.0, 4.0, 8.0].freeze

      # An explicit list rather than "any 5xx". Widening it is a deliberate
      # policy change, not an incidental one.
      RETRYABLE_STATUSES = [429, 500, 502, 503, 504].freeze

      INTERRUPTED_MESSAGE = "incident delivery was interrupted during retry"

      module_function

      def retryable_status?(status)
        RETRYABLE_STATUSES.include?(status)
      end

      # Runs the block until it succeeds, fails with a non-retryable error, or
      # exhausts +delays+.
      #
      # Only the final failure is raised. Individual attempts are never logged,
      # so a saturated Oppex API cannot flood the host's logs.
      def execute(interrupt, delays: DEFAULT_DELAYS)
        attempt = 0
        loop do
          begin
            return yield
          rescue IncidentError => e
            raise annotate(e, attempt + 1) if !e.retryable? || attempt >= delays.length

            raise IncidentError, INTERRUPTED_MESSAGE if interrupt.wait(delays[attempt])
          end
          attempt += 1
        end
      end

      # Annotates only a failure that never reached a status line. An HTTP
      # failure keeps the message its status already explains.
      def annotate(error, attempts)
        return error if error.http_status? || attempts < 2

        IncidentError.new("#{error.message} (after #{attempts} attempts)",
                          status_code: error.status_code,
                          retryable: error.retryable?,
                          cause_error: error.cause_error)
      end
    end
  end
end
