# frozen_string_literal: true

require_relative "errors"
require_relative "severity"

module Oppex
  # A validated, immutable incident submission.
  #
  # Validation happens in the constructor, so a malformed incident is rejected at
  # the call site rather than inside a worker thread where only a log line would
  # remain.
  #
  #   request = Oppex::IncidentRequest.new(
  #     title: "Checkout latency breached the SLO",
  #     source: "checkout-api",
  #     severity: Oppex::Severity::HIGH
  #   )
  #
  # A request may override the service key configured on the client.
  class IncidentRequest
    # The maximum length of +source+, counted in characters.
    MAX_SOURCE_LENGTH = 255

    attr_reader :title, :source, :severity, :priority, :src_timestamp,
                :service_key, :component, :group, :type, :details

    def initialize(title:, source:, severity:, priority: 1, src_timestamp: nil,
                   service_key: nil, component: nil, group: nil, type: nil, details: nil)
      @title = require_non_blank(title, "title")
      @source = require_source(source)
      @severity = Severity.validate!(severity)
      @priority = validate_priority(priority)
      @src_timestamp = validate_timestamp(src_timestamp)
      @service_key = reject_blank(service_key, "service_key")
      @component = reject_blank(component, "component")
      @group = reject_blank(group, "group")
      @type = reject_blank(type, "type")
      @details = reject_blank(details, "details")
      freeze
    end

    private

    def require_non_blank(value, field)
      raise TypeError, "#{field} must be a String" unless value.is_a?(String)
      raise ArgumentError, "#{field} must not be blank" if value.strip.empty?

      value
    end

    def require_source(source)
      source = require_non_blank(source, "source")
      raise ArgumentError, "source must not exceed #{MAX_SOURCE_LENGTH} characters" if source.length > MAX_SOURCE_LENGTH

      source
    end

    # An optional field may be absent, but a present-yet-blank value is nearly
    # always a bug at the call site, so it is rejected rather than silently sent.
    def reject_blank(value, field)
      return nil if value.nil?

      require_non_blank(value, field)
    end

    def validate_priority(priority)
      raise TypeError, "priority must be an Integer" unless priority.is_a?(Integer)
      raise ArgumentError, "priority must be between 1 and 5" unless (1..5).cover?(priority)

      priority
    end

    def validate_timestamp(src_timestamp)
      return (Time.now.to_f * 1000).to_i if src_timestamp.nil?

      raise TypeError, "src_timestamp must be an Integer" unless src_timestamp.is_a?(Integer)
      raise ArgumentError, "src_timestamp must be greater than zero" unless src_timestamp.positive?

      src_timestamp
    end
  end
end
