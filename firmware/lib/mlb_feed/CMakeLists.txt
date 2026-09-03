add_library(apple_mlb_feed STATIC
  src/feed.cpp
  src/schedule.cpp
)

target_include_directories(apple_mlb_feed
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# Vendored single-header ArduinoJson; SYSTEM keeps its warnings out of -Werror.
target_include_directories(apple_mlb_feed
  SYSTEM PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/ArduinoJson/src
)

target_link_libraries(apple_mlb_feed PUBLIC apple_game_state)

target_compile_features(apple_mlb_feed PUBLIC cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_mlb_feed PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_mlb_feed PRIVATE /W4 /WX)
endif()
