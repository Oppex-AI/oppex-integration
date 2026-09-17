// A very small test harness and a loopback stub server.
//
// This SDK's only dependency is libcurl, and that holds for the tests too: a
// harness small enough to read in one screen is a better guarantee than a test
// framework's own configuration surface, and it keeps a build of this directory
// from needing a package manager.

#ifndef OPPEX_TESTS_TEST_SUPPORT_HPP
#define OPPEX_TESTS_TEST_SUPPORT_HPP

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <iostream>
#include <map>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

namespace oppex::test {

struct TestCase {
  std::string name;
  std::function<void()> body;
};

inline std::vector<TestCase>& Registry() {
  static std::vector<TestCase> registry;
  return registry;
}

struct Registrar {
  Registrar(std::string name, std::function<void()> body) {
    Registry().push_back({std::move(name), std::move(body)});
  }
};

class AssertionFailure : public std::runtime_error {
 public:
  explicit AssertionFailure(const std::string& message) : std::runtime_error(message) {}
};

template <typename T>
std::string Describe(const T& value) {
  std::ostringstream out;
  out << value;
  return out.str();
}

inline std::string Describe(bool value) { return value ? "true" : "false"; }

}  // namespace oppex::test

#define OPPEX_TEST(name)                                                       \
  static void name();                                                          \
  static const ::oppex::test::Registrar kRegistrar_##name(#name, name);        \
  static void name()

#define OPPEX_ASSERT(condition)                                                          \
  do {                                                                                   \
    if (!(condition)) {                                                                  \
      throw ::oppex::test::AssertionFailure(std::string(__FILE__) + ":" +                 \
                                            std::to_string(__LINE__) + ": expected " +   \
                                            #condition);                                 \
    }                                                                                    \
  } while (false)

/* The operands are copied rather than bound by reference: `actual` is very often
   something like optional.value(), whose referent dies with the temporary the
   expression produced. */
#define OPPEX_ASSERT_EQ(expected, actual)                                                        \
  do {                                                                                           \
    const auto oppex_expected = (expected);                                                      \
    const auto oppex_actual = (actual);                                                          \
    if (!(oppex_expected == oppex_actual)) {                                                     \
      throw ::oppex::test::AssertionFailure(                                                     \
          std::string(__FILE__) + ":" + std::to_string(__LINE__) + ": expected " +                \
          ::oppex::test::Describe(oppex_expected) + ", got " +                                    \
          ::oppex::test::Describe(oppex_actual));                                                 \
    }                                                                                            \
  } while (false)

#define OPPEX_ASSERT_THROWS(exception_type, statement)                                        \
  do {                                                                                        \
    bool oppex_threw = false;                                                                 \
    try {                                                                                     \
      statement;                                                                              \
    } catch (const exception_type&) {                                                         \
      oppex_threw = true;                                                                     \
    }                                                                                         \
    if (!oppex_threw) {                                                                       \
      throw ::oppex::test::AssertionFailure(std::string(__FILE__) + ":" +                      \
                                            std::to_string(__LINE__) + ": expected " +         \
                                            #statement + " to throw " + #exception_type);      \
    }                                                                                          \
  } while (false)

namespace oppex::test {

/// A loopback stand-in for the Oppex API. Tests never reach the real service;
/// only the local listener started here.
class StubServer {
 public:
  struct RecordedRequest {
    std::map<std::string, std::string> headers;
    std::string body;

    [[nodiscard]] std::string Header(const std::string& name) const {
      std::string lowered = name;
      for (auto& character : lowered) {
        character = static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
      }
      const auto found = headers.find(lowered);
      return found == headers.end() ? std::string() : found->second;
    }
  };

  /// `responses` is consumed one entry per request; the last entry repeats once
  /// the list runs out, so a test only lists the attempts it cares about.
  explicit StubServer(std::vector<std::pair<int, std::string>> responses)
      : responses_(std::move(responses)) {
    listener_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listener_ < 0) {
      throw std::runtime_error("could not create a listening socket");
    }
    int reuse = 1;
    ::setsockopt(listener_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = ::htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    if (::bind(listener_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
        ::listen(listener_, 16) != 0) {
      ::close(listener_);
      throw std::runtime_error("could not bind a loopback port");
    }

    socklen_t length = sizeof(address);
    ::getsockname(listener_, reinterpret_cast<sockaddr*>(&address), &length);
    url_ = "http://127.0.0.1:" + std::to_string(::ntohs(address.sin_port)) + "/incident";

    worker_ = std::thread([this] { AcceptLoop(); });
  }

  ~StubServer() { Shutdown(); }

  StubServer(const StubServer&) = delete;
  StubServer& operator=(const StubServer&) = delete;

  [[nodiscard]] const std::string& url() const { return url_; }

  RecordedRequest NextRequest(std::chrono::seconds timeout = std::chrono::seconds(10)) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!received_.wait_for(lock, timeout, [this] { return !requests_.empty(); })) {
      throw AssertionFailure("the client never sent a request");
    }
    RecordedRequest request = requests_.front();
    requests_.pop_front();
    return request;
  }

  [[nodiscard]] std::size_t RequestCount() {
    const std::lock_guard<std::mutex> lock(mutex_);
    return requests_.size();
  }

  void AssertNoFurtherRequest() {
    std::this_thread::sleep_for(std::chrono::milliseconds(250));
    if (RequestCount() != 0) {
      throw AssertionFailure("the client sent more requests than expected");
    }
  }

  void Shutdown() {
    if (stopping_.exchange(true)) {
      return;
    }
    ::shutdown(listener_, SHUT_RDWR);
    ::close(listener_);
    if (worker_.joinable()) {
      worker_.join();
    }
  }

 private:
  void AcceptLoop() {
    std::size_t served = 0;
    while (!stopping_.load()) {
      const int connection = ::accept(listener_, nullptr, nullptr);
      if (connection < 0) {
        return;
      }
      const auto& [status, body] = responses_[std::min(served, responses_.size() - 1)];
      ++served;
      Serve(connection, status, body);
      ::close(connection);
    }
  }

  void Serve(int connection, int status, const std::string& body) {
    std::string buffer;
    std::size_t header_end = std::string::npos;
    char chunk[4096];
    while ((header_end = buffer.find("\r\n\r\n")) == std::string::npos) {
      const ssize_t read = ::recv(connection, chunk, sizeof(chunk), 0);
      if (read <= 0) {
        return;
      }
      buffer.append(chunk, static_cast<std::size_t>(read));
    }

    RecordedRequest request;
    std::size_t content_length = 0;
    std::istringstream headers(buffer.substr(0, header_end));
    std::string line;
    std::getline(headers, line);  // the request line
    while (std::getline(headers, line) && !line.empty()) {
      const std::size_t colon = line.find(':');
      if (colon == std::string::npos) {
        continue;
      }
      std::string name = line.substr(0, colon);
      for (auto& character : name) {
        character = static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
      }
      std::string value = line.substr(colon + 1);
      const std::size_t first = value.find_first_not_of(" \t\r\n");
      const std::size_t last = value.find_last_not_of(" \t\r\n");
      value = first == std::string::npos ? std::string() : value.substr(first, last - first + 1);
      if (name == "content-length") {
        content_length = static_cast<std::size_t>(std::stoul(value));
      }
      request.headers.emplace(std::move(name), std::move(value));
    }

    request.body = buffer.substr(header_end + 4);
    while (request.body.size() < content_length) {
      const ssize_t read = ::recv(connection, chunk, sizeof(chunk), 0);
      if (read <= 0) {
        break;
      }
      request.body.append(chunk, static_cast<std::size_t>(read));
    }

    {
      const std::lock_guard<std::mutex> lock(mutex_);
      requests_.push_back(std::move(request));
    }
    received_.notify_all();

    // Connection: close keeps each attempt on its own socket, so a retry test
    // counts connections as attempts without connection reuse in the way.
    const std::string response = "HTTP/1.1 " + std::to_string(status) +
                                 " X\r\nContent-Type: application/json\r\nContent-Length: " +
                                 std::to_string(body.size()) + "\r\nConnection: close\r\n\r\n" + body;
    ::send(connection, response.data(), response.size(), 0);
  }

  std::vector<std::pair<int, std::string>> responses_;
  int listener_ = -1;
  std::string url_;
  std::thread worker_;
  std::atomic<bool> stopping_{false};
  std::mutex mutex_;
  std::condition_variable received_;
  std::deque<RecordedRequest> requests_;
};

}  // namespace oppex::test

#endif  // OPPEX_TESTS_TEST_SUPPORT_HPP
