import type {
  AtBatState,
  GameHalf,
  GamePhase,
  GameSnapshot,
  NormalizedPlayEvidence,
  ReviewState,
} from "@apple/protocol";
import { MAXIMUM_POLL_WAIT_MS, MINIMUM_POLL_WAIT_MS, MLB_TIMECODE_PATTERN } from "./constants";
import { MlbFeedError } from "./errors";
import {
  assertFeedProjectionAgreement,
  type CanonicalGameFrame,
  projectCoreInput,
  projectGameSnapshot,
} from "./feedProjections";
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
import type { FeedPayloadKind, NormalizedFeedCapture } from "./types";

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

function phaseForFeed(feed: unknown, currentReview: ReviewState): GamePhase {
  if (currentReview === "PENDING") return "REVIEW";
  const status = objectAt(objectAt(feed, "gameData"), "status");
  const abstractState = stringAt(status, "abstractGameState").toLowerCase();
  const detailedState = stringAt(status, "detailedState").toLowerCase();
  if (
    abstractState === "final" ||
    detailedState.includes("final") ||
    detailedState === "game over" ||
    detailedState.includes("completed early")
  )
    return "FINAL";
  if (["delayed", "postponed", "suspended", "cancelled", "canceled"].some((word) => detailedState.includes(word)))
    return "DELAYED";
  if (detailedState.includes("challenge") || detailedState.includes("review")) return "REVIEW";
  if (abstractState === "live" || detailedState === "in progress" || detailedState === "manager challenge")
    return "LIVE";
  if (abstractState === "preview" || detailedState.includes("scheduled") || detailedState === "pre-game")
    return "PREGAME";
  return "SLEEP";
}

const RAIN_DELAY_STATUS_CODES = new Set(["PR", "IR"]);

function isRainDelay(status: JsonObject | undefined) {
  const reason = stringAt(status, "reason").trim().toLowerCase();
  const detailedState = stringAt(status, "detailedState").trim().toLowerCase();
  const statusCode = stringAt(status, "statusCode").trim().toUpperCase();
  const delayed = detailedState.includes("delayed") || RAIN_DELAY_STATUS_CODES.has(statusCode);
  return delayed && (reason === "rain" || /\brain\b/.test(detailedState) || RAIN_DELAY_STATUS_CODES.has(statusCode));
}

function snapshotLabel(phase: GamePhase, status: JsonObject | undefined) {
  if (phase === "FINAL") return "FINAL";
  if (phase === "REVIEW") return "PLAY UNDER REVIEW";
  if (phase === "LIVE") return "LIVE";
  if (phase === "DELAYED" && isRainDelay(status)) return "RAIN DELAY";
  return stringAt(status, "detailedState", phase);
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
  const allPlays = allRawPlays.flatMap((play) => {
    const normalized = normalizePlay(play, gamePk, away.id, home.id);
    return normalized ? [normalized] : [];
  });
  const fingerprints = new Map(priorFingerprints);
  const changedPlays = allPlays.filter((play) => {
    const fingerprint = playFingerprint(play);
    const changed = updateMode === "BOOTSTRAP" || fingerprints.get(play.eventKey) !== fingerprint;
    fingerprints.set(play.eventKey, fingerprint);
    return changed;
  });

  const currentReview = reviewState(currentPlay);
  const phase = phaseForFeed(feed, currentReview);
  const currentAbout = objectAt(currentPlay, "about");
  const inning = clampInteger(numberAt(linescore, "currentInning", numberAt(currentAbout, "inning", 0)), 0, 99);
  const inningState = stringAt(linescore, "inningState").toLowerCase();
  const feedHalf = halfFromText(
    inningState === "middle" || inningState === "end"
      ? inningState
      : stringAt(linescore, "inningHalf", stringAt(currentAbout, "halfInning", "top")),
  );
  // MLB uses `inningState: "End"` for the brief changeover after the bottom
  // half. That means the inning ended, not the game. Reserve END for an
  // actually final game so presentation clients cannot mistake a live
  // pitching changeover for the final out.
  const half = phase === "FINAL" ? "END" : feedHalf === "END" ? "MIDDLE" : feedHalf;
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
    label: snapshotLabel(phase, status),
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
  const gameSnapshot = projectGameSnapshot(canonical);
  const coreInput = projectCoreInput(canonical);
  assertFeedProjectionAgreement(gameSnapshot, coreInput);

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
