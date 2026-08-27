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

export function inningLabel(snapshot: Pick<PresentationSnapshot, "phase" | "half" | "inning">): string {
  if (snapshot.phase === "FINAL") return "FINAL";
  if (snapshot.phase === "DELAYED") return "DELAY";
  if (snapshot.phase === "SLEEP") return "OFF";
  const half = snapshot.half === "TOP" ? "TOP" : snapshot.half === "BOTTOM" ? "BOT" : snapshot.half;
  return `${half} ${snapshot.inning}`;
}

export interface DeviceDisplayTeam {
  abbreviation: string;
  runs: number;
}

/** Structured data for the small physical screen. Firmware owns the layout. */
export interface DeviceDisplayState {
  schemaVersion: 1;
  gamePk: number;
  gameNumber: 1 | 2;
  phase: GamePhase;
  status: string;
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
  pitcher?: string;
  pitchCount?: number;
}

export function toDeviceDisplayState(snapshot: GameSnapshot): DeviceDisplayState {
  return {
    schemaVersion: 1,
    gamePk: snapshot.gamePk,
    gameNumber: snapshot.gameNumber,
    phase: snapshot.phase,
    status: snapshot.label,
    away: { abbreviation: snapshot.away.abbreviation, runs: snapshot.away.runs },
    home: { abbreviation: snapshot.home.abbreviation, runs: snapshot.home.runs },
    inning: snapshot.inning,
    half: snapshot.half,
    outs: snapshot.outs,
    bases: snapshot.atBat?.bases ?? { first: false, second: false, third: false },
    balls: snapshot.atBat?.balls,
    strikes: snapshot.atBat?.strikes,
    batter: snapshot.atBat?.batter,
    pitcher: snapshot.atBat?.pitcher,
    pitchCount: snapshot.atBat?.pitchCount,
  };
}
