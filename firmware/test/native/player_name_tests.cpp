#include "apple/firmware/player_names.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

namespace {

[[noreturn]] void fail(const std::string& message, int line) {
  std::cerr << "FAIL line " << line << ": " << message << '\n';
  std::exit(1);
}

#define EXPECT_EQ(actual, expected)                                            \
  do {                                                                         \
    const auto actual_value = (actual);                                        \
    const auto expected_value = (expected);                                    \
    if (!(actual_value == expected_value))                                     \
      fail("values differ: " #actual " != " #expected, __LINE__);              \
  } while (false)

std::string compact(const char* source) {
  char output[64] = {};
  apple::firmware::copy_compact_player_name(output, sizeof(output), source);
  return output;
}

void test_compacts_full_names() {
  EXPECT_EQ(compact("Francisco Lindor"), "F. Lindor");
  EXPECT_EQ(compact("Spencer Strider"), "S. Strider");
  EXPECT_EQ(compact("Ronald Acuña Jr."), "R. Acuña Jr.");
  EXPECT_EQ(compact("Elly De La Cruz"), "E. De La Cruz");
}

void test_is_idempotent_and_handles_partial_names() {
  EXPECT_EQ(compact("F. Lindor"), "F. Lindor");
  EXPECT_EQ(compact("  Francisco   Lindor  "), "F. Lindor");
  EXPECT_EQ(compact("Ichiro"), "Ichiro");
  EXPECT_EQ(compact("-"), "-");
  EXPECT_EQ(compact(nullptr), "");
}

void test_always_null_terminates_small_buffers() {
  char output[8] = {};
  apple::firmware::copy_compact_player_name(output, sizeof(output),
                                             "Francisco Lindor");
  EXPECT_EQ(std::string(output), "F. Lind");
}

void test_formats_batting_line_for_the_display() {
  char output[16] = {};
  apple::firmware::copy_compact_batter_line(output, sizeof(output),
                                             "0–1 · HR");
  EXPECT_EQ(std::string(output), "0 FOR 1");
  apple::firmware::copy_compact_batter_line(output, sizeof(output), "12-13");
  EXPECT_EQ(std::string(output), "12 FOR 13");
  apple::firmware::copy_compact_batter_line(output, sizeof(output), "-");
  EXPECT_EQ(std::string(output), "-");
}

}  // namespace

int main() {
  test_compacts_full_names();
  test_is_idempotent_and_handles_partial_names();
  test_always_null_terminates_small_buffers();
  test_formats_batting_line_for_the_display();
  std::cout << "player name tests passed\n";
  return 0;
}
