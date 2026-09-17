# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "socket"

$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))
require "oppex_sdk"

# A loopback stand-in for the Oppex API. Tests never reach the real service; only
# the local listener started here.
#
# Written directly on TCPServer rather than pulling in a stubbing gem: this SDK
# has no runtime or test dependencies beyond the standard library, and a stub
# small enough to read in one screen is a better guarantee than a mock framework.
class StubServer
  Request = Struct.new(:headers, :body) do
    def header(name)
      prefix = "#{name.downcase}:"
      found = headers.find { |header| header.downcase.start_with?(prefix) }
      return nil if found.nil?

      found.split(":", 2).last.strip
    end

    def payload
      JSON.parse(body)
    end
  end

  attr_reader :url

  # +responses+ is consumed one entry per request; the last entry repeats once
  # the list runs out, so a test only lists the attempts it cares about.
  def initialize(responses)
    @responses = responses
    @server = TCPServer.new("127.0.0.1", 0)
    @url = "http://127.0.0.1:#{@server.addr[1]}/incident"
    @requests = Queue.new
    @served = 0
    @thread = Thread.new { accept_loop }
  end

  def next_request(timeout: 10)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
    loop do
      return @requests.pop(true)
    rescue ThreadError
      raise "the client never sent a request" if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline

      sleep 0.01
    end
  end

  def request_count
    @requests.size
  end

  def shutdown
    @thread.kill
    @server.close unless @server.closed?
  end

  private

  def accept_loop
    loop do
      socket = @server.accept
      status, body = @responses[[@served, @responses.length - 1].min]
      @served += 1
      @requests.push(serve(socket, status, body))
    rescue IOError, Errno::ECONNRESET
      return
    end
  end

  def serve(socket, status, body)
    headers = []
    while (line = socket.gets)
      break if line.strip.empty?

      headers << line.strip
    end

    content_length = headers.find { |header| header.downcase.start_with?("content-length:") }
    length = content_length ? content_length.split(":", 2).last.to_i : 0
    payload = length.positive? ? socket.read(length) : ""

    # Connection: close keeps each attempt on its own socket, so a retry test
    # counts connections as attempts without connection reuse in the way.
    socket.write("HTTP/1.1 #{status} X\r\nContent-Type: application/json\r\n" \
                 "Content-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}")
    socket.close
    Request.new(headers, payload)
  end
end

# Swallows everything. Tests assert on behavior, not on log output, and a real
# logger would make the suite's output unreadable. It also demonstrates the only
# contract this SDK expects of a logger: four methods taking one message.
class SilentLogger
  Oppex::StderrLogger::LEVELS.each { |level| define_method(level) { |_message| nil } }
end
