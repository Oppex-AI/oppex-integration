# frozen_string_literal: true

module Oppex
  # Base class for every error this SDK raises on its own. Rescue this to catch
  # them all without also catching an +ArgumentError+ from your own code.
  class Error < StandardError; end

  # Raised by any post made after IncidentClient#close.
  class ClientClosedError < Error
    def initialize(message = "the incident client is closed")
      super
    end
  end

  # Raised when delivery was attempted and failed.
  class IncidentError < Error
    # The HTTP status, or NO_STATUS_CODE when the delivery never reached a
    # status line.
    NO_STATUS_CODE = -1

    # @return [Integer] the HTTP status, or {NO_STATUS_CODE}.
    attr_reader :status_code

    # @return [Exception, nil] the underlying transport or parsing failure.
    attr_reader :cause_error

    def initialize(message, status_code: NO_STATUS_CODE, retryable: false, cause_error: nil)
      super(message)
      @status_code = status_code
      @retryable = retryable
      @cause_error = cause_error
    end

    # @return [Boolean] whether the failure was eligible for retry.
    def retryable?
      @retryable
    end

    # @return [Boolean] whether an HTTP status was received at all.
    def http_status?
      @status_code != NO_STATUS_CODE
    end
  end
end
