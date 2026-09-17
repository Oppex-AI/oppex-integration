# frozen_string_literal: true

module Oppex
  # The immutable result of a delivered incident.
  #
  # +successful+ and +code+ fall back to what the HTTP status already said when
  # the response body does not carry its own.
  IncidentResponse = Data.define(:successful, :code, :message, :incident_id) do
    # @return [Boolean]
    def successful?
      successful
    end
  end
end
