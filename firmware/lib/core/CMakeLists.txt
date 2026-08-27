add_library(apple_game_core STATIC
  src/engine.cpp
  src/names.cpp
)

target_include_directories(apple_game_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(apple_game_core PUBLIC cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_game_core PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_game_core PRIVATE /W4 /WX)
endif()
