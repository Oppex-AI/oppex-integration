# frozen_string_literal: true

module Oppex
  module Internal
    # A one-way "stop waiting" signal.
    #
    # A sleeping Ruby thread cannot be interrupted safely the way a Java thread
    # can, so a backoff delay waits on this condition variable instead of calling
    # +sleep+. Closing the client signals it once, which wakes every waiting
    # retry immediately rather than after up to eight more seconds.
    #
    # Not public API.
    class Interrupt
      def initialize
        @mutex = Mutex.new
        @changed = ConditionVariable.new
        @signalled = false
      end

      # Signals every current and future waiter. Idempotent.
      def signal
        @mutex.synchronize do
          @signalled = true
          @changed.broadcast
        end
      end

      def signalled?
        @mutex.synchronize { @signalled }
      end

      # Waits up to +seconds+. Returns true when the wait was cut short by a
      # signal, false when the full duration elapsed.
      def wait(seconds)
        deadline = monotonic_now + seconds
        @mutex.synchronize do
          until @signalled
            remaining = deadline - monotonic_now
            return false if remaining <= 0

            @changed.wait(@mutex, remaining)
          end
          true
        end
      end

      private

      # A monotonic clock, so a system clock adjustment mid-backoff cannot turn a
      # half-second wait into a very long one.
      def monotonic_now
        Process.clock_gettime(Process::CLOCK_MONOTONIC)
      end
    end
  end
end
