export interface AppleAssemblyProps {
  positionMm: number;
  wireframe?: boolean;
  reducedMotion?: boolean;
  showDimensions?: boolean;
  sceneScale?: number;
  restingOffsetY?: number;
}

/** A window whose animation frames can draw the scene. */
export type SceneAnimationWindow = Pick<Window, "cancelAnimationFrame" | "requestAnimationFrame">;

export interface AppleStageProps extends Omit<AppleAssemblyProps, "restingOffsetY"> {
  mode: "lab" | "outfield";
  framing?: "default" | "mini";
  weather?: "CLEAR" | "RAIN";
  scoreboardData?: StadiumScoreboardData;
  className?: string;
  onReadyChange?: (ready: boolean) => void;
  /**
   * Draw on this window's animation frames instead of the page's. The Mini
   * Apple passes its own window, which keeps painting while the page that owns
   * the scene sits in a background tab.
   */
  animationWindow?: SceneAnimationWindow;
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
