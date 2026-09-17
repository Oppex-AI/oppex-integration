// Runs the C-compiled ABI checks as one case in the C++ harness, so a C ABI
// regression shows up in the same test run as everything else.

#include <array>
#include <string>

#include "test_support.hpp"

extern "C" int oppex_run_c_api_checks(char* report, std::size_t capacity);

namespace {

OPPEX_TEST(TheCAbiIsUsableFromC) {
  std::array<char, 512> report{};
  const int failed = oppex_run_c_api_checks(report.data(), report.size());
  if (failed != 0) {
    throw oppex::test::AssertionFailure(std::string("C ABI check failed: ") + report.data());
  }
}

}  // namespace
