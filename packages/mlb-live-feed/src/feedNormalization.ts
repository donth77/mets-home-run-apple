import type {
  AtBatState,
  CanonicalGameFrame,
  GameHalf,
  GamePhase,
  GameSnapshot,
  GameStatusClassification,
  GameStatusClassifier,
  GameStatusFacts,
  NormalizedPlayEvidence,
  ReviewState,
} from "@apple/protocol";
import { MAXIMUM_POLL_WAIT_MS, MINIMUM_POLL_WAIT_MS, MLB_TIMECODE_PATTERN } from "./constants";
import { MlbFeedError } from "./errors";
import { type CanonicalGameProjector, projectCanonicalGameFrame } from "./feedProjections";
import {
  arrayAt,
  booleanAt,
  clampInteger,
  isObject,
  type JsonObject,
  numberAt,
  objectAt,
  optionalNumberAt,
  stringAt,
} from "./jsonValue";
import type { FeedPayloadKind, MlbCelebrationReplayCandidate, NormalizedFeedCapture } from "./types";

type CoreHalf = GameHalf;
type CorePlayEvidence = NormalizedPlayEvidence;

export function waitMilliseconds(feed: unknown): number {
  const waitSeconds = numberAt(objectAt(feed, "metaData"), "wait", 10);
  return clampInteger(waitSeconds * 1_000, MINIMUM_POLL_WAIT_MS, MAXIMUM_POLL_WAIT_MS);
}

export function feedCursor(feed: unknown): string {
  const cursor = stringAt(objectAt(feed, "metaData"), "timeStamp");
  if (!MLB_TIMECODE_PATTERN.test(cursor)) {
    throw new MlbFeedError("Live feed did not include a valid time cursor.", "INVALID_CURSOR");
  }
  return cursor;
}

function reviewState(play: unknown): ReviewState {
  const details = objectAt(play, "reviewDetails");
  if (!details) return "NONE";
  if (booleanAt(details, "inProgress")) return "PENDING";
  if (booleanAt(details, "isOverturned")) return "OVERTURNED";
  return "CONFIRMED";
}

function halfFromText(value: string): CoreHalf {
  const normalized = value.toLowerCase();
  if (normalized === "bottom") return "BOTTOM";
  if (normalized === "middle") return "MIDDLE";
  if (normalized === "end") return "END";
  return "TOP";
}

// ---------------------------------------------------------------------------
// Game status classification.
//
// This is the TypeScript mirror of firmware/lib/game_state/src/status.cpp.
// Production apps hand the client the WebAssembly build of that C++ (see
// GameStateProjector.classifyStatus); this copy is the default for tests and
// the parity test in index.test.ts keeps the two identical.
//
// MLB reports a mid-game delay as detailedState "Delayed" with code IO, and
// names the reason in a "Game Advisory" play event on the current play
// ("Status Change - Delayed: Rain"). Before first pitch the status itself says
// "Delayed Start: Rain" (PR). Rain, inclement weather, lightning, and wet
// grounds all count as a rain delay; suspended, postponed, and cancelled games
// keep MLB's label so the apples can show their own screens.
// ---------------------------------------------------------------------------

export const RAIN_DELAY_LABEL = "RAIN DELAY";

/** Whole-word match with alphanumeric boundaries, matching the C++ helper. */
function containsWord(text: string, word: string) {
  const lowered = text.toLowerCase();
  const needle = word.toLowerCase();
  for (let at = lowered.indexOf(needle); at !== -1; at = lowered.indexOf(needle, at + 1)) {
    const leftOk = at === 0 || !/[a-z0-9]/.test(lowered[at - 1] ?? "");
    const after = at + needle.length;
    const rightOk = after >= lowered.length || !/[a-z0-9]/.test(lowered[after] ?? "");
    if (leftOk && rightOk) return true;
  }
  return false;
}

function mentionsWetWeather(lowered: string) {
  return (
    containsWord(lowered, "rain") ||
    lowered.includes("inclement weather") ||
    lowered.includes("lightning") ||
    lowered.includes("wet grounds")
  );
}

// MLB status codes: first letter I (in progress) or P (pre-game) for a delay,
// second letter R rain, I inclement weather, L lightning, G wet grounds.
function weatherDelayCode(code: string) {
  return code.length === 2 && (code[0] === "I" || code[0] === "P") && ["R", "I", "L", "G"].includes(code[1] ?? "");
}

export function phaseForStatus(facts: GameStatusFacts): GamePhase {
  if (facts.reviewPending) return "REVIEW";
  const abstractState = facts.abstractState.trim().toLowerCase();
  const detailedState = facts.detailedState.trim().toLowerCase();
  // Postponed and cancelled games carry abstractGameState "Final" in MLB's
  // table, so the interruption words come before the final test.
  if (["delayed", "postponed", "suspended", "cancelled", "canceled"].some((word) => detailedState.includes(word)))
    return "DELAYED";
  if (
    abstractState === "final" ||
    detailedState.includes("final") ||
    detailedState === "game over" ||
    detailedState.includes("completed early")
  )
    return "FINAL";
  if (detailedState.includes("challenge") || detailedState.includes("review")) return "REVIEW";
  if (abstractState === "live" || detailedState === "in progress" || detailedState === "manager challenge")
    return "LIVE";
  if (abstractState === "preview" || detailedState.includes("scheduled") || detailedState === "pre-game")
    return "PREGAME";
  return "SLEEP";
}

/** A delay (not a suspension or postponement) MLB attributes to wet weather. */
export function weatherDelay(facts: GameStatusFacts): boolean {
  const detailedState = facts.detailedState.trim().toLowerCase();
  const code = facts.statusCode.trim().toUpperCase();
  const delayed = detailedState.includes("delayed") || weatherDelayCode(code);
  if (!delayed) return false;
  if (weatherDelayCode(code)) return true;
  if (mentionsWetWeather(facts.reason.trim().toLowerCase()) || mentionsWetWeather(detailedState)) return true;
  const advisory = facts.latestAdvisory.trim().toLowerCase();
  return advisory.includes("delay") && mentionsWetWeather(advisory);
}

export function classifyGameStatus(facts: GameStatusFacts): GameStatusClassification {
  const phase = phaseForStatus(facts);
  if (phase === "FINAL") return { phase, label: "FINAL", weatherDelay: false };
  if (phase === "REVIEW") return { phase, label: "PLAY UNDER REVIEW", weatherDelay: false };
  if (phase === "LIVE") return { phase, label: "LIVE", weatherDelay: false };
  const weather = phase === "DELAYED" && weatherDelay(facts);
  if (weather) return { phase, label: RAIN_DELAY_LABEL, weatherDelay: true };
  const detailed = facts.detailedState.trim();
  if (detailed) return { phase, label: detailed, weatherDelay: false };
  return {
    phase,
    label: phase === "PREGAME" ? "PREGAME" : phase === "DELAYED" ? "DELAYED" : "SLEEP",
    weatherDelay: false,
  };
}

/** The newest "Game Advisory" event on the current play, where MLB names a delay's reason. */
function latestGameAdvisory(play: unknown): string {
  let latest = "";
  for (const event of arrayAt(play, "playEvents")) {
    const details = objectAt(event, "details");
    const description = stringAt(details, "description").trim();
    if (!description) continue;
    if (stringAt(details, "eventType") === "game_advisory" || description.startsWith("Status Change"))
      latest = description;
  }
  return latest;
}

export function gameStatusFacts(feed: unknown, currentPlay: unknown, currentReview: ReviewState): GameStatusFacts {
  const status = objectAt(objectAt(feed, "gameData"), "status");
  return {
    abstractState: stringAt(status, "abstractGameState"),
    detailedState: stringAt(status, "detailedState"),
    statusCode: stringAt(status, "statusCode"),
    reason: stringAt(status, "reason"),
    latestAdvisory: latestGameAdvisory(currentPlay),
    reviewPending: currentReview === "PENDING",
  };
}

export function playEventKey(play: unknown, gamePk: number): string {
  const events = arrayAt(play, "playEvents");
  const finalEvent = [...events].reverse().find(isObject);
  const playId = stringAt(finalEvent, "playId");
  const atBatIndex = numberAt(objectAt(play, "about"), "atBatIndex", -1);
  return playId ? `${gamePk}:${playId}` : `${gamePk}:atbat-${atBatIndex}`;
}

function normalizePlay(
  play: unknown,
  gamePk: number,
  awayTeamId: number,
  homeTeamId: number,
): CorePlayEvidence | undefined {
  if (!isObject(play)) return undefined;
  const about = objectAt(play, "about");
  const result = objectAt(play, "result");
  const matchup = objectAt(play, "matchup");
  const half = stringAt(about, "halfInning").toLowerCase();
  const battingTeamId = half === "bottom" ? homeTeamId : awayTeamId;
  const atBatIndex = numberAt(about, "atBatIndex", -1);
  if (atBatIndex < 0 || battingTeamId <= 0) return undefined;
  const eventType = stringAt(result, "eventType");
  return {
    eventKey: playEventKey(play, gamePk),
    atBatIndex,
    battingTeamId,
    batterName: stringAt(objectAt(matchup, "batter"), "fullName"),
    kind: eventType === "home_run" ? (numberAt(result, "rbi") === 4 ? "GRAND_SLAM" : "HOME_RUN") : "OTHER",
    complete: booleanAt(about, "isComplete"),
    review: reviewState(play),
  };
}

function playCompletedAt(play: unknown): string | undefined {
  const value = stringAt(objectAt(play, "about"), "endTime");
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function playFingerprint(play: CorePlayEvidence) {
  return [play.kind, play.complete ? 1 : 0, play.review, play.battingTeamId, play.batterName].join("|");
}

function normalizedTeam(team: unknown, score: unknown) {
  return {
    id: numberAt(team, "id"),
    abbreviation: stringAt(team, "abbreviation", "—"),
    name: stringAt(team, "teamName", stringAt(team, "name", "Unknown")),
    runs: numberAt(score, "runs"),
  };
}

function playerGameStats(
  liveData: JsonObject | undefined,
  side: "away" | "home" | undefined,
  playerId: number,
  group: "batting" | "pitching",
) {
  if (!side || playerId <= 0) return undefined;
  const boxscoreTeam = objectAt(objectAt(objectAt(liveData, "boxscore"), "teams"), side);
  const player = objectAt(objectAt(boxscoreTeam, "players"), `ID${playerId}`);
  return objectAt(objectAt(player, "stats"), group);
}

function batterGameLine(stats: JsonObject | undefined): string | undefined {
  const hits = optionalNumberAt(stats, "hits");
  const atBats = optionalNumberAt(stats, "atBats");
  if (hits === undefined || atBats === undefined) return undefined;
  const homeRuns = optionalNumberAt(stats, "homeRuns") ?? 0;
  const homeRunLabel = homeRuns > 0 ? ` · ${homeRuns > 1 ? `${homeRuns} HR` : "HR"}` : "";
  return `${hits}–${atBats}${homeRunLabel}`;
}

function inningOrdinal(inning: number) {
  const words = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
  if (words[inning]) return words[inning];
  const remainder = inning % 100;
  const suffix =
    remainder >= 11 && remainder <= 13
      ? "th"
      : inning % 10 === 1
        ? "st"
        : inning % 10 === 2
          ? "nd"
          : inning % 10 === 3
            ? "rd"
            : "th";
  return `${inning}${suffix}`;
}

function latestPlayEventDescription(play: unknown) {
  return (
    [...arrayAt(play, "playEvents")]
      .reverse()
      .map((event) => stringAt(objectAt(event, "details"), "description").trim())
      .find(Boolean) ?? ""
  );
}

function liveActivityDescription({
  allPlays,
  currentPlay,
  half,
  inning,
  phase,
  status,
}: {
  allPlays: readonly unknown[];
  currentPlay: unknown;
  half: CoreHalf;
  inning: number;
  phase: GamePhase;
  status: JsonObject | undefined;
}) {
  const result = objectAt(currentPlay, "result");
  const resultDescription = stringAt(result, "description").trim();
  const currentAbout = objectAt(currentPlay, "about");
  const complete = booleanAt(currentAbout, "isComplete");
  const latestEvent = latestPlayEventDescription(currentPlay);
  const currentHalf = half === "TOP" ? "top" : half === "BOTTOM" ? "bottom" : "";
  const hasPlayInCurrentHalf =
    currentHalf !== "" &&
    allPlays.some((play) => {
      const about = objectAt(play, "about");
      return numberAt(about, "inning", -1) === inning && stringAt(about, "halfInning").toLowerCase() === currentHalf;
    });

  if (phase === "LIVE" && currentHalf && !hasPlayInCurrentHalf) {
    const halfLabel = half === "TOP" ? "Top" : "Bottom";
    return `${halfLabel} ${inningOrdinal(inning)} begins`;
  }
  if (complete && resultDescription) return resultDescription;
  if (latestEvent) return latestEvent;
  if (resultDescription) return resultDescription;
  return stringAt(status, "detailedState", "Waiting for game data");
}

export function normalizeFeed(
  feed: unknown,
  gameNumber: 1 | 2,
  updateMode: "BOOTSTRAP" | "INCREMENTAL",
  priorFingerprints: ReadonlyMap<string, string>,
  payloadKind: Exclude<FeedPayloadKind, "NO_CHANGE">,
  receivedAt: string,
  deliveryCursor?: string,
  projectFrame: CanonicalGameProjector = projectCanonicalGameFrame,
  classifyStatus: GameStatusClassifier = classifyGameStatus,
): { capture: NormalizedFeedCapture; fingerprints: Map<string, string> } {
  if (!isObject(feed)) throw new MlbFeedError("Live feed root was not an object.", "INVALID_FEED_SHAPE");
  const gamePk = numberAt(feed, "gamePk");
  const gameData = objectAt(feed, "gameData");
  const liveData = objectAt(feed, "liveData");
  const teams = objectAt(gameData, "teams");
  const linescore = objectAt(liveData, "linescore");
  const lineTeams = objectAt(linescore, "teams");
  const away = normalizedTeam(teams?.away, objectAt(lineTeams, "away"));
  const home = normalizedTeam(teams?.home, objectAt(lineTeams, "home"));
  if (gamePk <= 0 || away.id <= 0 || home.id <= 0) {
    throw new MlbFeedError("Live feed omitted the game or team identity.", "INVALID_FEED_SHAPE");
  }

  const playsNode = objectAt(liveData, "plays");
  const allRawPlays = [...arrayAt(playsNode, "allPlays")];
  const currentPlay = playsNode?.currentPlay;
  if (isObject(currentPlay)) {
    const currentIndex = numberAt(objectAt(currentPlay, "about"), "atBatIndex", -1);
    const alreadyIncluded = allRawPlays.some(
      (play) => numberAt(objectAt(play, "about"), "atBatIndex", -2) === currentIndex,
    );
    if (!alreadyIncluded) allRawPlays.push(currentPlay);
  }
  const normalizedPlays = allRawPlays.flatMap((play) => {
    const normalized = normalizePlay(play, gamePk, away.id, home.id);
    return normalized ? [{ evidence: normalized, occurredAt: playCompletedAt(play) }] : [];
  });
  const allPlays = normalizedPlays.map(({ evidence }) => evidence);
  const replayCandidates: MlbCelebrationReplayCandidate[] =
    updateMode === "BOOTSTRAP"
      ? normalizedPlays.flatMap(({ evidence, occurredAt }) =>
          occurredAt && (evidence.kind === "HOME_RUN" || evidence.kind === "GRAND_SLAM")
            ? [{ eventKey: evidence.eventKey, kind: evidence.kind, occurredAt }]
            : [],
        )
      : [];
  const fingerprints = new Map(priorFingerprints);
  const changedPlays = allPlays.filter((play) => {
    const fingerprint = playFingerprint(play);
    const changed = updateMode === "BOOTSTRAP" || fingerprints.get(play.eventKey) !== fingerprint;
    fingerprints.set(play.eventKey, fingerprint);
    return changed;
  });

  const currentAbout = objectAt(currentPlay, "about");
  const inning = clampInteger(numberAt(linescore, "currentInning", numberAt(currentAbout, "inning", 0)), 0, 99);
  const inningState = stringAt(linescore, "inningState").toLowerCase();
  const currentReview = reviewState(currentPlay);
  const classification = classifyStatus(gameStatusFacts(feed, currentPlay, currentReview));
  const feedPhase = classification.phase;
  // MLB can publish the completed half-inning before its separate game status
  // changes to Final. A decisive ninth inning (or later) is nevertheless
  // terminal, so do not expose a transient MID/END 9 frame to clients.
  const phase =
    feedPhase === "LIVE" &&
    inning >= 9 &&
    ((inningState === "middle" && home.runs > away.runs) || (inningState === "end" && home.runs !== away.runs))
      ? "FINAL"
      : feedPhase;
  if (updateMode === "BOOTSTRAP" && phase === "FINAL") {
    const occurredAt = [...allRawPlays].reverse().map(playCompletedAt).find(Boolean);
    if (occurredAt) replayCandidates.push({ eventKey: `${gamePk}:final`, kind: "FINAL", occurredAt });
  }
  const feedHalf = halfFromText(
    inningState === "middle" || inningState === "end"
      ? inningState
      : stringAt(linescore, "inningHalf", stringAt(currentAbout, "halfInning", "top")),
  );
  // Middle follows the top half; End follows the bottom half. Phase, rather
  // than the half label, determines whether the game itself is final.
  const half = phase === "FINAL" ? "END" : feedHalf;
  const feedOuts = clampInteger(numberAt(linescore, "outs"), 0, 3) as 0 | 1 | 2 | 3;
  const currentCount = objectAt(currentPlay, "count");
  const currentMatchup = objectAt(currentPlay, "matchup");
  const currentBatter = objectAt(currentMatchup, "batter");
  const currentPitcher = objectAt(currentMatchup, "pitcher");
  const offense = objectAt(linescore, "offense");
  const defense = objectAt(linescore, "defense");
  const offenseBatter = objectAt(offense, "batter");
  const defensePitcher = objectAt(defense, "pitcher");
  const currentBatterId = numberAt(currentBatter, "id", -1);
  const offenseBatterId = numberAt(offenseBatter, "id", -1);
  const currentPitcherId = numberAt(currentPitcher, "id", -1);
  const defensePitcherId = numberAt(defensePitcher, "id", -1);
  const playMatchesInning =
    (half === "TOP" || half === "BOTTOM") &&
    numberAt(currentAbout, "inning", -1) === inning &&
    halfFromText(stringAt(currentAbout, "halfInning")) === half;
  const situationIsActive = ["LIVE", "REVIEW", "DELAYED"].includes(phase) && playMatchesInning;
  const plateAppearanceComplete = booleanAt(currentAbout, "isComplete");
  const batterAdvanced = offenseBatterId > 0 && currentBatterId > 0 && offenseBatterId !== currentBatterId;
  const batter =
    offenseBatterId > 0 && (currentBatterId <= 0 || plateAppearanceComplete || batterAdvanced)
      ? offenseBatter
      : currentBatter;
  const pitcher =
    defensePitcherId > 0 && (currentPitcherId <= 0 || defensePitcherId !== currentPitcherId)
      ? defensePitcher
      : currentPitcher;
  const countIsCurrent = situationIsActive && !plateAppearanceComplete && !batterAdvanced;
  const outs = situationIsActive ? feedOuts : 0;
  const battingSide = half === "TOP" ? "away" : half === "BOTTOM" ? "home" : undefined;
  const pitchingSide = half === "TOP" ? "home" : half === "BOTTOM" ? "away" : undefined;
  const battingStats = playerGameStats(liveData, battingSide, numberAt(batter, "id", -1), "batting");
  const pitchingStats = playerGameStats(liveData, pitchingSide, numberAt(pitcher, "id", -1), "pitching");
  const status = objectAt(gameData, "status");
  const scheduledStart = stringAt(objectAt(gameData, "datetime"), "dateTime") || undefined;
  const venue = stringAt(objectAt(gameData, "venue"), "name") || undefined;
  const lastEvent = liveActivityDescription({
    allPlays: allRawPlays,
    currentPlay,
    half,
    inning,
    phase,
    status,
  });
  const innings = arrayAt(linescore, "innings").flatMap((candidate) => {
    if (!isObject(candidate)) return [];
    const inningNumber = numberAt(candidate, "num");
    const homeHalfHasNotStarted =
      inningNumber === inning && (half === "TOP" || (half === "MIDDLE" && inningState === "middle"));
    return [
      {
        inning: inningNumber,
        away: objectAt(candidate, "away") ? numberAt(objectAt(candidate, "away"), "runs") : null,
        home:
          !homeHalfHasNotStarted && objectAt(candidate, "home") ? numberAt(objectAt(candidate, "home"), "runs") : null,
      },
    ];
  });

  const cursor = deliveryCursor ?? feedCursor(feed);
  const atBat: AtBatState | undefined = situationIsActive
    ? {
        balls: countIsCurrent ? (clampInteger(numberAt(currentCount, "balls"), 0, 3) as 0 | 1 | 2 | 3) : 0,
        strikes: countIsCurrent ? (clampInteger(numberAt(currentCount, "strikes"), 0, 2) as 0 | 1 | 2) : 0,
        bases: {
          first: Boolean(offense?.first),
          second: Boolean(offense?.second),
          third: Boolean(offense?.third),
        },
        batter: stringAt(batter, "fullName") || undefined,
        batterLine: batterGameLine(battingStats),
        pitcher: stringAt(pitcher, "fullName") || undefined,
        pitchCount: optionalNumberAt(pitchingStats, "numberOfPitches"),
      }
    : undefined;
  const canonical: CanonicalGameFrame = {
    gamePk,
    gameNumber,
    cursor,
    updateMode,
    phase,
    // An inferred final (decisive ninth before MLB flips its status) keeps
    // the final label; every other phase carries the shared classification.
    label: phase === "FINAL" ? "FINAL" : classification.label,
    away,
    home,
    inning,
    half,
    displayOuts: outs,
    evidenceOuts: feedOuts,
    review: currentReview,
    lastEvent,
    scheduledStart,
    venue,
    atBat,
    linescore: {
      innings,
      awayHits: numberAt(objectAt(lineTeams, "away"), "hits"),
      homeHits: numberAt(objectAt(lineTeams, "home"), "hits"),
      awayErrors: numberAt(objectAt(lineTeams, "away"), "errors"),
      homeErrors: numberAt(objectAt(lineTeams, "home"), "errors"),
    },
    changedPlays,
  };
  const { gameSnapshot, coreInput } = projectFrame(canonical);

  return {
    capture: {
      coreInput,
      gameSnapshot,
      cursor,
      waitMs: waitMilliseconds(feed),
      payloadKind,
      receivedAt,
      rawPlayCount: allPlays.length,
      changedPlayCount: changedPlays.length,
      replayCandidates,
    },
    fingerprints,
  };
}

export function normalizedStateFingerprint(snapshot: GameSnapshot, fingerprints: ReadonlyMap<string, string>) {
  return JSON.stringify({
    snapshot,
    plays: [...fingerprints.entries()].sort(([left], [right]) => left.localeCompare(right)),
  });
}
