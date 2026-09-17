# frozen_string_literal: true

require_relative "test_helper"

class TestSeverity < Minitest::Test
  def test_wire_values_match_the_oppex_scale
    assert_equal 1, Oppex::Severity::LOWEST
    assert_equal 2, Oppex::Severity::LOW
    assert_equal 3, Oppex::Severity::MEDIUM
    assert_equal 4, Oppex::Severity::HIGH
    assert_equal 5, Oppex::Severity::CRITICAL
  end

  def test_validate_accepts_every_value_on_the_scale
    Oppex::Severity::ALL.each { |value| assert_equal value, Oppex::Severity.validate!(value) }
  end

  def test_validate_rejects_values_outside_the_scale
    [0, -1, 6, 100].each do |value|
      assert_raises(ArgumentError) { Oppex::Severity.validate!(value) }
    end
  end

  def test_validate_rejects_non_integers
    ["3", 3.0, nil, true].each do |value|
      assert_raises(TypeError) { Oppex::Severity.validate!(value) }
    end
  end

  def test_name_for_returns_the_constant_name
    assert_equal "MEDIUM", Oppex::Severity.name_for(3)
    assert_nil Oppex::Severity.name_for(9)
  end
end
