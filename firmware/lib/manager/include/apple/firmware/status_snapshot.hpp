#pragma once

#include <ArduinoJson.h>
#include "apple/game_state/types.hpp"

namespace apple::firmware {
// Presentation serialization only. Every value comes from the canonical
// projector; this adapter makes no game or celebration decisions.
inline void write_status_snapshot(JsonObject out, const game_state::GameSnapshot& s) {
  static constexpr const char* phases[] = {"PREGAME", "LIVE", "REVIEW", "DELAYED", "FINAL", "SLEEP"};
  static constexpr const char* halves[] = {"TOP", "BOTTOM", "MIDDLE", "END"};
  static constexpr const char* reviews[] = {"NONE", "PENDING", "CONFIRMED", "OVERTURNED"};
  out["schemaVersion"] = s.schema_version;
  out["gamePk"] = s.game_pk;
  out["gameNumber"] = s.game_number;
  out["phase"] = phases[static_cast<unsigned>(s.phase)];
  out["half"] = halves[static_cast<unsigned>(s.half)];
  out["review"] = reviews[static_cast<unsigned>(s.review)];
  out["label"] = s.label;
  out["inning"] = s.inning;
  out["outs"] = s.outs;
  out["lastEvent"] = s.last_event;
  const auto team = [](JsonObject node, const game_state::TeamScore& value) {
    node["id"] = value.id;
    node["name"] = value.name;
    node["abbreviation"] = value.abbreviation;
    node["runs"] = value.runs;
  };
  team(out["away"].to<JsonObject>(), s.away);
  team(out["home"].to<JsonObject>(), s.home);
  if (s.scheduled_start) out["scheduledStart"] = *s.scheduled_start;
  if (s.venue) out["venue"] = *s.venue;
  if (s.at_bat) {
    const auto& a = *s.at_bat;
    auto at = out["atBat"].to<JsonObject>();
    at["balls"] = a.balls; at["strikes"] = a.strikes;
    auto bases = at["bases"].to<JsonObject>();
    bases["first"] = a.bases.first; bases["second"] = a.bases.second; bases["third"] = a.bases.third;
    if (a.batter) at["batter"] = *a.batter;
    if (a.batter_line) at["batterLine"] = *a.batter_line;
    if (a.pitcher) at["pitcher"] = *a.pitcher;
    if (a.pitch_count) at["pitchCount"] = *a.pitch_count;
    // Keep the Manager's existing compact field names working.
    at["first"] = a.bases.first; at["second"] = a.bases.second; at["third"] = a.bases.third;
  }
  auto lines = out["linescore"].to<JsonObject>();
  auto innings = lines["innings"].to<JsonArray>();
  for (const auto& i : s.linescore.innings) {
    auto item = innings.add<JsonObject>();
    item["inning"] = i.inning;
    if (i.away) item["away"] = *i.away; else item["away"] = nullptr;
    if (i.home) item["home"] = *i.home; else item["home"] = nullptr;
  }
  if (s.linescore.away_hits) lines["awayHits"] = *s.linescore.away_hits;
  if (s.linescore.home_hits) lines["homeHits"] = *s.linescore.home_hits;
  if (s.linescore.away_errors) lines["awayErrors"] = *s.linescore.away_errors;
  if (s.linescore.home_errors) lines["homeErrors"] = *s.linescore.home_errors;
  out["awayRuns"] = s.away.runs; out["homeRuns"] = s.home.runs;
  out["awayId"] = s.away.id; out["homeId"] = s.home.id;
}
}  // namespace apple::firmware
