#pragma once

// Chooses which GitHub release, if any, an Apple should install. Portable
// (ArduinoJson only) so the native tests cover it with real API shapes.
//
// Releases are tagged `firmware-vX.Y.Z` with an optional pre-release suffix
// such as `0.3.0-rc.1`; the signed image is the `.bin` asset. A pre-release
// is offered only to an Apple that opted in. Versions compare as semantic
// versions: numbers first, then a version with a suffix ranks below the
// same numbers without one, and suffixes compare piecewise.

#include <ArduinoJson.h>

#include <string>

namespace apple::firmware {

struct ReleaseVersion {
  int major{0};
  int minor{0};
  int patch{0};
  std::string suffix;  // "rc.1" for 0.3.0-rc.1, empty for a final release
  bool valid{false};
};

/// Parses "0.3.0-rc.1" or "firmware-v0.3.0-rc.1".
ReleaseVersion parse_release_version(const char *text);

/// Negative, zero, or positive as `a` is older, the same, or newer than `b`.
int compare_release_versions(const ReleaseVersion &a, const ReleaseVersion &b);

/// The release an Apple running `running` should move to.
struct ReleasePick {
  bool found{false};
  std::string version;     // "0.3.0"
  std::string tag;         // "firmware-v0.3.0"
  std::string asset_url;   // GitHub API asset URL (needs Accept: application/octet-stream)
  std::string asset_name;  // "home-run-apple-0.3.0.bin"
  long asset_size{0};
  bool prerelease{false};
};

/// `releases` is GitHub's /repos/{owner}/{repo}/releases array. Drafts are
/// skipped, pre-releases only count when `include_prerelease` is set, and the
/// newest release strictly newer than `running` with a `.bin` asset wins.
ReleasePick pick_release(ArduinoJson::JsonArrayConst releases, const char *running,
                         bool include_prerelease);

/// ArduinoJson filter for the releases list, as JSON text: keeps only the
/// fields `pick_release` reads so a page of releases costs little memory.
const char *releases_filter_json();

}  // namespace apple::firmware
