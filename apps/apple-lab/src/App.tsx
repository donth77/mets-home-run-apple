import { useMemo, useState } from "react";
import { AppleStage } from "@apple/apple-3d";
import { Scoreboard } from "@apple/scoreboard-ui";
import { fixtureScenarios } from "@apple/test-fixtures";
import { MAX_STROKE_MM } from "@apple/protocol";
import { useFixturePlayback } from "./useFixturePlayback";

function useReducedMotion() {
  return useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
}

export function App() {
  const playback = useFixturePlayback();
  const [wireframe, setWireframe] = useState(false);
  const [dimensions, setDimensions] = useState(true);
  const [manualPosition, setManualPosition] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const positionMm = manualPosition ?? playback.activeFrame.positionMm;
  const visibleFrames = playback.scenario.frames.filter((frame) => frame.atMs <= playback.elapsedMs);
  const frameIndex = Math.max(0, playback.scenario.frames.indexOf(playback.activeFrame));
  const progress = playback.durationMs === 0 ? 0 : (playback.elapsedMs / playback.durationMs) * 100;

  function chooseScenario(id: string) {
    setManualPosition(null);
    playback.selectScenario(id, true);
  }

  return (
    <main className="lab-shell">
      <header className="lab-header">
        <div className="lab-brand">
          <span className="lab-mark">A</span>
          <div>
            <strong>APPLE LAB</strong>
            <small>Deterministic browser bench</small>
          </div>
        </div>
        <div className="lab-safety">
          <span className="status-dot" />
          RECORDING MOTION · HARDWARE DISARMED
        </div>
        <div className="lab-clock">
          <span>FAKE CLOCK</span>
          <strong>{(playback.elapsedMs / 1000).toFixed(2)} s</strong>
        </div>
      </header>

      <div className="lab-workspace">
        <aside className="lab-panel scenario-panel" aria-label="Synthetic scenarios">
          <div className="panel-heading">
            <span>INPUT FIXTURES</span>
            <strong>{fixtureScenarios.length}</strong>
          </div>
          <p className="panel-intro">Select a pre-authored trace. These controls replay commands; they do not contain home-run detection rules.</p>
          <div className="scenario-list">
            {fixtureScenarios.map((scenario) => (
              <button
                type="button"
                key={scenario.id}
                className={playback.scenarioId === scenario.id ? "scenario-button is-active" : "scenario-button"}
                onClick={() => chooseScenario(scenario.id)}
              >
                <span>{scenario.shortLabel}</span>
                <small>{scenario.description}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="lab-stage-panel" aria-label="3D motion preview">
          <div className="stage-toolbar">
            <div>
              <span>APPLE ASSEMBLY</span>
              <strong>{manualPosition === null ? "FIXTURE COMMAND" : "MANUAL OVERRIDE"}</strong>
            </div>
            <div className="view-toggles">
              <label><input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} /> Wireframe</label>
              <label><input type="checkbox" checked={dimensions} onChange={(event) => setDimensions(event.target.checked)} /> Dimensions</label>
            </div>
          </div>
          <div className="lab-stage-wrap">
            <AppleStage
              mode="lab"
              positionMm={positionMm}
              wireframe={wireframe}
              showDimensions={dimensions}
              reducedMotion={reducedMotion}
            />
            <div className="stage-badges" aria-hidden="true">
              <span>X/Y/Z ORBIT ENABLED</span>
              <span>MODEL CALIBRATION PENDING</span>
            </div>
          </div>
          <div className="motion-control">
            <div className="motion-readout">
              <span>COMMANDED POSITION</span>
              <strong>{positionMm} <small>mm</small></strong>
            </div>
            <label htmlFor="manual-position">
              Manual recording position
              <input
                id="manual-position"
                type="range"
                min="0"
                max={MAX_STROKE_MM}
                value={positionMm}
                onChange={(event) => {
                  playback.setPlaying(false);
                  setManualPosition(Number(event.target.value));
                }}
              />
            </label>
            <button type="button" className="secondary-button" disabled={manualPosition === null} onClick={() => setManualPosition(null)}>Release override</button>
          </div>
        </section>

        <aside className="lab-panel telemetry-panel" aria-label="Current telemetry">
          <Scoreboard snapshot={playback.activeFrame.snapshot} variant="lab" />
          <div className="panel-heading telemetry-title"><span>STATE SNAPSHOT</span><strong>v1</strong></div>
          <dl className="telemetry-list">
            <div><dt>Phase</dt><dd data-phase={playback.activeFrame.snapshot.phase}>{playback.activeFrame.snapshot.phase}</dd></div>
            <div><dt>Game</dt><dd>{playback.activeFrame.snapshot.gamePk} · G{playback.activeFrame.snapshot.gameNumber}</dd></div>
            <div><dt>Review</dt><dd>{playback.activeFrame.snapshot.review}</dd></div>
            <div><dt>Frame</dt><dd>{frameIndex + 1} / {playback.scenario.frames.length}</dd></div>
            <div><dt>Motion</dt><dd>{positionMm > 0 ? "EXTENDED" : "HOME"}</dd></div>
            <div><dt>Adapter</dt><dd>RECORDING</dd></div>
          </dl>
          <div className="latest-event">
            <span>LAST CONFIRMED DISPLAY EVENT</span>
            <p>{playback.activeFrame.snapshot.lastEvent}</p>
          </div>
          <div className="command-stack">
            <span>CURRENT COMMANDS</span>
            {playback.activeFrame.commands.length === 0
              ? <p className="empty-command">No command at this frame</p>
              : playback.activeFrame.commands.map((command) => <code key={`${command.eventKey}-${command.type}`}>{command.type}{command.positionMm === undefined ? "" : ` · ${command.positionMm} mm`}</code>)}
          </div>
        </aside>
      </div>

      <section className="transport-panel" aria-label="Fixture transport and trace">
        <div className="transport-controls">
          <button type="button" className="transport-primary" onClick={() => playback.setPlaying(!playback.playing)}>{playback.playing ? "Pause" : "Play"}</button>
          <button type="button" onClick={playback.step}>Step frame</button>
          <button type="button" onClick={() => { setManualPosition(null); playback.reset(); }}>Reset</button>
          <label>Speed
            <select value={playback.speed} onChange={(event) => playback.setSpeed(Number(event.target.value))}>
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
            </select>
          </label>
          <label className="timeline-control">Timeline
            <input type="range" min="0" max={Math.max(playback.durationMs, 1)} value={playback.elapsedMs} onChange={(event) => { playback.setPlaying(false); setManualPosition(null); playback.setElapsedMs(Number(event.target.value)); }} />
          </label>
          <output>{Math.round(progress)}%</output>
        </div>
        <div className="trace-console" role="log" aria-label="Deterministic event trace">
          {visibleFrames.length === 0 && <p>No frames accepted.</p>}
          {[...visibleFrames].reverse().map((frame, index) => (
            <div key={`${frame.atMs}-${frame.trace}`} className={index === 0 ? "trace-row is-current" : "trace-row"}>
              <time>+{(frame.atMs / 1000).toFixed(2)}s</time>
              <span>{frame.snapshot.phase}</span>
              <p>{frame.trace}</p>
              <code>{frame.commands.map((command) => command.type).join(" · ") || "NO_MOTION"}</code>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
