# An isolated consumer, deliberately outside cpp/ and deliberately resolved with
# find_package against an install prefix rather than add_subdirectory: it builds
# against the installed headers and library, so a missing install rule or a
# header that only compiles from inside the source tree fails here.
#
# The workflow builds and installs the SDK from the *extracted release archive*,
# so this also catches a file missing from cpp/scripts/package.sh.
cmake_minimum_required(VERSION 3.20)
project(oppex-smoke-consumer LANGUAGES C CXX)

find_package(oppex-sdk REQUIRED)

add_executable(consumer_cpp consumer.cpp)
target_link_libraries(consumer_cpp PRIVATE oppex::sdk)
target_compile_features(consumer_cpp PRIVATE cxx_std_20)

# Built as C, not C++: that is what proves oppex.h is usable without a C++
# compiler, which no consumer written in C++ can prove.
add_executable(consumer_c consumer.c)
target_link_libraries(consumer_c PRIVATE oppex::sdk)
set_target_properties(consumer_c PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON C_EXTENSIONS OFF)
