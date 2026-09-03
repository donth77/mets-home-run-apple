add_library(apple_game_state STATIC
  src/projector.cpp
  src/status.cpp
)

target_include_directories(apple_game_state
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(apple_game_state PUBLIC cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_game_state PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_game_state PRIVATE /W4 /WX)
endif()
