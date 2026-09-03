#include "apple/firmware/release_pick.hpp"

#include <cctype>
#include <cstdlib>
#include <cstring>

namespace apple::firmware {

namespace {

constexpr char kReleasesFilter[] = R"([
  {"tag_name": true, "draft": true, "prerelease": true,
   "assets": [{"name": true, "url": true, "size": true}]}
])";

bool ends_with(const std::string &text, const char *suffix) {
  const std::size_t n = std::strlen(suffix);
  return text.size() >= n && text.compare(text.size() - n, n, suffix) == 0;
}

// "rc.1" vs "rc.2": split on dots, numeric parts compare as numbers.
int compare_suffix(const std::string &a, const std::string &b) {
  std::size_t ia = 0;
  std::size_t ib = 0;
  while (ia < a.size() || ib < b.size()) {
    const std::size_t ea = a.find('.', ia) == std::string::npos ? a.size() : a.find('.', ia);
    const std::size_t eb = b.find('.', ib) == std::string::npos ? b.size() : b.find('.', ib);
    const std::string pa = a.substr(ia, ea - ia);
    const std::string pb = b.substr(ib, eb - ib);
    if (pa.empty() && !pb.empty()) return -1;
    if (!pa.empty() && pb.empty()) return 1;
    const bool na = !pa.empty() && std::isdigit(static_cast<unsigned char>(pa[0]));
    const bool nb = !pb.empty() && std::isdigit(static_cast<unsigned char>(pb[0]));
    if (na && nb) {
      const long x = std::strtol(pa.c_str(), nullptr, 10);
      const long y = std::strtol(pb.c_str(), nullptr, 10);
      if (x != y) return x < y ? -1 : 1;
    } else if (na != nb) {
      return na ? -1 : 1;  // numbers sort before words, as in semver
    } else {
      const int c = pa.compare(pb);
      if (c != 0) return c < 0 ? -1 : 1;
    }
    ia = ea + 1;
    ib = eb + 1;
    if (ea == a.size()) ia = a.size();
    if (eb == b.size()) ib = b.size();
  }
  return 0;
}

}  // namespace

ReleaseVersion parse_release_version(const char *text) {
  ReleaseVersion v;
  if (text == nullptr) return v;
  const char *p = text;
  if (std::strncmp(p, "firmware-v", 10) == 0) p += 10;
  else if (*p == 'v') ++p;
  int parts[3] = {0, 0, 0};
  for (int i = 0; i < 3; ++i) {
    if (!std::isdigit(static_cast<unsigned char>(*p))) return v;
    char *end = nullptr;
    parts[i] = static_cast<int>(std::strtol(p, &end, 10));
    p = end;
    if (i < 2) {
      if (*p != '.') return v;
      ++p;
    }
  }
  if (*p == '-') {
    v.suffix = p + 1;
    if (v.suffix.empty()) return v;
    for (const char c : v.suffix) {
      if (!std::isalnum(static_cast<unsigned char>(c)) && c != '.' && c != '-') return v;
    }
  } else if (*p != '\0') {
    return v;
  }
  v.major = parts[0];
  v.minor = parts[1];
  v.patch = parts[2];
  v.valid = true;
  return v;
}

int compare_release_versions(const ReleaseVersion &a, const ReleaseVersion &b) {
  if (a.major != b.major) return a.major < b.major ? -1 : 1;
  if (a.minor != b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch != b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.suffix.empty() != b.suffix.empty()) return a.suffix.empty() ? 1 : -1;
  return compare_suffix(a.suffix, b.suffix);
}

ReleasePick pick_release(ArduinoJson::JsonArrayConst releases, const char *running,
                         bool include_prerelease) {
  ReleasePick best;
  ReleaseVersion best_version;
  const ReleaseVersion current = parse_release_version(running);
  for (ArduinoJson::JsonVariantConst release : releases) {
    if (release["draft"].as<bool>()) continue;
    const bool prerelease = release["prerelease"].as<bool>();
    if (prerelease && !include_prerelease) continue;
    const char *tag = release["tag_name"].as<const char *>();
    const ReleaseVersion version = parse_release_version(tag);
    if (!version.valid) continue;
    if (current.valid && compare_release_versions(version, current) <= 0) continue;
    if (best.found && compare_release_versions(version, best_version) <= 0) continue;
    for (ArduinoJson::JsonVariantConst asset : release["assets"].as<ArduinoJson::JsonArrayConst>()) {
      const char *name = asset["name"].as<const char *>();
      const char *url = asset["url"].as<const char *>();
      if (name == nullptr || url == nullptr || !ends_with(name, ".bin")) continue;
      best.found = true;
      best.tag = tag;
      best.version = tag + (std::strncmp(tag, "firmware-v", 10) == 0 ? 10 : 0);
      best.asset_url = url;
      best.asset_name = name;
      best.asset_size = asset["size"].as<long>();
      best.prerelease = prerelease;
      best_version = version;
      break;
    }
  }
  return best;
}

const char *releases_filter_json() { return kReleasesFilter; }

}  // namespace apple::firmware
