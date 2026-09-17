# The C ABI checks are compiled as C on purpose: that is what proves
# include/oppex/oppex.h is valid C and usable without a C++ compiler.
enable_language(C)

add_executable(oppex_sdk_tests
  async_dispatcher_test.cpp
  c_api_bridge.cpp
  c_api_test.c
  client_test.cpp
  json_test.cpp
  retry_policy_test.cpp
  test_main.cpp
  wire_codec_test.cpp
)

set_target_properties(oppex_sdk_tests PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON C_EXTENSIONS OFF)

# Tests reach into the implementation, so they see the private include directory
# as well as the public one.
target_include_directories(oppex_sdk_tests PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src
  ${CMAKE_CURRENT_SOURCE_DIR}
)
target_link_libraries(oppex_sdk_tests PRIVATE oppex_sdk CURL::libcurl)

if(MSVC)
  target_compile_options(oppex_sdk_tests PRIVATE /W4 /WX)
else()
  target_compile_options(oppex_sdk_tests PRIVATE -Wall -Wextra -Werror)
endif()

add_test(NAME oppex_sdk_tests COMMAND oppex_sdk_tests)
