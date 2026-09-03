#include "apple/game_state/status.hpp"

#include <cctype>
#include <string>

namespace apple::game_state {

namespace {

std::string lower(std::string_view text) {
  std::string out(text);
  for (char &c : out)
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return out;
}

std::string upper(std::string_view text) {
  std::string out(text);
  for (char &c : out)
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  return out;
}

std::string_view trim(std::string_view text) {
  while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front())))
    text.remove_prefix(1);
  while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back())))
    text.remove_suffix(1);
  return text;
}

bool contains(std::string_view text, std::string_view part) {
  return text.find(part) != std::string_view::npos;
}

// MLB's status codes: the first letter is the game state (P pre-game,
// I in progress, T/U suspended, D postponed, C cancelled, F/O final) and the
// second the reason. R rain, I inclement weather, L lightning, G wet grounds.
bool weather_delay_code(std::string_view code) {
  if (code.size() != 2)
    return false;
  const bool delay = code[0] == 'I' || code[0] == 'P';
  const bool weather = code[1] == 'R' || code[1] == 'I' || code[1] == 'L' || code[1] == 'G';
  return delay && weather;
}

// The words MLB uses for wet weather in reasons, states, and advisories.
bool mentions_wet_weather(std::string_view lowered) {
  return contains_word(lowered, "rain") || contains(lowered, "inclement weather") ||
         contains(lowered, "lightning") || contains(lowered, "wet grounds");
}

} // namespace

bool contains_word(std::string_view text, std::string_view word) {
  const std::string lowered = lower(text);
  const std::string needle = lower(word);
  for (std::size_t at = lowered.find(needle); at != std::string::npos;
       at = lowered.find(needle, at + 1)) {
    const bool left_ok = at == 0 || !std::isalnum(static_cast<unsigned char>(lowered[at - 1]));
    const std::size_t after = at + needle.size();
    const bool right_ok =
        after >= lowered.size() || !std::isalnum(static_cast<unsigned char>(lowered[after]));
    if (left_ok && right_ok)
      return true;
  }
  return false;
}

Phase phase_for_status(const StatusFacts &facts) {
  if (facts.review_pending)
    return Phase::Review;
  const std::string abstract_state = lower(trim(facts.abstract_state));
  const std::string detailed_state = lower(trim(facts.detailed_state));
  // Postponed and cancelled games carry abstractGameState "Final" in MLB's
  // table, so the interruption words come before the final test.
  for (const char *word : {"delayed", "postponed", "suspended", "cancelled", "canceled"}) {
    if (contains(detailed_state, word))
      return Phase::Delayed;
  }
  if (abstract_state == "final" || contains(detailed_state, "final") ||
      detailed_state == "game over" || contains(detailed_state, "completed early"))
    return Phase::Final;
  if (contains(detailed_state, "challenge") || contains(detailed_state, "review"))
    return Phase::Review;
  if (abstract_state == "live" || detailed_state == "in progress" ||
      detailed_state == "manager challenge")
    return Phase::Live;
  if (abstract_state == "preview" || contains(detailed_state, "scheduled") ||
      detailed_state == "pre-game")
    return Phase::Pregame;
  return Phase::Sleep;
}

bool weather_delay(const StatusFacts &facts) {
  const std::string detailed_state = lower(trim(facts.detailed_state));
  const std::string code = upper(trim(facts.status_code));
  // A delay, as opposed to a suspended, postponed, or cancelled game.
  const bool delayed = contains(detailed_state, "delayed") || weather_delay_code(code);
  if (!delayed)
    return false;
  if (weather_delay_code(code))
    return true;
  if (mentions_wet_weather(lower(trim(facts.reason))) || mentions_wet_weather(detailed_state))
    return true;
  // "Status Change - Delayed: Rain": the advisory names the reason the
  // status block left out. Only a delay advisory counts; "Status Change -
  // In Progress" after a resume never mentions weather anyway.
  const std::string advisory = lower(trim(facts.latest_advisory));
  return contains(advisory, "delay") && mentions_wet_weather(advisory);
}

StatusClassification classify_status(const StatusFacts &facts) {
  StatusClassification out;
  out.phase = phase_for_status(facts);
  switch (out.phase) {
  case Phase::Final:
    out.label = "FINAL";
    return out;
  case Phase::Review:
    out.label = "PLAY UNDER REVIEW";
    return out;
  case Phase::Live:
    out.label = "LIVE";
    return out;
  case Phase::Delayed:
    out.weather_delay = weather_delay(facts);
    if (out.weather_delay) {
      out.label = kRainDelayLabel;
      return out;
    }
    break;
  case Phase::Pregame:
  case Phase::Sleep:
    break;
  }
  const std::string_view detailed = trim(facts.detailed_state);
  if (!detailed.empty()) {
    out.label = std::string(detailed);
    return out;
  }
  out.label = out.phase == Phase::Pregame ? "PREGAME"
              : out.phase == Phase::Delayed ? "DELAYED"
                                            : "SLEEP";
  return out;
}

} // namespace apple::game_state
