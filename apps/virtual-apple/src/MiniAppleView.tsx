import type { PresentationSnapshot } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SceneSoundToggle } from "./SceneSoundToggle";
import { moveSharedAppleStage } from "./SharedAppleStage";
import { VictoryConfetti } from "./VictoryConfetti";

export interface MiniAppleStatus {
  detail: string;
  label: string;
}

export function miniAppleStatus(
  snapshot: PresentationSnapshot,
  options: {
    betweenGames: boolean;
    /** The round of the game shown, such as "NLDS Game 3" or "Spring Training". */
    gameLabel?: string;
    nextGame: { day: string; time: string };
    offseason: boolean;
    standby: boolean;
  },
): MiniAppleStatus {
  if (options.standby) return { detail: "Live updates paused", label: "STANDBY" };
  if (options.offseason) return { detail: "Waiting for next season", label: "OFFSEASON" };
  const round = options.gameLabel?.toUpperCase();
  if (options.betweenGames) {
    const nextGame = [options.nextGame.day, options.nextGame.time].filter(Boolean).join(" · ");
    return { detail: nextGame || "Schedule to be announced", label: round ?? "NEXT GAME" };
  }
  const detail = snapshot.lastEvent || snapshot.label;
  if (snapshot.phase === "CELEBRATION") return { detail, label: snapshot.label };
  if (snapshot.phase === "FINAL") return { detail, label: "FINAL" };
  if (snapshot.phase === "DELAYED") return { detail, label: "DELAY" };
  if (snapshot.phase === "REVIEW") return { detail, label: "REVIEW" };
  const label = snapshot.label || snapshot.phase;
  // As on the physical Apple, the round stands in for a plain LIVE.
  return { detail, label: round && label.trim().toUpperCase() === "LIVE" ? round : label };
}

interface MiniAppleViewProps {
  betweenGames: boolean;
  confettiActive: boolean;
  container: HTMLElement;
  gameLabel?: string;
  nextGame: { day: string; time: string };
  offseason: boolean;
  onReturn: () => void;
  reducedMotion: boolean;
  showScoreboard: boolean;
  snapshot: PresentationSnapshot;
  stageHost: HTMLElement;
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
  gameLabel,
  nextGame,
  offseason,
  onReturn,
  reducedMotion,
  showScoreboard,
  snapshot,
  stageHost,
  sound,
  standby,
  weather,
}: MiniAppleViewProps) {
  const status = miniAppleStatus(snapshot, { betweenGames, gameLabel, nextGame, offseason, standby });
  const stageSlot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    moveSharedAppleStage(stageHost, stageSlot.current);
  }, [stageHost]);

  return createPortal(
    <main className="mini-apple-shell" data-phase={standby ? "STANDBY" : snapshot.phase} data-weather={weather}>
      <h1 className="visually-hidden">Mini Virtual Mets Apple</h1>
      <div className="mini-apple-stage-slot" ref={stageSlot} />
      <div className="mini-apple-bottom">
        {showScoreboard && (
          <div className="mini-apple-scoreboard">
            <Scoreboard snapshot={snapshot} announceUpdates={false} standby={standby} gameLabel={gameLabel} />
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
