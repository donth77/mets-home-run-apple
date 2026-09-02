import { useState } from "react";
import {
  ACTUATOR_FULL_STROKE_SECONDS,
  ACTUATOR_SPEED_MM_PER_SECOND,
  AppleStage,
  HOME_RUN_DISPLAY_LEAD_IN_MS,
  HOME_RUN_RAISED_DWELL_MS,
  useActuatorSimulation,
} from "@apple/apple-3d";
import { MAX_STROKE_MM } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { fixtureScenarios } from "@apple/test-fixtures";
import { CsvExportButton, useReducedMotion, WorkspaceHeading } from "../managerComponents";
import { PhysicalOutputPreview } from "../PhysicalOutputPreview";
import { useFixturePlayback } from "../useFixturePlayback";

export function SimulatorWorkspace() {
  const playback = useFixturePlayback();
  const [wireframe, setWireframe] = useState(false);
  const [dimensions, setDimensions] = useState(true);
  const [manualPosition, setManualPosition] = useState<number | null>(null);
  const [deviceRunMode, setDeviceRunMode] = useState<"LOGIC_RECORDING" | "PHYSICAL">("LOGIC_RECORDING");
  const reducedMotion = useReducedMotion();
  const commandedPositionMm = manualPosition ?? playback.activeFrame.positionMm;
  const actuator = useActuatorSimulation(commandedPositionMm, {
    reducedMotion,
    speedMmPerSecond: ACTUATOR_SPEED_MM_PER_SECOND * (manualPosition === null ? playback.speed : 1),
  });
  const visibleFrames = playback.scenario.frames.filter((frame) => frame.atMs <= playback.elapsedMs);
  const celebrationFrame = [...visibleFrames]
    .reverse()
    .find((frame) => frame.events.some((event) => event.type === "CELEBRATION_STARTED"));
  const celebrationElapsedMs = celebrationFrame ? playback.elapsedMs - celebrationFrame.atMs : 0;
  const celebration =
    celebrationFrame &&
    playback.activeFrame.snapshot.phase === "CELEBRATION" &&
    celebrationElapsedMs < HOME_RUN_DISPLAY_LEAD_IN_MS + HOME_RUN_RAISED_DWELL_MS
      ? celebrationFrame.events.find((event) => event.type === "CELEBRATION_STARTED")
      : undefined;
  const frameIndex = Math.max(0, playback.scenario.frames.indexOf(playback.activeFrame));
  const progress = playback.durationMs === 0 ? 0 : (playback.elapsedMs / playback.durationMs) * 100;
  function chooseScenario(id: string) {
    setManualPosition(null);
    playback.selectScenario(id, true);
  }

  return (
    <section className="workspace workspace--simulator" aria-labelledby="simulator-title">
      <WorkspaceHeading
        eyebrow="Offline engineering surface"
        title="Simulator"
        titleId="simulator-title"
        description="Replay normalized fixtures against a recording-only motion adapter. This workspace cannot reach physical GPIO or issue a live-device command."
      >
        <span className="mode-pill mode-pill--safe">
          <i /> Hardware disarmed
        </span>
      </WorkspaceHeading>
      <div className="simulator-grid">
        <aside className="manager-panel scenario-panel" aria-label="Synthetic scenarios">
          <div className="panel-title">
            <div>
              <span>Test scenarios</span>
              <h2>{fixtureScenarios.length} fixtures</h2>
            </div>
          </div>
          <p className="panel-intro">Replay deterministic game states without waiting for a live Mets game.</p>
          <div className="scenario-list">
            {fixtureScenarios.map((scenario) => (
              <button
                type="button"
                key={scenario.id}
                className={playback.scenarioId === scenario.id ? "scenario-button is-active" : "scenario-button"}
                aria-pressed={playback.scenarioId === scenario.id}
                onClick={() => chooseScenario(scenario.id)}
              >
                <span>
                  <strong>{scenario.shortLabel}</strong>
                  <small>{scenario.title}</small>
                </span>
                <i aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="selected-fixture">
            <span>Selected fixture</span>
            <strong>{playback.scenario.title}</strong>
            <p>{playback.scenario.description}</p>
          </div>
          <div className="device-fixture-card">
            <div>
              <span>On-device fixture</span>
              <strong>Nano not connected</strong>
            </div>
            <p>
              {playback.scenario.deviceFixture.frames.length} normalized input
              {playback.scenario.deviceFixture.frames.length === 1 ? "" : "s"} ·{" "}
              {playback.scenario.deviceFixture.expectedMotionSequences === 0
                ? "no motion expected"
                : `${playback.scenario.deviceFixture.expectedMotionSequences} raise / lower sequence expected`}
            </p>
            <fieldset className="device-run-mode">
              <legend className="visually-hidden">Device fixture run mode</legend>
              <button
                type="button"
                className={deviceRunMode === "LOGIC_RECORDING" ? "is-active" : ""}
                aria-pressed={deviceRunMode === "LOGIC_RECORDING"}
                onClick={() => setDeviceRunMode("LOGIC_RECORDING")}
              >
                Logic recording
              </button>
              <button
                type="button"
                className={deviceRunMode === "PHYSICAL" ? "is-active" : ""}
                aria-pressed={deviceRunMode === "PHYSICAL"}
                onClick={() => setDeviceRunMode("PHYSICAL")}
              >
                Physical cycle
              </button>
            </fieldset>
            <button type="button" className="device-run-button" disabled aria-describedby="device-run-unavailable">
              Run on device
            </button>
            <small id="device-run-unavailable">
              Available after an authenticated Nano fixture transport is connected. Physical mode will additionally
              require home position, suspended live automation, and an expiring maintenance lease.
            </small>
          </div>
        </aside>
        <section className="manager-panel simulator-stage-panel" aria-label="3D motion preview">
          <div className="stage-toolbar">
            <div>
              <span>Assembly preview</span>
              <strong>{manualPosition === null ? "FIXTURE COMMAND" : "MANUAL OVERRIDE"}</strong>
            </div>
            <div className="view-toggles">
              <label>
                <input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} />{" "}
                Wireframe
              </label>
              <label>
                <input type="checkbox" checked={dimensions} onChange={(event) => setDimensions(event.target.checked)} />{" "}
                Dimensions
              </label>
            </div>
          </div>
          <div className="stage-game-strip">
            <Scoreboard snapshot={playback.activeFrame.snapshot} variant="lab" />
            <div className="game-context">
              <span>Current display event</span>
              <strong>{playback.activeFrame.snapshot.lastEvent}</strong>
              <small>
                Frame {frameIndex + 1} of {playback.scenario.frames.length} · game{" "}
                {playback.activeFrame.snapshot.gamePk}
              </small>
            </div>
          </div>
          <div className="lab-stage-wrap">
            <AppleStage mode="lab" positionMm={actuator.positionMm} wireframe={wireframe} showDimensions={dimensions} />
            <div className="stage-badges" aria-hidden="true">
              <span>Drag to orbit · scroll to zoom</span>
              <span>
                {ACTUATOR_SPEED_MM_PER_SECOND.toFixed(2)} mm/s measured · {ACTUATOR_FULL_STROKE_SECONDS.toFixed(2)} s
                stroke
              </span>
              <span>{HOME_RUN_RAISED_DWELL_MS / 1000} s raised</span>
            </div>
          </div>
          <PhysicalOutputPreview
            snapshot={playback.activeFrame.snapshot}
            celebration={celebration}
            celebrationElapsedMs={celebrationElapsedMs}
            elapsedMs={playback.elapsedMs}
            motionState={actuator.state}
          />
          <div className="motion-control">
            <div className="motion-readout">
              <span>Simulated position</span>
              <strong>
                {actuator.positionMm.toFixed(1)} <small>mm</small>
              </strong>
              <small>Target {commandedPositionMm.toFixed(0)} mm</small>
            </div>
            <label htmlFor="manual-position">
              Manual position override
              <input
                id="manual-position"
                type="range"
                min="0"
                max={MAX_STROKE_MM}
                value={commandedPositionMm}
                onChange={(event) => {
                  playback.setPlaying(false);
                  setManualPosition(Number(event.target.value));
                }}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={manualPosition === null}
              onClick={() => setManualPosition(null)}
            >
              Release override
            </button>
          </div>
        </section>
        <aside className="manager-panel telemetry-panel" aria-label="Current simulated telemetry">
          <div className="panel-title">
            <div>
              <span>State inspector</span>
              <h2>Schema v1</h2>
            </div>
          </div>
          <div className="position-card">
            <span>Simulated actuator</span>
            <strong>
              {actuator.positionMm.toFixed(1)}
              <small> mm</small>
            </strong>
            <p>
              {actuator.state === "HOME"
                ? "Retracted limit reached; the logo is hidden."
                : actuator.state === "RAISED"
                  ? "Extended limit reached; the full logo is visible."
                  : `Actuator is ${actuator.state.toLowerCase()} at its rated speed.`}
            </p>
          </div>
          <dl className="telemetry-list">
            <div>
              <dt>Phase</dt>
              <dd data-phase={playback.activeFrame.snapshot.phase}>{playback.activeFrame.snapshot.phase}</dd>
            </div>
            <div>
              <dt>Game</dt>
              <dd>
                {playback.activeFrame.snapshot.gamePk} · G{playback.activeFrame.snapshot.gameNumber}
              </dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>{playback.activeFrame.snapshot.review}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>
                {frameIndex + 1} / {playback.scenario.frames.length}
              </dd>
            </div>
            <div>
              <dt>Motion</dt>
              <dd>{actuator.state}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{commandedPositionMm.toFixed(0)} mm</dd>
            </div>
            <div>
              <dt>Adapter</dt>
              <dd>RECORDING</dd>
            </div>
          </dl>
          <div className="command-stack">
            <span>Events in frame</span>
            {playback.activeFrame.events.length === 0 ? (
              <p className="empty-state">No event at this frame</p>
            ) : (
              playback.activeFrame.events.map((event) => (
                <code key={`${event.eventKey}-${event.type}`}>
                  {event.type} · {event.celebration} · {event.subject}
                </code>
              ))
            )}
            <span>Commands in frame</span>
            {playback.activeFrame.commands.length === 0 ? (
              <p className="empty-state">No command at this frame</p>
            ) : (
              playback.activeFrame.commands.map((command) => (
                <code key={`${command.eventKey}-${command.type}`}>
                  {command.type}
                  {command.positionMm === undefined ? "" : ` · ${command.positionMm} mm`}
                </code>
              ))
            )}
          </div>
        </aside>
      </div>
      <section className="manager-panel transport-panel" aria-label="Fixture transport and trace">
        <div className="transport-controls">
          <button type="button" className="primary-button" onClick={() => playback.setPlaying(!playback.playing)}>
            {playback.playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={playback.step}>
            Step frame
          </button>
          <button
            type="button"
            onClick={() => {
              setManualPosition(null);
              playback.reset();
            }}
          >
            Reset
          </button>
          <label>
            Speed
            <select value={playback.speed} onChange={(event) => playback.setSpeed(Number(event.target.value))}>
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
            </select>
          </label>
          <label className="timeline-control">
            Timeline
            <input
              type="range"
              min="0"
              max={Math.max(playback.durationMs, 1)}
              value={playback.elapsedMs}
              onChange={(event) => {
                playback.setPlaying(false);
                setManualPosition(null);
                playback.setElapsedMs(Number(event.target.value));
              }}
            />
          </label>
          <output>{Math.round(progress)}%</output>
        </div>
        <div className="trace-data-toolbar">
          <div>
            <span>Deterministic event trace</span>
            <small>
              {visibleFrames.length} visible row{visibleFrames.length === 1 ? "" : "s"}
            </small>
          </div>
          <CsvExportButton
            rows={visibleFrames}
            columns={[
              { header: "Elapsed (ms)", value: (frame) => frame.atMs },
              { header: "Phase", value: (frame) => frame.snapshot.phase },
              { header: "Trace", value: (frame) => frame.trace },
              {
                header: "Events",
                value: (frame) => frame.events.map((event) => event.celebration).join(" | ") || "NO_EVENT",
              },
              {
                header: "Commands",
                value: (frame) => frame.commands.map((command) => command.type).join(" | ") || "NO_MOTION",
              },
              { header: "Position (mm)", value: (frame) => frame.positionMm },
              { header: "Game PK", value: (frame) => frame.snapshot.gamePk },
              { header: "Game number", value: (frame) => frame.snapshot.gameNumber },
              { header: "Last event", value: (frame) => frame.snapshot.lastEvent },
            ]}
            fileName={`apple-lab-simulator-trace-${playback.scenario.id}`}
            label="Export trace CSV"
          />
        </div>
        <div className="trace-console" role="log" aria-label="Deterministic event trace">
          {[...visibleFrames].reverse().map((frame, index) => (
            <div key={`${frame.atMs}-${frame.trace}`} className={index === 0 ? "trace-row is-current" : "trace-row"}>
              <time>+{(frame.atMs / 1000).toFixed(2)}s</time>
              <span>{frame.snapshot.phase}</span>
              <p>{frame.trace}</p>
              <code>
                {[
                  ...frame.events.map((event) => event.celebration),
                  ...frame.commands.map((command) => command.type),
                ].join(" · ") || "NO_EVENT_OR_MOTION"}
              </code>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
