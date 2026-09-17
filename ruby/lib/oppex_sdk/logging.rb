# frozen_string_literal: true

module Oppex
  # The default logging sink: writes one line per message to standard error.
  #
  # This SDK deliberately does not require the +logger+ standard library. It
  # stops being a default gem in Ruby 4.0, so requiring it would turn a
  # dependency-free gem into one with a runtime dependency, for four method
  # calls. Any object that responds to +debug+, +info+, +warn+ and +error+ works
  # instead, which means a host's +Logger+, +Rails.logger+, SemanticLogger or
  # anything else drops in with no adapter.
  class StderrLogger
    LEVELS = %i[debug info warn error].freeze

    LEVELS.each do |level|
      define_method(level) do |message|
        # A broken logging destination must never crash incident delivery.
        warn("[oppex-sdk] #{level.to_s.upcase} #{message}")
      rescue StandardError
        nil
      end
    end
  end
end
