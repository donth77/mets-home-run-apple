add_executable(apple_core_tests core_tests.cpp)
target_link_libraries(apple_core_tests PRIVATE apple_game_core)
target_compile_features(apple_core_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_core_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_core_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_core_tests COMMAND apple_core_tests)
