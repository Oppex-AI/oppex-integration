#include <exception>
#include <iostream>

#include "test_support.hpp"

int main() {
  int failed = 0;
  for (const auto& test : oppex::test::Registry()) {
    try {
      test.body();
      std::cout << "ok   " << test.name << "\n";
    } catch (const std::exception& failure) {
      std::cout << "FAIL " << test.name << "\n     " << failure.what() << "\n";
      ++failed;
    }
  }

  const std::size_t total = oppex::test::Registry().size();
  std::cout << "\n" << (total - static_cast<std::size_t>(failed)) << "/" << total
            << " tests passed\n";
  return failed == 0 ? 0 : 1;
}
