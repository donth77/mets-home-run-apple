import type { GameHalf, GamePhase, GameSnapshot, PresentationSnapshot, TeamScore } from "./game";

const MLB_TEAM_NICKNAMES: Readonly<Record<string, string>> = {
  ARI: "Diamondbacks",
  ATL: "Braves",
  ATH: "Athletics",
  BAL: "Orioles",
  BOS: "Red Sox",
  CHC: "Cubs",
  CHW: "White Sox",
  CIN: "Reds",
  CLE: "Guardians",
  COL: "Rockies",
  CWS: "White Sox",
  DET: "Tigers",
  HOU: "Astros",
  KC: "Royals",
  KCR: "Royals",
  LAA: "Angels",
  LAD: "Dodgers",
  MIA: "Marlins",
  MIL: "Brewers",
  MIN: "Twins",
  NYM: "Mets",
  NYY: "Yankees",
  OAK: "Athletics",
  PHI: "Phillies",
  PIT: "Pirates",
  SD: "Padres",
  SDP: "Padres",
  SEA: "Mariners",
  SF: "Giants",
  SFG: "Giants",
  STL: "Cardinals",
  TB: "Rays",
  TBR: "Rays",
  TEX: "Rangers",
  TOR: "Blue Jays",
  WAS: "Nationals",
  WSH: "Nationals",
};

export function mlbTeamNickname(team: Pick<TeamScore, "abbreviation" | "name">) {
  const suppliedName = team.name.trim();
  return MLB_TEAM_NICKNAMES[team.abbreviation.trim().toUpperCase()] ?? (suppliedName || team.abbreviation.trim());
}

/** Formats a player label for the compact physical screen. */
export function compactPlayerName(name: string | undefined): string | undefined {
  const parts = name?.trim().split(/\s+/u).filter(Boolean) ?? [];
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  const initial = Array.from(parts[0])[0];
  return initial ? `${initial}. ${parts.slice(1).join(" ")}` : parts.join(" ");
}

/** Formats the physical screen's batter line without optional HR suffixes. */
export function compactBatterLine(line: string | undefined): string | undefined {
  const normalized = line?.trim();
  if (!normalized) return undefined;
  const match = normalized.match(/(\d+)\D+(\d+)/u);
  return match ? `${match[1]} FOR ${match[2]}` : normalized;
}

export type InterruptionKind = "DELAY" | "RAIN_DELAY" | "SUSPENDED" | "POSTPONED" | "CANCELLED";

/**
 * Which interruption a DELAYED snapshot represents. The label comes from the
 * shared status classifier, which already folds rain, inclement weather,
 * lightning, and wet grounds into "RAIN DELAY"; suspended, postponed, and
 * cancelled games keep MLB's own wording.
 */
export function interruptionKind(snapshot: Pick<PresentationSnapshot, "label">): InterruptionKind {
  const status = snapshot.label.trim().toLowerCase();
  if (status.includes("postpon")) return "POSTPONED";
  if (status.includes("cancel")) return "CANCELLED";
  if (status.includes("suspend")) return "SUSPENDED";
  if (status === "rain delay") return "RAIN_DELAY";
  return "DELAY";
}

/** Short scorebug word for each interruption, in the space an inning number takes. */
const INTERRUPTION_INNING_LABELS: Record<InterruptionKind, string> = {
  DELAY: "DELAY",
  RAIN_DELAY: "DELAY",
  SUSPENDED: "SUSP",
  POSTPONED: "PPD",
  CANCELLED: "CANC",
};

export function inningLabel(snapshot: Pick<PresentationSnapshot, "phase" | "half" | "inning" | "label">): string {
  if (snapshot.phase === "FINAL") return "FINAL";
  if (snapshot.phase === "DELAYED") return INTERRUPTION_INNING_LABELS[interruptionKind(snapshot)];
  if (snapshot.phase === "SLEEP") return "OFF";
  const half = snapshot.half === "TOP" ? "TOP" : snapshot.half === "BOTTOM" ? "BOT" : snapshot.half;
  return `${half} ${snapshot.inning}`;
}

export interface DeviceDisplayTeam {
  abbreviation: string;
  runs: number;
}

export type DeviceDisplayKind =
  | "LIVE"
  | "UPCOMING"
  | "OFFSEASON"
  | "REVIEW"
  | "DELAY"
  | "RAIN_DELAY"
  | "SUSPENDED"
  | "POSTPONED"
  | "CANCELLED"
  | "FINAL";

export type DeviceFinalResult = "METS_WIN" | "METS_LOSS" | "TIE";

function displayKind(snapshot: GameSnapshot): DeviceDisplayKind {
  if (snapshot.phase === "LIVE") return "LIVE";
  if (snapshot.phase === "REVIEW") return "REVIEW";
  if (snapshot.phase === "FINAL") return "FINAL";
  if (snapshot.phase === "PREGAME") return "UPCOMING";
  if (snapshot.phase === "SLEEP") {
    return snapshot.label.toUpperCase().includes("OFFSEASON") ? "OFFSEASON" : "UPCOMING";
  }

  return interruptionKind(snapshot);
}

function finalResult(snapshot: GameSnapshot): DeviceFinalResult | undefined {
  if (snapshot.phase !== "FINAL") return undefined;
  const mets =
    snapshot.away.abbreviation === "NYM"
      ? snapshot.away
      : snapshot.home.abbreviation === "NYM"
        ? snapshot.home
        : undefined;
  const opponent = mets === snapshot.away ? snapshot.home : snapshot.away;
  if (!mets) return undefined;
  if (mets.runs === opponent.runs) return "TIE";
  return mets.runs > opponent.runs ? "METS_WIN" : "METS_LOSS";
}

/** Structured data for the small physical screen. Firmware owns the layout. */
export interface DeviceDisplayState {
  schemaVersion: 1;
  kind: DeviceDisplayKind;
  gamePk: number;
  gameNumber: 1 | 2;
  phase: GamePhase;
  status: string;
  lastEvent: string;
  scheduledStart?: string;
  venue?: string;
  finalResult?: DeviceFinalResult;
  away: DeviceDisplayTeam;
  home: DeviceDisplayTeam;
  inning: number;
  half: GameHalf;
  outs: 0 | 1 | 2 | 3;
  bases: {
    first: boolean;
    second: boolean;
    third: boolean;
  };
  balls?: 0 | 1 | 2 | 3;
  strikes?: 0 | 1 | 2;
  batter?: string;
  batterLine?: string;
  pitcher?: string;
  pitchCount?: number;
}

export function toDeviceDisplayState(snapshot: GameSnapshot): DeviceDisplayState {
  return {
    schemaVersion: 1,
    kind: displayKind(snapshot),
    gamePk: snapshot.gamePk,
    gameNumber: snapshot.gameNumber,
    phase: snapshot.phase,
    status: snapshot.label,
    lastEvent: snapshot.lastEvent,
    scheduledStart: snapshot.scheduledStart,
    venue: snapshot.venue,
    finalResult: finalResult(snapshot),
    away: { abbreviation: snapshot.away.abbreviation, runs: snapshot.away.runs },
    home: { abbreviation: snapshot.home.abbreviation, runs: snapshot.home.runs },
    inning: snapshot.inning,
    half: snapshot.half,
    outs: snapshot.outs,
    bases: snapshot.atBat?.bases ?? { first: false, second: false, third: false },
    balls: snapshot.atBat?.balls,
    strikes: snapshot.atBat?.strikes,
    batter: compactPlayerName(snapshot.atBat?.batter),
    batterLine: compactBatterLine(snapshot.atBat?.batterLine),
    pitcher: compactPlayerName(snapshot.atBat?.pitcher),
    pitchCount: snapshot.atBat?.pitchCount,
  };
}
