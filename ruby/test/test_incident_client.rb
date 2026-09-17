# frozen_string_literal: true

require_relative "test_helper"

class TestIncidentClient < Minitest::Test
  CREATED = '{"success":true,"code":200,"message":"created","data":"INC-42"}'
  FAST_RETRIES = [0.001, 0.001, 0.001, 0.001, 0.001].freeze

  def setup
    @servers = []
    @clients = []
  end

  def teardown
    @clients.each(&:close)
    @servers.each(&:shutdown)
    ENV.delete("OPPEX_TEST_ENDPOINT_URL")
  end

  def start_server(responses = [[200, CREATED]])
    server = StubServer.new(responses)
    @servers << server
    # The endpoint seam is an environment variable rather than a constructor
    # argument, so the public surface never grows a knob that exists only to ease
    # testing. Minitest runs serially by default, so setting it per test is safe.
    ENV["OPPEX_TEST_ENDPOINT_URL"] = server.url
    server
  end

  def build_client(service_key: "client-service-key")
    client = Oppex::IncidentClient.new(api_key: "api-key", service_key:, logger: SilentLogger.new)
    # The retry schedule is part of the shared incident contract, not
    # configuration, so there is no public way to shorten it. A test reaching in
    # here is the deliberate alternative to adding one.
    client.instance_variable_set(:@retry_delays, FAST_RETRIES)
    @clients << client
    client
  end

  def request(**overrides)
    Oppex::IncidentRequest.new(title: "Checkout latency", source: "checkout-api",
                               severity: Oppex::Severity::HIGH,
                               src_timestamp: 1_700_000_000_000, **overrides)
  end

  def test_rejects_a_missing_or_blank_api_key
    assert_raises(ArgumentError) { Oppex::IncidentClient.new(api_key: "   ") }
    assert_raises(TypeError) { Oppex::IncidentClient.new(api_key: nil) }
  end

  def test_post_returns_the_parsed_response
    start_server
    response = build_client.post(request)

    assert_predicate response, :successful?
    assert_equal "INC-42", response.incident_id
    assert_equal "created", response.message
  end

  def test_post_sends_the_agreed_headers
    server = start_server
    build_client.post(request)
    sent = server.next_request

    assert_equal "api-key", sent.header("X-API-KEY")
    assert_equal "application/json", sent.header("Content-Type")
    assert_equal "application/json", sent.header("Accept")
  end

  def test_post_sends_the_agreed_payload
    server = start_server
    build_client.post(request)
    payload = server.next_request.payload

    assert_equal "client-service-key", payload["serviceKey"]
    assert_equal "Checkout latency", payload["title"]
    assert_equal 4, payload["severity"]
    assert_equal 1, payload["priority"]
    assert_equal 1_700_000_000_000, payload["srcTimestamp"]
    refute payload.key?("component"), "an absent optional field must be omitted"
  end

  def test_a_request_service_key_overrides_the_clients
    server = start_server
    build_client.post(request(service_key: "request-service-key"))

    assert_equal "request-service-key", server.next_request.payload["serviceKey"]
  end

  def test_post_requires_a_service_key_somewhere
    server = start_server

    assert_raises(ArgumentError) { build_client(service_key: nil).post(request) }
    assert_equal 0, server.request_count
  end

  def test_service_routing_omits_the_service_key
    server = start_server
    build_client.post_with_service_routing(request)

    refute server.next_request.payload.key?("serviceKey"),
           "service routing must omit serviceKey entirely"
  end

  def test_service_routing_refuses_a_request_service_key
    server = start_server

    assert_raises(ArgumentError) do
      build_client(service_key: nil).post_with_service_routing(request(service_key: "request-service-key"))
    end
    assert_equal 0, server.request_count
  end

  def test_post_retries_a_retryable_status
    server = start_server([[503, ""], [503, ""], [200, CREATED]])
    response = build_client.post(request)

    assert_predicate response, :successful?
    3.times { server.next_request }
  end

  def test_post_fails_immediately_on_a_non_retryable_status
    server = start_server([[401, '{"success":false,"message":"invalid api key"}']])

    error = assert_raises(Oppex::IncidentError) { build_client.post(request) }

    assert_equal 401, error.status_code
    refute_predicate error, :retryable?
    assert_includes error.message, "invalid api key"

    server.next_request

    assert_equal 0, server.request_count
  end

  def test_post_async_delivers_and_validates_on_the_calling_thread
    server = start_server

    assert_raises(ArgumentError) { build_client(service_key: nil).post_async(request) }

    build_client.post_async(request)

    assert_equal "client-service-key", server.next_request.payload["serviceKey"]
  end

  def test_every_post_fails_on_a_closed_client
    server = start_server
    client = build_client
    client.close
    client.close

    assert_predicate client, :closed?
    assert_raises(Oppex::ClientClosedError) { client.post(request) }
    assert_raises(Oppex::ClientClosedError) { client.post_async(request) }
    assert_raises(Oppex::ClientClosedError) { client.post_with_service_routing(request) }
    assert_equal 0, server.request_count
  end

  def test_open_closes_the_client_even_when_the_block_raises
    start_server
    captured = nil

    assert_raises(RuntimeError) do
      Oppex::IncidentClient.open(api_key: "api-key", service_key: "k", logger: SilentLogger.new) do |client|
        captured = client
        raise "boom"
      end
    end

    assert_predicate captured, :closed?
  end

  def test_the_client_is_shareable_across_threads
    server = start_server
    client = build_client

    8.times.map { Thread.new { client.post(request) } }.each(&:join)

    8.times { server.next_request }
  end
end
