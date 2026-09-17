# frozen_string_literal: true

module Oppex
  module Internal
    # Counts every dropped incident but reports at most one summary per interval.
    #
    # A saturated queue drops continuously, so logging each drop would replace
    # one overload with another. Not public API.
    class RateLimitedDropLogger
      INTERVAL_SECONDS = 60.0

      def initialize(interval_seconds: INTERVAL_SECONDS, clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) })
        @interval_seconds = interval_seconds
        @clock = clock
        @mutex = Mutex.new
        @dropped = 0
        @started_at = clock.call
      end

      # Records one drop.
      #
      # Returns the accumulated count when the interval has elapsed and the
      # caller should emit a summary, or nil otherwise. Returning the count
      # instead of logging keeps this class free of any logging decision, which
      # is also what makes it testable without capturing output.
      def record_drop
        @mutex.synchronize do
          @dropped += 1
          now = @clock.call
          next nil if now - @started_at < @interval_seconds

          dropped = @dropped
          @dropped = 0
          @started_at = now
          dropped
        end
      end
    end
  end
end
