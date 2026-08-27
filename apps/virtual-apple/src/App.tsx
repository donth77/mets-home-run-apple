import { useMemo } from "react";
import { AppleStage } from "@apple/apple-3d";
import { Scoreboard } from "@apple/scoreboard-ui";
import { useFixturePlayback } from "./useFixturePlayback";

const modes = [
  { id: "live", label: "Live inning" },
  { id: "home-run", label: "Home run" },
  { id: "review-confirmed", label: "Review" },
  { id: "rain-delay", label: "Delay" },
  { id: "mets-win", label: "Mets win" },
  { id: "sleep", label: "Between games" },
];

function useReducedMotion() {
  return useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
}

export function App() {
  const playback = useFixturePlayback();
  const reducedMotion = useReducedMotion();
  const snapshot = playback.activeFrame.snapshot;
  const celebration = snapshot.phase === "CELEBRATION";
  const progress = playback.durationMs === 0 ? 0 : Math.min(100, (playback.elapsedMs / playback.durationMs) * 100);

  return (
    <main className="virtual-shell" data-phase={snapshot.phase}>
      <AppleStage
        mode="outfield"
        positionMm={playback.activeFrame.positionMm}
        celebration={celebration}
        reducedMotion={reducedMotion}
      />

      <header className="virtual-header">
        <div className="virtual-brand">
          <span className="brand-apple">●</span>
          <div>
            <strong>VIRTUAL APPLE</strong>
            <small>Center field · Flushing, NY</small>
          </div>
        </div>
        <div className="feed-status"><i /> DEMO FIXTURE</div>
      </header>

      <div className="virtual-scoreboard">
        <Scoreboard snapshot={snapshot} />
      </div>

      <section className="moment-card" aria-live="polite">
        <span>{snapshot.phase === "SLEEP" ? "NEXT UP" : snapshot.phase}</span>
        <h1>{snapshot.label}</h1>
        <p>{snapshot.lastEvent}</p>
      </section>

      <nav className="virtual-controls" aria-label="Virtual Apple demo scenes">
        <div className="mode-list">
          {modes.map((mode) => (
            <button
              type="button"
              key={mode.id}
              className={playback.scenarioId === mode.id ? "is-active" : ""}
              aria-pressed={playback.scenarioId === mode.id}
              onClick={() => playback.play(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <button type="button" className="celebrate-button" onClick={() => playback.play("home-run")}>Raise the Apple</button>
        <div className="playback-progress" aria-label={`${Math.round(progress)} percent through demo`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </nav>

      <div className="virtual-caption">
        <span>408</span>
        <p>Fixture-driven preview. No live MLB data is requested in this build.</p>
      </div>
    </main>
  );
}
