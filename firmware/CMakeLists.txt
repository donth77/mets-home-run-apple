cmake_minimum_required(VERSION 3.20)

project(mets_home_run_apple_core LANGUAGES CXX)

option(APPLE_BUILD_NATIVE_TESTS "Build host-side deterministic core tests" ON)

add_subdirectory(lib/core)

if(APPLE_BUILD_NATIVE_TESTS)
  enable_testing()
  add_subdirectory(test/native)
endif()
