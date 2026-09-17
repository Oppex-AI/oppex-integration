# frozen_string_literal: true

require_relative "test_helper"

class TestWireCodec < Minitest::Test
  Codec = Oppex::Internal::WireCodec

  def request(**overrides)
    Oppex::IncidentRequest.new(title: "title", source: "source", severity: 4,
                               priority: 2, src_timestamp: 1_700_000_000_000, **overrides)
  end

  def test_serialize_omits_absent_optional_fields
    payload = Codec.serialize_request(request, nil)

    assert_equal '{"title":"title","source":"source","severity":4,"priority":2,"srcTimestamp":1700000000000}',
                 payload
  end

  def test_serialize_uses_the_agreed_field_names_and_order
    payload = Codec.serialize_request(
      request(severity: 2, priority: 1, src_timestamp: 1, component: "api", group: "payments",
              type: "latency", details: '{"p99":1200}'),
      "resolved-service-key"
    )

    assert_equal '{"serviceKey":"resolved-service-key","title":"title","source":"source","severity":2,' \
                 '"priority":1,"srcTimestamp":1,"component":"api","group":"payments","type":"latency",' \
                 '"detailsJSON":"{\"p99\":1200}"}',
                 payload
  end

  def test_serialize_escapes_values
    payload = Codec.serialize_request(request(title: %(a "quoted"\n title)), nil)

    assert_equal %(a "quoted"\n title), JSON.parse(payload)["title"]
  end

  def test_parse_reads_the_envelope
    response = Codec.parse_response(200, '{"success":true,"code":201,"message":"created","data":"INC-1"}')

    assert_predicate response, :successful?
    assert_equal 201, response.code
    assert_equal "created", response.message
    assert_equal "INC-1", response.incident_id
  end

  def test_parse_falls_back_to_the_http_status
    response = Codec.parse_response(202, "   ")

    assert_predicate response, :successful?
    assert_equal 202, response.code
    assert_nil response.incident_id
  end

  def test_parse_ignores_wrongly_typed_envelope_fields
    response = Codec.parse_response(200, '{"success":"yes","code":"201","message":7,"data":[]}')

    assert_predicate response, :successful?, "a non-boolean success must fall back to the HTTP status"
    assert_equal 200, response.code
    assert_nil response.message
    assert_nil response.incident_id
  end

  def test_parse_never_echoes_a_non_json_body
    error = assert_raises(Oppex::IncidentError) do
      Codec.parse_response(502, "<html>X-API-KEY: super-secret</html>")
    end

    refute_includes error.message, "super-secret"
    assert_equal 502, error.status_code
  end
end
