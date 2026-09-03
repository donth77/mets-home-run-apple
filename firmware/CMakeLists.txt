cmake_minimum_required(VERSION 3.20)

project(mets_home_run_apple_core LANGUAGES CXX)

option(APPLE_BUILD_NATIVE_TESTS "Build host-side deterministic core tests" ON)

add_subdirectory(lib/core)
add_subdirectory(lib/game_state)
add_subdirectory(lib/home_run_loop)
add_subdirectory(lib/motion)
add_subdirectory(lib/mlb_feed)
add_subdirectory(lib/manager)

if(APPLE_BUILD_NATIVE_TESTS)
  enable_testing()
  add_subdirectory(test/native)
endif()
