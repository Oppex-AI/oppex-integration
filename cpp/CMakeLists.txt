cmake_minimum_required(VERSION 3.20)

# The version lives in one place, src/version.hpp, and is read from there so the
# project version and the version the library reports can never drift apart.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/src/version.hpp" OPPEX_VERSION_HEADER)
string(REGEX MATCH "OPPEX_SDK_VERSION \"([0-9]+\\.[0-9]+\\.[0-9]+)\"" _ "${OPPEX_VERSION_HEADER}")
set(OPPEX_SDK_VERSION "${CMAKE_MATCH_1}")
if(NOT OPPEX_SDK_VERSION)
  message(FATAL_ERROR "Could not read OPPEX_SDK_VERSION from src/version.hpp")
endif()

project(oppex-integration-sdk VERSION ${OPPEX_SDK_VERSION} LANGUAGES CXX)

option(OPPEX_BUILD_TESTS "Build the Oppex SDK test suite" ${PROJECT_IS_TOP_LEVEL})
option(OPPEX_BUILD_EXAMPLES "Build the Oppex SDK examples" ${PROJECT_IS_TOP_LEVEL})

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

find_package(CURL REQUIRED)

add_library(oppex_sdk
  src/async_dispatcher.cpp
  src/c_api.cpp
  src/client.cpp
  src/http_transport.cpp
  src/json.cpp
  src/retry_policy.cpp
  src/wire_codec.cpp
)
add_library(oppex::sdk ALIAS oppex_sdk)

target_compile_features(oppex_sdk PUBLIC cxx_std_20)
set_target_properties(oppex_sdk PROPERTIES
  # The installed target is oppex::sdk, matching the in-tree alias below, so a
  # consumer writes the same name whether it installs this SDK or adds it as a
  # subdirectory.
  EXPORT_NAME sdk
  CXX_EXTENSIONS OFF
  VERSION ${PROJECT_VERSION}
  SOVERSION ${PROJECT_VERSION_MAJOR}
  # Nothing outside the two public headers is part of the ABI, so a shared build
  # exports only what those declare.
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN ON
  POSITION_INDEPENDENT_CODE ON
)

target_include_directories(oppex_sdk
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# libcurl is an implementation detail: the public headers do not include it, so
# it is linked privately and a consumer inherits no curl include path.
target_link_libraries(oppex_sdk PRIVATE CURL::libcurl)
find_package(Threads REQUIRED)
target_link_libraries(oppex_sdk PUBLIC Threads::Threads)

# Warnings are failures. This is the C++ equivalent of `go vet` and
# `cargo clippy -D warnings` in the sibling SDKs.
if(MSVC)
  target_compile_options(oppex_sdk PRIVATE /W4 /WX /permissive-)
else()
  target_compile_options(oppex_sdk PRIVATE
    -Wall -Wextra -Wpedantic -Werror
    -Wconversion -Wsign-conversion -Wshadow -Wnon-virtual-dtor -Wold-style-cast
  )
endif()

install(TARGETS oppex_sdk EXPORT oppex-sdk-targets
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
)
install(DIRECTORY include/oppex DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(EXPORT oppex-sdk-targets
  FILE oppex-sdk-targets.cmake
  NAMESPACE oppex::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/oppex-sdk
)

configure_package_config_file(
  cmake/oppex-sdk-config.cmake.in
  "${CMAKE_CURRENT_BINARY_DIR}/oppex-sdk-config.cmake"
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/oppex-sdk
)
write_basic_package_version_file(
  "${CMAKE_CURRENT_BINARY_DIR}/oppex-sdk-config-version.cmake"
  COMPATIBILITY SameMajorVersion
)
install(FILES
  "${CMAKE_CURRENT_BINARY_DIR}/oppex-sdk-config.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/oppex-sdk-config-version.cmake"
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/oppex-sdk
)

if(OPPEX_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

if(OPPEX_BUILD_EXAMPLES)
  add_subdirectory(examples)
endif()
