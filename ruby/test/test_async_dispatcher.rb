# frozen_string_literal: true

require_relative "test_helper"

class TestAsyncDispatcher < Minitest::Test
  Dispatcher = Oppex::Internal::AsyncDispatcher

  def setup
    @logger = SilentLogger.new
  end

  def test_runs_submitted_work
    dispatcher = Dispatcher.new(@logger, worker_count: 2, capacity: 10)
    delivered = Queue.new

    5.times { |index| assert(dispatcher.submit { delivered.push(index) }) }
    dispatcher.close(5)

    assert_equal [0, 1, 2, 3, 4], Array.new(delivered.size) { delivered.pop }.sort
  end

  def test_drops_the_oldest_queued_task_when_full
    # One worker, held on a gate, so everything else has to queue.
    dispatcher = Dispatcher.new(@logger, worker_count: 1, capacity: 2)
    gate = Queue.new
    started = Queue.new
    dispatcher.submit do
      started.push(:started)
      gate.pop
    end
    started.pop

    ran = Queue.new
    %w[oldest middle newest].each { |name| dispatcher.submit { ran.push(name) } }

    gate.push(:go)
    dispatcher.close(5)

    names = Array.new(ran.size) { ran.pop }

    assert_equal 2, names.length, "the queue holds two tasks, so one must be dropped: #{names}"
    refute_includes names, "oldest", "the oldest queued task must be the one dropped"
  end

  def test_refuses_work_after_close_and_close_is_idempotent
    dispatcher = Dispatcher.new(@logger, worker_count: 1, capacity: 4)
    dispatcher.close(1)
    dispatcher.close(1)

    refute(dispatcher.submit { flunk "a closed dispatcher must refuse work" })
  end

  def test_close_gives_up_on_work_that_outlasts_the_drain_timeout
    dispatcher = Dispatcher.new(@logger, worker_count: 1, capacity: 10)
    gate = Queue.new
    started = Queue.new
    dispatcher.submit do
      started.push(:started)
      gate.pop
    end
    started.pop

    ran = Queue.new
    dispatcher.submit { ran.push(:abandoned) }

    began = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    dispatcher.close(0.1)
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - began

    assert_operator elapsed, :<, 5, "close waited #{elapsed}s, well past its timeout"
    assert_equal 0, ran.size, "an abandoned task must not run"
    gate.push(:go)
  end

  def test_the_drop_logger_reports_at_most_once_per_interval
    logger = Oppex::Internal::RateLimitedDropLogger.new(interval_seconds: 60)

    10.times { assert_nil logger.record_drop, "no summary is due inside the interval" }

    elapsed = Oppex::Internal::RateLimitedDropLogger.new(interval_seconds: 0)

    assert_equal 1, elapsed.record_drop
    # The counter resets, so the next interval starts from zero rather than
    # re-reporting everything seen so far.
    assert_equal 1, elapsed.record_drop
  end
end
