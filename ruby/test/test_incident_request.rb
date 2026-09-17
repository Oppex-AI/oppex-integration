# frozen_string_literal: true

require_relative "test_helper"

class TestIncidentRequest < Minitest::Test
  def build(**overrides)
    Oppex::IncidentRequest.new(title: "title", source: "source", severity: 3, **overrides)
  end

  def test_applies_the_documented_defaults
    request = build

    assert_equal 1, request.priority
    assert_operator request.src_timestamp, :>, 0
    assert_nil request.component
    assert_nil request.service_key
  end

  def test_keeps_explicit_values
    request = build(priority: 4, src_timestamp: 1_700_000_000_000, service_key: "request-service-key",
                    component: "api", group: "payments", type: "latency", details: '{"p99":1200}')

    assert_equal 4, request.priority
    assert_equal 1_700_000_000_000, request.src_timestamp
    assert_equal "request-service-key", request.service_key
    assert_equal "latency", request.type
  end

  def test_is_frozen
    assert_predicate build, :frozen?
  end

  def test_rejects_blank_required_fields
    assert_raises(ArgumentError) { build(title: "   ") }
    assert_raises(ArgumentError) { build(source: "") }
  end

  def test_rejects_wrongly_typed_required_fields
    assert_raises(TypeError) { build(title: nil) }
    assert_raises(TypeError) { build(source: 42) }
  end

  def test_enforces_the_source_length_cap
    assert_equal 255, build(source: "a" * 255).source.length
    assert_raises(ArgumentError) { build(source: "a" * 256) }
  end

  def test_rejects_a_blank_optional_field
    %i[service_key component group type details].each do |field|
      assert_raises(ArgumentError) { build(field => "  ") }
    end
  end

  def test_rejects_out_of_range_numbers
    assert_raises(ArgumentError) { build(priority: 0) }
    assert_raises(ArgumentError) { build(priority: 6) }
    assert_raises(ArgumentError) { build(src_timestamp: 0) }
    assert_raises(ArgumentError) { build(src_timestamp: -1) }
  end

  def test_rejects_wrongly_typed_numbers
    assert_raises(TypeError) { build(priority: "1") }
    assert_raises(TypeError) { build(src_timestamp: 1.5) }
  end
end
