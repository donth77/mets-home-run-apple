# Only the time zone table builds natively; the rest of the Manager needs the
# Arduino Wi-Fi and web server stacks.
add_library(apple_time_zones src/time_zones.cpp)
target_include_directories(apple_time_zones PUBLIC include)
target_compile_features(apple_time_zones PUBLIC cxx_std_17)

# Release selection is portable too (ArduinoJson only), so the native tests
# can feed it real GitHub API responses.
add_library(apple_release_pick src/release_pick.cpp)
target_include_directories(apple_release_pick PUBLIC include)
target_include_directories(apple_release_pick SYSTEM PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/ArduinoJson/src)
target_compile_features(apple_release_pick PUBLIC cxx_std_17)
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_release_pick PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
