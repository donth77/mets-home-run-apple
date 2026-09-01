add_executable(apple_core_tests core_tests.cpp)
target_link_libraries(apple_core_tests PRIVATE apple_game_core)
target_compile_features(apple_core_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_core_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_core_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_core_tests COMMAND apple_core_tests)

add_executable(apple_home_run_loop_tests home_run_loop_tests.cpp)
target_link_libraries(apple_home_run_loop_tests PRIVATE apple_home_run_loop)
target_compile_features(apple_home_run_loop_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_home_run_loop_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_home_run_loop_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_home_run_loop_tests COMMAND apple_home_run_loop_tests)

add_executable(apple_mets_win_loop_tests mets_win_loop_tests.cpp)
target_link_libraries(apple_mets_win_loop_tests PRIVATE apple_home_run_loop)
target_compile_features(apple_mets_win_loop_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_mets_win_loop_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_mets_win_loop_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_mets_win_loop_tests COMMAND apple_mets_win_loop_tests)
