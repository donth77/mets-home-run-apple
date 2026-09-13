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

add_executable(apple_mlb_feed_tests mlb_feed_tests.cpp)
target_link_libraries(apple_mlb_feed_tests PRIVATE apple_mlb_feed apple_game_core)
target_include_directories(apple_mlb_feed_tests PRIVATE ${CMAKE_SOURCE_DIR}/fixtures/mlb)
target_compile_features(apple_mlb_feed_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_mlb_feed_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_mlb_feed_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_mlb_feed_tests COMMAND apple_mlb_feed_tests)

add_executable(apple_player_name_tests player_name_tests.cpp)
target_include_directories(
  apple_player_name_tests
  PRIVATE ${CMAKE_SOURCE_DIR}/lib/device_screens/include
)
target_compile_features(apple_player_name_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_player_name_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_player_name_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_player_name_tests COMMAND apple_player_name_tests)

add_executable(apple_time_zone_tests time_zone_tests.cpp)
target_link_libraries(apple_time_zone_tests PRIVATE apple_time_zones)
target_compile_features(apple_time_zone_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_time_zone_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_time_zone_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_time_zone_tests COMMAND apple_time_zone_tests)

add_executable(apple_release_pick_tests release_pick_tests.cpp)
target_link_libraries(apple_release_pick_tests PRIVATE apple_release_pick)
target_compile_features(apple_release_pick_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_release_pick_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_release_pick_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_release_pick_tests COMMAND apple_release_pick_tests)

add_executable(apple_lab_protocol_tests lab_protocol_tests.cpp)
target_link_libraries(apple_lab_protocol_tests PRIVATE apple_game_core apple_game_state apple_motion)
target_include_directories(apple_lab_protocol_tests PRIVATE ${CMAKE_SOURCE_DIR}/lib/manager/include)
target_include_directories(apple_lab_protocol_tests SYSTEM PRIVATE ${CMAKE_SOURCE_DIR}/third_party/ArduinoJson/src)
target_compile_features(apple_lab_protocol_tests PRIVATE cxx_std_17)
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_lab_protocol_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
add_test(NAME apple_lab_protocol_tests COMMAND apple_lab_protocol_tests
  ${CMAKE_SOURCE_DIR}/test/native/fixtures/lab-protocol.trace
  ${CMAKE_SOURCE_DIR}/test/native/fixtures/status-snapshot.json)

add_executable(apple_next_tracks_tests next_tracks_tests.cpp)
target_link_libraries(apple_next_tracks_tests PRIVATE apple_next_tracks)
target_compile_features(apple_next_tracks_tests PRIVATE cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(apple_next_tracks_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
elseif(MSVC)
  target_compile_options(apple_next_tracks_tests PRIVATE /W4 /WX)
endif()

add_test(NAME apple_next_tracks_tests COMMAND apple_next_tracks_tests)
