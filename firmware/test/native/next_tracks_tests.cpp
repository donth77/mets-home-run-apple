// The up-next store the Apple uses to decide which queued track plays on the
// next home run, the next Mets win, or one player's next home run. These are
// the sequences the firmware runs when the owner edits a line and when a
// celebration starts, checked here because the real events are rare.
#include "apple/firmware/next_tracks.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

namespace {

using apple::firmware::kMaxNextPerLine;
using apple::firmware::kMaxNextTracks;
using apple::firmware::NextChange;
using apple::firmware::NextTracks;

[[noreturn]] void fail(const std::string& message, int line) {
  std::cerr << "FAIL line " << line << ": " << message << '\n';
  std::exit(1);
}

#define EXPECT_TRUE(value)                                                     \
  do {                                                                         \
    if (!(value)) fail("expected true: " #value, __LINE__);                    \
  } while (false)

#define EXPECT_EQ(actual, expected)                                            \
  do {                                                                         \
    if (!((actual) == (expected))) fail("values differ: " #actual " != " #expected, __LINE__); \
  } while (false)

std::string text(const char* value) { return value == nullptr ? std::string("<none>") : std::string(value); }

// The files of one line, front to back, joined for easy comparison.
std::string line_of(const NextTracks& store, bool win, const char* player) {
  std::string joined;
  for (std::uint8_t i = 0; i < store.size(); ++i) {
    const auto& entry = store.at(i);
    const bool same = entry.win == win && (win || std::string(entry.player) == player);
    if (!same) continue;
    if (!joined.empty()) joined += ' ';
    joined += entry.file;
  }
  return joined;
}

void test_lines_are_independent() {
  NextTracks store;
  EXPECT_EQ(store.add(false, 0, "", "/a.wav"), NextChange::Ok);
  EXPECT_EQ(store.add(true, 0, "", "/w.wav"), NextChange::Ok);
  EXPECT_EQ(store.add(false, 596019, "Francisco Lindor", "/l.wav"), NextChange::Ok);
  EXPECT_EQ(store.add(false, 0, "", "/b.wav"), NextChange::Ok);
  EXPECT_EQ(line_of(store, false, ""), std::string("/a.wav /b.wav"));
  EXPECT_EQ(line_of(store, true, ""), std::string("/w.wav"));
  EXPECT_EQ(line_of(store, false, "Francisco Lindor"), std::string("/l.wav"));
  EXPECT_EQ(text(store.head(false, "")), std::string("/a.wav"));
  EXPECT_EQ(text(store.head(true, "Francisco Lindor")), std::string("/w.wav"));  // wins ignore the player
  EXPECT_EQ(text(store.head(false, "francisco lindor")), std::string("/l.wav"));  // feed names differ only in case
  EXPECT_EQ(text(store.head(false, "Juan Soto")), std::string("<none>"));
  EXPECT_EQ(store.line_count(false, ""), 2);
  EXPECT_EQ(store.at(2).player_id, 596019);
  EXPECT_EQ(store.at(1).player_id, 0);
}

void test_add_at_front_and_positions() {
  NextTracks store;
  store.add(false, 0, "", "/a.wav");
  store.add(false, 0, "", "/b.wav");
  // "Play next" from the library: the front of the line.
  EXPECT_EQ(store.add(false, 0, "", "/c.wav", 0), NextChange::Ok);
  EXPECT_EQ(line_of(store, false, ""), std::string("/c.wav /a.wav /b.wav"));
  EXPECT_EQ(store.add(false, 0, "", "/d.wav", 1), NextChange::Ok);
  EXPECT_EQ(line_of(store, false, ""), std::string("/c.wav /d.wav /a.wav /b.wav"));
  EXPECT_EQ(store.add(false, 0, "", "/e.wav", 99), NextChange::Ok);  // past the end lands last
  EXPECT_EQ(line_of(store, false, ""), std::string("/c.wav /d.wav /a.wav /b.wav /e.wav"));
  // A front insert into an empty line, and duplicates of one track.
  EXPECT_EQ(store.add(true, 0, "", "/w.wav", 0), NextChange::Ok);
  EXPECT_EQ(store.add(true, 0, "", "/w.wav", 0), NextChange::Ok);
  EXPECT_EQ(line_of(store, true, ""), std::string("/w.wav /w.wav"));
  EXPECT_EQ(store.add(false, 0, "", "", 0), NextChange::NoTrack);
}

void test_caps() {
  NextTracks store;
  for (int i = 0; i < kMaxNextPerLine; ++i) EXPECT_EQ(store.add(false, 0, "", "/a.wav"), NextChange::Ok);
  EXPECT_EQ(store.add(false, 0, "", "/a.wav"), NextChange::LineFull);
  EXPECT_EQ(store.add(false, 0, "", "/a.wav", 0), NextChange::LineFull);
  EXPECT_EQ(store.add(true, 0, "", "/w.wav"), NextChange::Ok);  // another line still has room
  // Many players filling their lines run into the store's overall cap.
  NextTracks crowd;
  int added = 0;
  for (int player = 0; player < 40 && crowd.size() < kMaxNextTracks; ++player) {
    const std::string name = "Player " + std::to_string(player);
    for (int k = 0; k < kMaxNextPerLine; ++k) {
      if (crowd.add(false, player, name.c_str(), "/a.wav") == NextChange::Ok) ++added;
    }
  }
  EXPECT_EQ(added, static_cast<int>(kMaxNextTracks));
  EXPECT_EQ(crowd.size(), kMaxNextTracks);
  EXPECT_EQ(crowd.add(true, 0, "", "/w.wav"), NextChange::StoreFull);
  // A long line reorders end to end.
  NextTracks longline;
  for (int i = 0; i < kMaxNextPerLine; ++i) {
    const std::string file = "/t" + std::to_string(i) + ".wav";
    EXPECT_EQ(longline.add(false, 0, "", file.c_str()), NextChange::Ok);
  }
  EXPECT_EQ(longline.move(false, "", kMaxNextPerLine - 1, ("/t" + std::to_string(kMaxNextPerLine - 1) + ".wav").c_str(), 0), NextChange::Ok);
  EXPECT_EQ(std::string(longline.head(false, "")), "/t" + std::to_string(kMaxNextPerLine - 1) + ".wav");
  EXPECT_EQ(std::string(longline.at(1).file), std::string("/t0.wav"));
  EXPECT_EQ(std::string(longline.at(kMaxNextPerLine - 1).file), "/t" + std::to_string(kMaxNextPerLine - 2) + ".wav");
}

void test_remove_by_place_with_duplicates() {
  NextTracks store;
  store.add(false, 0, "", "/a.wav");
  store.add(false, 0, "", "/b.wav");
  store.add(false, 0, "", "/b.wav");
  store.add(false, 0, "", "/c.wav");
  // The second copy of b, named by its place.
  EXPECT_EQ(store.remove(false, "", 2, "/b.wav"), NextChange::Ok);
  EXPECT_EQ(line_of(store, false, ""), std::string("/a.wav /b.wav /c.wav"));
  // A stale place falls back to the first entry with that file.
  EXPECT_EQ(store.remove(false, "", 5, "/c.wav"), NextChange::Ok);
  EXPECT_EQ(line_of(store, false, ""), std::string("/a.wav /b.wav"));
  EXPECT_EQ(store.remove(false, "", -1, "/zzz.wav"), NextChange::NoTrack);
  EXPECT_EQ(store.remove(true, "", -1, "/a.wav"), NextChange::NoTrack);  // wrong line
  EXPECT_EQ(store.size(), 2);
}

void test_move_keeps_other_lines_in_place() {
  NextTracks store;
  store.add(false, 0, "", "/a.wav");
  store.add(true, 0, "", "/w1.wav");
  store.add(false, 0, "", "/b.wav");
  store.add(false, 7, "Juan Soto", "/s.wav");
  store.add(false, 0, "", "/c.wav");
  store.add(true, 0, "", "/w2.wav");
  EXPECT_EQ(store.move(false, "", 2, "/c.wav", 0), NextChange::Ok);  // to the front
  EXPECT_EQ(line_of(store, false, ""), std::string("/c.wav /a.wav /b.wav"));
  EXPECT_EQ(store.move(false, "", 0, "/c.wav", 1), NextChange::Ok);  // down one
  EXPECT_EQ(line_of(store, false, ""), std::string("/a.wav /c.wav /b.wav"));
  EXPECT_EQ(store.move(false, "", 0, "/a.wav", 99), NextChange::Ok);  // clamps to the end
  EXPECT_EQ(line_of(store, false, ""), std::string("/c.wav /b.wav /a.wav"));
  EXPECT_EQ(store.move(false, "", 2, "/a.wav", -5), NextChange::Ok);  // clamps to the front
  EXPECT_EQ(line_of(store, false, ""), std::string("/a.wav /c.wav /b.wav"));
  EXPECT_EQ(store.move(false, "", 1, "/c.wav", 1), NextChange::Ok);  // no-op
  EXPECT_EQ(store.move(false, "", 0, "/nope.wav", 1), NextChange::NoTrack);
  // The store's slots for the other lines never moved.
  EXPECT_EQ(std::string(store.at(1).file), std::string("/w1.wav"));
  EXPECT_EQ(std::string(store.at(3).file), std::string("/s.wav"));
  EXPECT_EQ(std::string(store.at(5).file), std::string("/w2.wav"));
  EXPECT_EQ(line_of(store, true, ""), std::string("/w1.wav /w2.wav"));
}

void test_consume_follows_the_apple_precedence() {
  NextTracks store;
  store.add(false, 0, "", "/anyone.wav");
  store.add(false, 596019, "Francisco Lindor", "/lindor.wav");
  store.add(true, 0, "", "/win.wav");
  // Lindor up: the Apple preloads his own line first.
  EXPECT_EQ(text(store.head_for_batter("Francisco Lindor")), std::string("/lindor.wav"));
  EXPECT_EQ(text(store.head_for_batter("Juan Soto")), std::string("/anyone.wav"));
  EXPECT_EQ(text(store.head_for_batter("")), std::string("/anyone.wav"));
  // Lindor homers and his track plays: only his line shrinks.
  EXPECT_TRUE(store.consume_home_run("Francisco Lindor", "/lindor.wav"));
  EXPECT_EQ(text(store.head_for_batter("Francisco Lindor")), std::string("/anyone.wav"));
  EXPECT_EQ(line_of(store, false, ""), std::string("/anyone.wav"));
  // The resident slot held a pool pick instead (a refresh had not run): nothing consumed.
  EXPECT_TRUE(!store.consume_home_run("Juan Soto", "/pool.wav"));
  EXPECT_EQ(store.size(), 2);
  // Soto homers with the line-for-anyone track loaded.
  EXPECT_TRUE(store.consume_home_run("Juan Soto", "/anyone.wav"));
  EXPECT_EQ(text(store.head_for_batter("Juan Soto")), std::string("<none>"));
  // A win consumes only from the win line, whatever the batter.
  EXPECT_TRUE(!store.consume(false, "", "/win.wav"));
  EXPECT_TRUE(store.consume(true, "ignored", "/win.wav"));
  EXPECT_EQ(store.size(), 0);
  EXPECT_TRUE(!store.consume(true, "", nullptr));
}

void test_clear_and_drop() {
  NextTracks store;
  store.add(false, 0, "", "/a.wav");
  store.add(false, 1, "Juan Soto", "/a.wav");
  store.add(false, 1, "Juan Soto", "/b.wav");
  store.add(true, 0, "", "/a.wav");
  store.clear(false, "Juan Soto");  // taking a player off the list takes his line with him
  EXPECT_EQ(store.size(), 2);
  EXPECT_EQ(store.line_count(false, "Juan Soto"), 0);
  store.drop_file("/A.WAV");  // the card is case-insensitive
  EXPECT_EQ(store.size(), 0);
  store.add(true, 0, "", "/w.wav");
  store.clear_all();
  EXPECT_EQ(store.size(), 0);
}

void test_manifest_round_trip_and_repair() {
  NextTracks store;
  store.add(false, 0, "", "/a.wav");
  store.add(false, 596019, "Francisco Lindor", "/l.wav");
  store.add(true, 0, "", "/w.wav");
  JsonDocument doc;
  store.write(doc["next"].to<JsonArray>());
  std::string serialized;
  serializeJson(doc, serialized);
  EXPECT_TRUE(serialized.find("\"name\":\"Francisco Lindor\"") != std::string::npos);

  JsonDocument parsed;
  EXPECT_TRUE(deserializeJson(parsed, serialized) == DeserializationError::Ok);
  NextTracks loaded;
  loaded.read(parsed["next"].as<JsonArrayConst>(), [](const char*) { return true; });
  EXPECT_EQ(loaded.size(), 3);
  EXPECT_EQ(line_of(loaded, false, "Francisco Lindor"), std::string("/l.wav"));
  EXPECT_EQ(loaded.at(1).player_id, 596019);
  EXPECT_EQ(line_of(loaded, true, ""), std::string("/w.wav"));

  // A queued track deleted from the card drops out on load.
  NextTracks repaired;
  repaired.read(parsed["next"].as<JsonArrayConst>(), [](const char* file) { return std::string(file) != "/l.wav"; });
  EXPECT_EQ(repaired.size(), 2);
  EXPECT_EQ(repaired.line_count(false, "Francisco Lindor"), 0);

  // A manifest written before up-next existed has no "next" at all.
  JsonDocument old;
  EXPECT_TRUE(deserializeJson(old, "{\"v\":1,\"tracks\":[],\"players\":[]}") == DeserializationError::Ok);
  NextTracks none;
  none.add(true, 0, "", "/stale.wav");
  none.read(old["next"].as<JsonArrayConst>(), [](const char*) { return true; });
  EXPECT_EQ(none.size(), 0);

  // Too many entries in a line on the card are trimmed to the cap.
  JsonDocument crowded;
  JsonArray list = crowded["next"].to<JsonArray>();
  for (int i = 0; i < kMaxNextPerLine + 2; ++i) {
    JsonObject node = list.add<JsonObject>();
    node["win"] = true;
    node["file"] = "/w.wav";
  }
  NextTracks trimmed;
  trimmed.read(crowded["next"].as<JsonArrayConst>(), [](const char*) { return true; });
  EXPECT_EQ(trimmed.line_count(true, ""), kMaxNextPerLine);
}

}  // namespace

int main() {
  test_lines_are_independent();
  test_add_at_front_and_positions();
  test_caps();
  test_remove_by_place_with_duplicates();
  test_move_keeps_other_lines_in_place();
  test_consume_follows_the_apple_precedence();
  test_clear_and_drop();
  test_manifest_round_trip_and_repair();
  std::cout << "next tracks tests passed\n";
  return 0;
}
