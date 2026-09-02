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

add_executable(apple_game_state_tests game_state_tests.cpp)
target_link_libraries(apple_game_state_tests PRIVATE apple_game_state)
target_compile_features(apple_game_state_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_game_state_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_game_state_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_game_state_tests COMMAND apple_game_state_tests)

add_executable(apple_motion_tests motion_tests.cpp)
target_link_libraries(apple_motion_tests PRIVATE apple_motion)
target_compile_features(apple_motion_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_motion_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_motion_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_motion_tests COMMAND apple_motion_tests)
