import { AppleStage, type StadiumScoreboardData } from "@apple/apple-3d";
import type { PresentationSnapshot } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { createPortal } from "react-dom";
import { SceneSoundToggle } from "./SceneSoundToggle";
import { VictoryConfetti } from "./VictoryConfetti";

export interface MiniAppleStatus {
  detail: string;
  label: string;
}

export function miniAppleStatus(
  snapshot: PresentationSnapshot,
  options: {
    betweenGames: boolean;
    nextGame: { day: string; time: string };
    offseason: boolean;
    standby: boolean;
  },
): MiniAppleStatus {
  if (options.standby) return { detail: "Live updates paused", label: "STANDBY" };
  if (options.offseason) return { detail: "Waiting for next season", label: "OFFSEASON" };
  if (options.betweenGames) {
    const nextGame = [options.nextGame.day, options.nextGame.time].filter(Boolean).join(" · ");
    return { detail: nextGame || "Schedule to be announced", label: "NEXT GAME" };
  }
  const detail = snapshot.lastEvent || snapshot.label;
  if (snapshot.phase === "CELEBRATION") return { detail, label: snapshot.label };
  if (snapshot.phase === "FINAL") return { detail, label: "FINAL" };
  if (snapshot.phase === "DELAYED") return { detail, label: "DELAY" };
  if (snapshot.phase === "REVIEW") return { detail, label: "REVIEW" };
  return { detail, label: snapshot.label || snapshot.phase };
}

interface MiniAppleViewProps {
  betweenGames: boolean;
  confettiActive: boolean;
  container: HTMLElement;
  nextGame: { day: string; time: string };
  offseason: boolean;
  onReturn: () => void;
  positionMm: number;
  reducedMotion: boolean;
  scoreboardData: StadiumScoreboardData;
  showScoreboard: boolean;
  snapshot: PresentationSnapshot;
  sound: {
    enabled: boolean;
    error: string;
    onToggle: () => Promise<unknown>;
    supported: boolean;
  };
  standby: boolean;
  weather: "CLEAR" | "RAIN";
}

export function MiniAppleView({
  betweenGames,
  confettiActive,
  container,
  nextGame,
  offseason,
  onReturn,
  positionMm,
  reducedMotion,
  scoreboardData,
  showScoreboard,
  snapshot,
  sound,
  standby,
  weather,
}: MiniAppleViewProps) {
  const status = miniAppleStatus(snapshot, { betweenGames, nextGame, offseason, standby });

  return createPortal(
    <main className="mini-apple-shell" data-phase={standby ? "STANDBY" : snapshot.phase} data-weather={weather}>
      <h1 className="visually-hidden">Mini Virtual Mets Apple</h1>
      <AppleStage
        className="mini-apple-stage"
        framing="mini"
        mode="outfield"
        positionMm={positionMm}
        reducedMotion={reducedMotion}
        scoreboardData={scoreboardData}
        weather={weather}
      />
      <div className="mini-apple-bottom">
        {showScoreboard && (
          <div className="mini-apple-scoreboard">
            <Scoreboard snapshot={snapshot} announceUpdates={false} standby={standby} />
          </div>
        )}
        <footer className="mini-apple-footer">
          <div className="mini-apple-status" role="status" aria-live="polite" aria-atomic="true">
            <span>{status.label}</span>
            <strong>{status.detail}</strong>
          </div>
          <SceneSoundToggle compact {...sound} />
          <button type="button" className="mini-apple-return" onClick={onReturn}>
            Return
          </button>
        </footer>
      </div>
      <VictoryConfetti active={confettiActive} reducedMotion={reducedMotion} />
    </main>,
    container,
  );
}
