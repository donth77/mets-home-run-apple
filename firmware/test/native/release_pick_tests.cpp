// The release chooser against GitHub's real /releases shape, including the
// pre-release rule and semantic-version ordering with suffixes.
#include "apple/firmware/release_pick.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

namespace {

using apple::firmware::compare_release_versions;
using apple::firmware::parse_release_version;
using apple::firmware::pick_release;
using apple::firmware::ReleasePick;

[[noreturn]] void fail(const std::string &message, int line) {
  std::cerr << "FAIL line " << line << ": " << message << '\n';
  std::exit(1);
}

#define EXPECT_TRUE(value)                                                     \
  do {                                                                         \
    if (!(value))                                                              \
      fail("expected true: " #value, __LINE__);                                \
  } while (false)

#define EXPECT_EQ(actual, expected)                                            \
  do {                                                                         \
    if (!((actual) == (expected)))                                             \
      fail("values differ: " #actual " != " #expected, __LINE__);              \
  } while (false)

int cmp(const char *a, const char *b) {
  return compare_release_versions(parse_release_version(a), parse_release_version(b));
}

void test_versions() {
  EXPECT_TRUE(parse_release_version("0.3.0").valid);
  EXPECT_TRUE(parse_release_version("firmware-v0.3.0-rc.1").valid);
  EXPECT_EQ(parse_release_version("firmware-v0.3.0-rc.1").suffix, std::string("rc.1"));
  EXPECT_TRUE(!parse_release_version("0.3").valid);
  EXPECT_TRUE(!parse_release_version("0.3.0-").valid);
  EXPECT_TRUE(!parse_release_version("latest").valid);
  EXPECT_TRUE(!parse_release_version("0.2.2-crashtest ").valid);
  EXPECT_TRUE(cmp("0.2.10", "0.2.9") > 0);
  EXPECT_TRUE(cmp("0.3.0", "0.2.10") > 0);
  EXPECT_TRUE(cmp("0.3.0", "0.3.0-rc.9") > 0);
  EXPECT_TRUE(cmp("0.3.0-rc.2", "0.3.0-rc.1") > 0);
  EXPECT_TRUE(cmp("0.3.0-rc.10", "0.3.0-rc.9") > 0);
  EXPECT_TRUE(cmp("0.3.0-rc.1", "0.2.10-rc.1") > 0);
  EXPECT_TRUE(cmp("0.3.0-beta", "0.3.0-alpha") > 0);
  EXPECT_TRUE(cmp("0.3.0-rc.1", "0.3.0-rc.1") == 0);
  EXPECT_TRUE(cmp("v0.3.0", "0.3.0") == 0);
}

// Shaped like GitHub's answer, trimmed to the fields the filter keeps.
const char *kReleases = R"([
  {"tag_name": "firmware-v0.4.0", "draft": true, "prerelease": false,
   "assets": [{"name": "home-run-apple-0.4.0.bin", "url": "https://api.github.com/repos/x/y/releases/assets/4", "size": 1500000}]},
  {"tag_name": "firmware-v0.3.0-rc.2", "draft": false, "prerelease": true,
   "assets": [{"name": "home-run-apple-0.3.0-rc.2.bin", "url": "https://api.github.com/repos/x/y/releases/assets/3", "size": 1500936},
              {"name": "home-run-apple-0.3.0-rc.2.bin.sha256", "url": "https://api.github.com/repos/x/y/releases/assets/5", "size": 98}]},
  {"tag_name": "firmware-v0.2.10", "draft": false, "prerelease": false,
   "assets": [{"name": "home-run-apple-0.2.10.bin.sha256", "url": "https://api.github.com/repos/x/y/releases/assets/9", "size": 98},
              {"name": "home-run-apple-0.2.10.bin", "url": "https://api.github.com/repos/x/y/releases/assets/2", "size": 1500000}]},
  {"tag_name": "firmware-v0.2.9", "draft": false, "prerelease": false,
   "assets": [{"name": "home-run-apple-0.2.9.bin", "url": "https://api.github.com/repos/x/y/releases/assets/1", "size": 1499000}]},
  {"tag_name": "site-v1", "draft": false, "prerelease": false, "assets": []},
  {"tag_name": "firmware-v0.2.11", "draft": false, "prerelease": false, "assets": []}
])";

JsonDocument parse(const char *text) {
  JsonDocument filter;
  EXPECT_TRUE(deserializeJson(filter, apple::firmware::releases_filter_json()) == DeserializationError::Ok);
  JsonDocument doc;
  EXPECT_TRUE(deserializeJson(doc, text, DeserializationOption::Filter(filter)) == DeserializationError::Ok);
  return doc;
}

void test_pick() {
  JsonDocument doc = parse(kReleases);
  // A final release only: the newest final with a .bin, ignoring the draft,
  // the pre-release, the unrelated tag, and the release without a file.
  ReleasePick pick = pick_release(doc.as<JsonArrayConst>(), "0.2.9", false);
  EXPECT_TRUE(pick.found);
  EXPECT_EQ(pick.version, std::string("0.2.10"));
  EXPECT_EQ(pick.asset_name, std::string("home-run-apple-0.2.10.bin"));
  EXPECT_EQ(pick.asset_url, std::string("https://api.github.com/repos/x/y/releases/assets/2"));
  EXPECT_EQ(pick.asset_size, 1500000L);
  EXPECT_TRUE(!pick.prerelease);
  // Opted into pre-releases: the release candidate wins.
  pick = pick_release(doc.as<JsonArrayConst>(), "0.2.9", true);
  EXPECT_TRUE(pick.found);
  EXPECT_EQ(pick.version, std::string("0.3.0-rc.2"));
  EXPECT_EQ(pick.tag, std::string("firmware-v0.3.0-rc.2"));
  EXPECT_TRUE(pick.prerelease);
  EXPECT_EQ(pick.asset_name, std::string("home-run-apple-0.3.0-rc.2.bin"));
  // Already current, or newer than anything published: nothing to do.
  EXPECT_TRUE(!pick_release(doc.as<JsonArrayConst>(), "0.2.10", false).found);
  EXPECT_TRUE(!pick_release(doc.as<JsonArrayConst>(), "0.3.0-rc.2", true).found);
  EXPECT_TRUE(!pick_release(doc.as<JsonArrayConst>(), "0.3.0", true).found);
  // An Apple on a pre-release moves to the final release of the same version.
  pick = pick_release(doc.as<JsonArrayConst>(), "0.2.10-rc.1", false);
  EXPECT_EQ(pick.version, std::string("0.2.10"));
  // A development build with an unparseable version takes the newest release.
  pick = pick_release(doc.as<JsonArrayConst>(), "0.2.2-crashtest ", false);
  EXPECT_EQ(pick.version, std::string("0.2.10"));
  EXPECT_TRUE(!pick_release(JsonArrayConst(), "0.2.9", true).found);
}

}  // namespace

int main() {
  test_versions();
  test_pick();
  std::cout << "release_pick tests passed\n";
  return 0;
}
