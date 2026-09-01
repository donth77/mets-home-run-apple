add_library(apple_home_run_loop STATIC
  src/display_grid.cpp
  src/text_engine.cpp
  src/home_run_loop.cpp
  src/mets_win_loop.cpp
)

target_include_directories(apple_home_run_loop
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(apple_home_run_loop PUBLIC cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_home_run_loop PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_home_run_loop PRIVATE /W4 /WX)
endif()
