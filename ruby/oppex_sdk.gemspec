# frozen_string_literal: true

require_relative "lib/oppex_sdk/version"

Gem::Specification.new do |spec|
  spec.name = "oppex_sdk"
  spec.version = Oppex::VERSION
  spec.summary = "Oppex incident API client"
  spec.description = "Post incidents to the Oppex incident API. Standard library only, thread safe, " \
                     "with synchronous and best-effort asynchronous delivery."
  spec.authors = ["Oppex"]
  spec.license = "Apache-2.0"
  spec.homepage = "https://github.com/Oppex-AI/oppex-integration"

  spec.metadata = {
    "source_code_uri" => "https://github.com/Oppex-AI/oppex-integration/tree/master/ruby",
    "documentation_uri" => "https://github.com/Oppex-AI/oppex-integration/blob/master/ruby/README.md",
    "bug_tracker_uri" => "https://github.com/Oppex-AI/oppex-integration/issues",
    "rubygems_mfa_required" => "true"
  }

  # Current stable Ruby only. Data.define (3.2) is the hard floor; there is no
  # older-runtime compatibility to preserve here.
  spec.required_ruby_version = ">= 3.2"

  # The published gem carries the library and its metadata, and nothing else.
  # The CI smoke consumer installs this built gem, so a file missing here fails
  # before the gem can reach RubyGems.
  spec.files = Dir["lib/**/*.rb"] + ["README.md", "LICENSE"]
  spec.require_paths = ["lib"]

  # No runtime dependencies, deliberately: net/http, json and logger are all
  # standard library. Adding one is a decision to record in CLAUDE.md first.
end
