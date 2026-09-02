add_library(apple_motion STATIC
  src/timed_actuator.cpp
)

target_include_directories(apple_motion
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(apple_motion PUBLIC apple_game_core)

target_compile_features(apple_motion PUBLIC cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_motion PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_motion PRIVATE /W4 /WX)
endif()
