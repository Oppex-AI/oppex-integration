# frozen_string_literal: true

module Oppex
  # Oppex incident severity, on a scale from 1 (lowest) to 5 (highest).
  #
  # The constants are the wire values, so an integer from another system can be
  # passed straight through after {Severity.validate!}.
  module Severity
    LOWEST = 1
    LOW = 2
    MEDIUM = 3
    HIGH = 4
    CRITICAL = 5

    ALL = [LOWEST, LOW, MEDIUM, HIGH, CRITICAL].freeze

    NAMES = {
      LOWEST => "LOWEST",
      LOW => "LOW",
      MEDIUM => "MEDIUM",
      HIGH => "HIGH",
      CRITICAL => "CRITICAL"
    }.freeze

    class << self
      # @return [Boolean] whether +value+ is within the Oppex scale.
      def valid?(value)
        ALL.include?(value)
      end

      # @return [Integer] +value+ unchanged.
      # @raise [ArgumentError] when +value+ is outside 1 to 5.
      # @raise [TypeError] when +value+ is not an Integer.
      def validate!(value)
        # true and false are not Integers in Ruby, so no bool special case is
        # needed the way the Python SDK needs one.
        raise TypeError, "severity must be an Integer" unless value.is_a?(Integer)
        raise ArgumentError, "severity must be between 1 and 5" unless valid?(value)

        value
      end

      # @return [String, nil] the constant name for a wire value.
      def name_for(value)
        NAMES[value]
      end
    end
  end
end
