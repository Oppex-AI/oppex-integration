# frozen_string_literal: true

require_relative "errors"
require_relative "incident_request"
require_relative "internal/async_dispatcher"
require_relative "internal/http_executor"
require_relative "internal/interrupt"
require_relative "internal/retry_executor"
require_relative "internal/wire_codec"
require_relative "logging"

module Oppex
  # Posts incidents to Oppex.
  #
  #   client = Oppex::IncidentClient.new(api_key: "api-key", service_key: "service-key")
  #   client.post(request)
  #   client.close
  #
  # The client is thread safe and intended to be shared. Create one per
  # application and close it during shutdown. It is also usable as a block:
  #
  #   Oppex::IncidentClient.open(api_key: "api-key") do |client|
  #     client.post_with_service_routing(request)
  #   end
  class IncidentClient
    # Creates a client, yields it, and closes it even if the block raises.
    #
    # @yieldparam client [IncidentClient]
    def self.open(...)
      client = new(...)
      begin
        yield client
      ensure
        client.close
      end
    end

    # @param api_key [String] sent in the +X-API-KEY+ header. Required.
    # @param service_key [String, nil] the default service for incidents that do
    #   not carry their own. When omitted, incidents must either supply one or be
    #   posted with {#post_with_service_routing}.
    # @param logger [#debug, #info, #warn, #error] receives this client's
    #   internal logging. Any object with those four methods works, including a
    #   standard +Logger+, +Rails.logger+, or your own.
    def initialize(api_key:, service_key: nil, logger: StderrLogger.new)
      @api_key = validate_api_key(api_key)
      @service_key = blank_to_nil(service_key, "service_key")
      @logger = logger
      @http_executor = Internal::HttpExecutor.new(@api_key)
      @interrupt = Internal::Interrupt.new
      @dispatcher = Internal::AsyncDispatcher.new(logger)
      @retry_delays = Internal::RetryExecutor::DEFAULT_DELAYS
      @closed = false
      @lifecycle = Mutex.new
    end

    # Posts on the calling thread, including any retry delays. The request's own
    # service key overrides the client's.
    #
    # @return [IncidentResponse]
    # @raise [ClientClosedError] after {#close}
    # @raise [ArgumentError] when neither the client nor the request carries a
    #   service key
    # @raise [IncidentError] when delivery fails
    def post(request)
      ensure_open!
      require_service_key!(request)
      deliver(request, @service_key)
    end

    # Posts without a service key so Oppex resolves the target service itself.
    # The request must not carry its own service key. Otherwise identical to
    # {#post}.
    #
    # @return [IncidentResponse]
    def post_with_service_routing(request)
      ensure_open!
      require_service_routable!(request)
      deliver(request, nil)
    end

    # Queues a best-effort delivery and returns immediately.
    #
    # The closed-client and service-key checks still run on the calling thread, so
    # a misuse is raised to the caller rather than lost in a worker. A delivery
    # failure after queueing is logged at debug level.
    #
    # @return [void]
    def post_async(request)
      ensure_open!
      require_service_key!(request)
      submit(request, @service_key)
    end

    # Queues a best-effort service-routed delivery. The request must not carry its
    # own service key.
    #
    # @return [void]
    def post_async_with_service_routing(request)
      ensure_open!
      require_service_routable!(request)
      submit(request, nil)
    end

    # @return [Boolean] whether {#close} has been called.
    def closed?
      @lifecycle.synchronize { @closed }
    end

    # Drains queued work for up to ten seconds, then releases every owned
    # resource. Idempotent, and safe to call from any thread.
    #
    # @return [void]
    def close
      @lifecycle.synchronize do
        return if @closed

        @closed = true
      end
      # Signalled before the drain so a worker sitting in an eight-second backoff
      # gives up now instead of consuming the whole drain budget.
      @interrupt.signal
      @dispatcher.close
      @http_executor.close
      nil
    end

    private

    def validate_api_key(api_key)
      raise TypeError, "api_key must be a String" unless api_key.is_a?(String)
      raise ArgumentError, "api_key must not be blank" if api_key.strip.empty?

      api_key
    end

    def blank_to_nil(value, field)
      return nil if value.nil?
      raise TypeError, "#{field} must be a String" unless value.is_a?(String)

      value.strip.empty? ? nil : value
    end

    def ensure_open!
      raise ClientClosedError if closed?
    end

    # Service routing is the only delivery mode available when no service key is
    # configured anywhere.
    def require_service_key!(request)
      return unless @service_key.nil? && request.service_key.nil?

      raise ArgumentError, "no service_key is configured on the client or the request; " \
                           "supply one or use post_with_service_routing"
    end

    def require_service_routable!(request)
      return if request.service_key.nil?

      raise ArgumentError, "request must not carry a service_key when service routing is used"
    end

    def submit(request, default_service_key)
      accepted = @dispatcher.submit do
        # No closed check here: close drains the dispatcher before releasing the
        # transport, so a task queued before close still has a live connection,
        # and a task submitted after close was already refused above.
        deliver(request, default_service_key)
      rescue IncidentError => e
        @logger.debug("oppex: asynchronous incident delivery failed: #{e.message}")
      end
      raise ClientClosedError unless accepted

      nil
    end

    # Serializes, sends and retries a single incident. The request's own service
    # key wins over +default_service_key+.
    def deliver(request, default_service_key)
      service_key = request.service_key || default_service_key
      payload = Internal::WireCodec.serialize_request(request, service_key)
      Internal::RetryExecutor.execute(@interrupt, delays: @retry_delays) do
        @http_executor.execute(payload)
      end
    end
  end
end
