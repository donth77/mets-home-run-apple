export interface AppleAssemblyProps {
  positionMm: number;
  wireframe?: boolean;
  reducedMotion?: boolean;
  showDimensions?: boolean;
  sceneScale?: number;
}

export interface AppleStageProps extends AppleAssemblyProps {
  mode: "lab" | "outfield";
  weather?: "CLEAR" | "RAIN";
  scoreboardData?: StadiumScoreboardData;
  className?: string;
  onReadyChange?: (ready: boolean) => void;
}

export interface StadiumScoreboardTeam {
  id?: number;
  abbreviation: string;
  name: string;
  runs: number;
}

export interface StadiumScoreboardData {
  away: StadiumScoreboardTeam;
  home: StadiumScoreboardTeam;
  atCitiField?: boolean;
  standby?: boolean;
  phase?: "PREGAME" | "LIVE" | "REVIEW" | "DELAYED" | "CELEBRATION" | "FINAL" | "SLEEP";
  inning: number;
  half: "TOP" | "BOTTOM" | "MIDDLE" | "END";
  outs: number;
  label: string;
  lastEvent: string;
  batter?: string;
  batterLine?: string;
  pitcher?: string;
  pitchCount?: number;
  nextGame?: {
    day: string;
    time: string;
  };
  linescore?: {
    innings: readonly { inning: number; away: number | null; home: number | null }[];
    awayHits?: number;
    homeHits?: number;
    awayErrors?: number;
    homeErrors?: number;
  };
}
