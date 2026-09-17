# frozen_string_literal: true

require_relative "test_helper"

class TestRetryExecutor < Minitest::Test
  Retry = Oppex::Internal::RetryExecutor
  FAST = [0.001, 0.001, 0.001, 0.001, 0.001].freeze

  def setup
    @interrupt = Oppex::Internal::Interrupt.new
  end

  def test_the_retryable_status_list_is_explicit
    [429, 500, 502, 503, 504].each { |status| assert Retry.retryable_status?(status), "#{status} must retry" }
    [400, 401, 403, 404, 409, 422, 501, 505].each do |status|
      refute Retry.retryable_status?(status), "#{status} must not retry"
    end
  end

  def test_the_schedule_doubles_from_half_a_second
    assert_equal [0.5, 1.0, 2.0, 4.0, 8.0], Retry::DEFAULT_DELAYS
  end

  def test_stops_at_the_first_success
    attempts = 0
    result = Retry.execute(@interrupt, delays: FAST) do
      attempts += 1
      raise Oppex::IncidentError.new("503", status_code: 503, retryable: true) if attempts < 3

      "delivered"
    end

    assert_equal "delivered", result
    assert_equal 3, attempts
  end

  def test_does_not_retry_a_non_retryable_failure
    attempts = 0
    assert_raises(Oppex::IncidentError) do
      Retry.execute(@interrupt, delays: FAST) do
        attempts += 1
        raise Oppex::IncidentError.new("401", status_code: 401)
      end
    end

    assert_equal 1, attempts
  end

  def test_exhausts_the_schedule_without_rewriting_an_http_failure
    attempts = 0
    error = assert_raises(Oppex::IncidentError) do
      Retry.execute(@interrupt, delays: FAST) do
        attempts += 1
        raise Oppex::IncidentError.new("Oppex returned HTTP 503", status_code: 503, retryable: true)
      end
    end

    assert_equal FAST.length + 1, attempts
    assert_equal "Oppex returned HTTP 503", error.message
  end

  def test_annotates_only_a_failure_that_never_reached_a_status_line
    error = assert_raises(Oppex::IncidentError) do
      Retry.execute(@interrupt, delays: FAST) do
        raise Oppex::IncidentError.new("connection refused", retryable: true)
      end
    end

    assert_equal "connection refused (after 6 attempts)", error.message
  end

  def test_a_signalled_interrupt_ends_the_backoff_immediately
    @interrupt.signal
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    error = assert_raises(Oppex::IncidentError) do
      Retry.execute(@interrupt) do
        raise Oppex::IncidentError.new("503", status_code: 503, retryable: true)
      end
    end

    assert_includes error.message, "interrupted"
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 1.0
  end
end
