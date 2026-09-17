# frozen_string_literal: true

require_relative "rate_limited_drop_logger"

module Oppex
  module Internal
    # Delivers asynchronous incidents on a fixed number of worker threads,
    # queueing the rest up to +capacity+ and dropping the oldest entry once full.
    #
    # Dropping the oldest keeps the newest incident, which is the one most likely
    # to still matter, and submission never blocks the application.
    #
    # Not public API.
    class AsyncDispatcher
      QUEUE_CAPACITY = 5000
      WORKER_COUNT = 2
      CLOSE_DRAIN_TIMEOUT_SECONDS = 10.0

      def initialize(logger, worker_count: WORKER_COUNT, capacity: QUEUE_CAPACITY)
        @logger = logger
        @capacity = capacity
        # One mutex guards the queue and every lifecycle flag together. Splitting
        # them would reintroduce the missed-wakeup race: a worker reads
        # "draining", close clears it and broadcasts, and only then does the
        # worker start waiting, on a broadcast that already happened.
        @mutex = Mutex.new
        @changed = ConditionVariable.new
        @tasks = []
        @accepting = true
        @draining = true
        @active = 0
        @drop_logger = RateLimitedDropLogger.new
        @workers = Array.new(worker_count) { Thread.new { work } }
      end

      # Queues a task, evicting the oldest queued task when the queue is full.
      # Returns whether the task was accepted; only a closed dispatcher refuses.
      #
      # rubocop:disable Naming/PredicateMethod -- this is a command that reports
      # whether it was accepted, not a question; `submit?` would read as one.
      def submit(&task)
        dropped = @mutex.synchronize do
          next :refused unless @accepting

          evicted = if @tasks.length >= @capacity
                      @tasks.shift
                      @drop_logger.record_drop
                    end
          @tasks.push(task)
          @changed.broadcast
          evicted
        end
        return false if dropped == :refused

        @logger.warn("oppex: dropped #{dropped} incidents in the last minute") if dropped
        true
      end
      # rubocop:enable Naming/PredicateMethod

      # Stops admitting work and drains what is already queued and in flight for
      # up to +timeout_seconds+, then abandons the rest. Idempotent, and safe to
      # call from any thread.
      def close(timeout_seconds = CLOSE_DRAIN_TIMEOUT_SECONDS)
        was_accepting = @mutex.synchronize do
          accepting = @accepting
          @accepting = false
          accepting
        end
        return unless was_accepting

        abandoned = drain_until(monotonic_now + timeout_seconds)

        # The workers are deliberately not joined without a bound. A Ruby thread
        # cannot be interrupted safely, so waiting on one that is blocked in an
        # HTTP attempt would push close past its own timeout. Java makes the same
        # trade: it waits for the drain, calls shutdownNow, and returns without
        # waiting for whatever that failed to interrupt.
        @workers.each { |worker| worker.join(0) }

        # Reported once and directly, rather than through the rate-limited
        # overflow counter: a shutdown loss and an overload loss are different
        # events, and a rate-limited counter's last batch can go unreported.
        @logger.warn("oppex: force-dropped #{abandoned} pending incidents during close") if abandoned.positive?
      end

      private

      def work
        loop do
          task = @mutex.synchronize do
            while @tasks.empty?
              return unless @draining

              @changed.wait(@mutex)
            end
            @active += 1
            @tasks.shift
          end

          begin
            task.call
          ensure
            @mutex.synchronize do
              @active -= 1
              @changed.broadcast
            end
          end
        end
      end

      # Waits until nothing is queued or in flight, or the deadline passes. Then
      # stops the workers and returns how many tasks were abandoned.
      def drain_until(deadline)
        @mutex.synchronize do
          until @tasks.empty? && @active.zero?
            remaining = deadline - monotonic_now
            break if remaining <= 0

            @changed.wait(@mutex, remaining)
          end

          @draining = false
          @changed.broadcast
          abandoned = @tasks.length
          @tasks.clear
          abandoned
        end
      end

      def monotonic_now
        Process.clock_gettime(Process::CLOCK_MONOTONIC)
      end
    end
  end
end
