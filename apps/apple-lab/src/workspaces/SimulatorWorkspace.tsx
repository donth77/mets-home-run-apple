import { AppleTestSession } from "../AppleTestSession";
import type { AppleDeviceState } from "../useAppleDevice";
import {
  ACTUATOR_FULL_STROKE_SECONDS,
  ACTUATOR_SPEED_MM_PER_SECOND,
  AppleStage,
  HOME_RUN_RAISED_DWELL_MS,
  useActuatorSimulation,
} from "@apple/apple-3d";
import { MAX_STROKE_MM } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { fixtureScenarios } from "@apple/test-fixtures";
import { useEffect, useMemo, useState } from "react";
import { CsvExportButton, useReducedMotion, WorkspaceHeading } from "../managerComponents";
import { CustomScenarioEditor } from "../CustomScenarioEditor";
import {
  buildCustomScenario,
  CUSTOM_SCENARIO_ID,
  type CustomScenarioForm,
  loadCustomScenario,
  saveCustomScenario,
} from "../customScenario";
import { PhysicalOutputPreview } from "../PhysicalOutputPreview";
import { useFixturePlayback } from "../useFixturePlayback";

export function SimulatorWorkspace({ apple }: { apple?: AppleDeviceState }) {
  const [custom, setCustom] = useState<CustomScenarioForm>(loadCustomScenario);
  const customScenario = useMemo(() => buildCustomScenario(custom), [custom]);
  // The custom scenario leads the list so its editor never hides below the fixtures.
  const scenarios = useMemo(() => [customScenario, ...fixtureScenarios], [customScenario]);
  const playback = useFixturePlayback("home-run", scenarios);
  const editingCustom = playback.scenarioId === CUSTOM_SCENARIO_ID;
  function updateCustom(next: CustomScenarioForm) {
    setCustom(next);
    saveCustomScenario(next);
  }
  const [wireframe, setWireframe] = useState(false);
  const [dimensions, setDimensions] = useState(true);
  const [manualPosition, setManualPosition] = useState<number | null>(null);
  const [deviceRunMode, setDeviceRunMode] = useState<"LOGIC_RECORDING" | "PHYSICAL">("LOGIC_RECORDING");
  const physical = deviceRunMode === "PHYSICAL";
  // Custom scenarios only exist in this browser; the Apple runs its compiled fixtures.
  const physicalAvailable = apple?.transport === "WIFI" && apple.status?.fixture.version === 1 && !editingCustom;
  const running = apple?.status?.fixture.state === "RUNNING";
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
    celebrationFrame && playback.activeFrame.snapshot.phase === "CELEBRATION"
      ? celebrationFrame.events.find((event) => event.type === "CELEBRATION_STARTED")
      : undefined;
  const frameIndex = Math.max(0, playback.scenario.frames.indexOf(playback.activeFrame));
  const progress = playback.durationMs === 0 ? 0 : (playback.elapsedMs / playback.durationMs) * 100;
  function chooseScenario(id: string) {
    setManualPosition(null);
    playback.selectScenario(id, !physical);
  }
  // With the Physical Apple on, the browser preview follows the device's own
  // progress through the fixture instead of playing on its own clock, so the
  // Lab never shows an animation the Apple is not yet showing.
  const deviceFrame = physical && running && apple?.status ? apple.status.fixture.frame : null;
  const deviceInputs = playback.scenario.deviceFixture.frames;
  const { setPlaying: setPreviewPlaying, setElapsedMs: seekPreview } = playback;
  useEffect(() => {
    if (deviceFrame === null) return;
    const at = deviceInputs[Math.min(deviceFrame, deviceInputs.length - 1)]?.atMs ?? 0;
    setPreviewPlaying(false);
    seekPreview(at);
  }, [deviceFrame, deviceInputs, setPreviewPlaying, seekPreview]);

  return (
    <section className="workspace workspace--simulator" aria-labelledby="simulator-title">
      <WorkspaceHeading
        eyebrow="Browser simulation and device tests"
        title="Simulator"
        titleId="simulator-title"
        description="Run shared scenarios in the browser, or enable the Physical Apple to run one approved scenario through the device’s own C++ engine."
      />
      {/* The physical controls stay pinned under the heading so the switch
          and its arm/run/stop actions are always in view, whatever the
          scenario column is scrolled to. */}
      <section className="device-bar" aria-label="Physical Apple">
        <div className="device-bar__main">
          <label className="device-run-mode">
            <input
              type="checkbox"
              role="switch"
              aria-label="Physical Apple"
              aria-checked={physical}
              checked={physical}
              disabled={apple?.pending != null && (!physical || !apple.canStopTest || apple.pending === "stop")}
              onChange={(event) => {
                const enabled = event.target.checked;
                setDeviceRunMode(enabled ? "PHYSICAL" : "LOGIC_RECORDING");
                playback.reset();
                setManualPosition(null);
                playback.setSpeed(1);
                if (!enabled) {
                  apple?.disarmTest();
                  if (apple?.canStopTest) void apple.stopFixture();
                }
              }}
            />{" "}
            Physical Apple
          </label>
          <span
            className={
              physical || running || apple?.canStopTest ? "mode-pill mode-pill--live" : "mode-pill mode-pill--safe"
            }
          >
            <i />{" "}
            {apple?.pending === "stop"
              ? "Stopping physical test"
              : !physical && (running || apple?.canStopTest)
                ? "Check device test status"
                : physical
                  ? !apple || apple.connection === "DISCONNECTED"
                    ? "Physical Apple · connect over Wi-Fi first"
                    : apple.connection !== "CONNECTED"
                      ? "Physical Apple · waiting for status"
                      : apple.status && !apple.status.maintenance.supported
                        ? "Physical Apple · firmware update needed"
                        : running
                          ? "Physical test running"
                          : apple.queued
                            ? "Tap the Apple's owner button to approve"
                            : apple.canTest
                              ? "Approved · starting"
                              : "Physical Apple · ready"
                  : "Simulation only"}
          </span>
          <div className="device-bar__actions">
            <button
              type="button"
              className="device-run-button"
              disabled={
                !physical ||
                !physicalAvailable ||
                !apple ||
                apple.connection !== "CONNECTED" ||
                !apple.status?.settings.motor ||
                (!apple.queued && (!apple.idle || apple.pending !== null))
              }
              onClick={() => {
                if (apple?.queued) {
                  apple.cancelQueued();
                  return;
                }
                setManualPosition(null);
                playback.reset();
                playback.setSpeed(1);
                void apple?.runFixture(playback.scenarioId);
              }}
            >
              {apple?.queued
                ? `Waiting for the button… ${Math.max(0, Math.ceil((apple.status?.maintenance.remainingMs ?? 0) / 1000))} s · cancel`
                : "Run on the Apple"}
            </button>
            {apple?.canStopTest && (
              <button
                type="button"
                className="secondary-button"
                disabled={apple.pending === "stop"}
                onClick={() => void apple.stopFixture()}
              >
                Stop the Apple
              </button>
            )}
          </div>
        </div>
        {physical && apple && <AppleTestSession apple={apple} />}
        <p className="device-bar__note">
          {physical
            ? `Runs “${playback.scenario.title}” on the connected Apple at device timing. Preview speed, pause, and scrubbing never drive the motor; turning the switch off stops an active test.`
            : running || apple?.canStopTest
              ? "Simulation selected. Check the device test status to confirm it has stopped."
              : "Browser simulation only. Physical outputs are not activated by the Simulator."}
        </p>
        {physical && !apple && (
          <p className="device-bar__note">Connect to your Apple over Wi-Fi from the sidebar to run a scenario on it.</p>
        )}
        {physical && editingCustom && (
          <p className="device-bar__note">
            The custom scenario previews in the browser only. The Apple runs its built-in scenarios; pick one of those to run it
            on the device.
          </p>
        )}
        {physical && apple?.status?.settings.motor === false && (
          <p className="device-bar__note">Enable the motor in Apple Manager before a physical run.</p>
        )}
        {!physical && apple?.error && (
          <p className="device-bar__note" role="alert">
            {apple.error}
          </p>
        )}
        {physical && apple?.status && (
          <p className="device-bar__note">
            Reported motion: {apple.status.motionKnown ? apple.status.sequence : "UNKNOWN"} ·{" "}
            {apple.status.positionMm === null ? "position unknown" : `${apple.status.positionMm} mm estimated`}
            {apple.status.fixture.scenarioId
              ? ` · the Apple is running ${apple.status.fixture.scenarioId} · ${apple.status.fixture.state.toLowerCase()}`
              : ""}
          </p>
        )}
      </section>
      <div className="simulator-grid">
        <aside className="manager-panel scenario-panel" aria-label="Synthetic scenarios">
          <div className="panel-title">
            <div>
              <span>Test scenarios</span>
              <h2>{fixtureScenarios.length} scenarios + custom</h2>
            </div>
          </div>
          <p className="panel-intro">Replay deterministic game states without waiting for a live Mets game.</p>
          {editingCustom ? <CustomScenarioEditor form={custom} onChange={updateCustom} /> : null}
          <div className="scenario-list">
            {scenarios.map((scenario) => (
              <button
                type="button"
                key={scenario.id}
                disabled={physical && (running || apple?.pending != null)}
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
            <span>Selected scenario</span>
            <strong>{playback.scenario.title}</strong>
            <p>{playback.scenario.description}</p>
            <p className="selected-fixture__inputs">
              {playback.scenario.deviceFixture.frames.length} normalized inputs ·{" "}
              {playback.scenario.deviceFixture.expectedMotionSequences} raise / lower sequence expected
            </p>
          </div>
        </aside>
        <section className="manager-panel simulator-stage-panel" aria-label="3D motion preview">
          <div className="stage-toolbar">
            <div>
              <span>Assembly preview</span>
              <strong>{manualPosition === null ? "SCENARIO COMMAND" : "MANUAL OVERRIDE"}</strong>
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
            <Scoreboard snapshot={playback.activeFrame.snapshot} />
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
                disabled={physical}
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
      <section className="manager-panel transport-panel" aria-label="Scenario transport and trace">
        <div className="transport-controls">
          <button
            type="button"
            className="primary-button"
            disabled={physical}
            onClick={() => playback.setPlaying(!playback.playing)}
          >
            {playback.playing ? "Pause" : "Play"}
          </button>
          <button type="button" disabled={physical} onClick={playback.step}>
            Step frame
          </button>
          <button
            type="button"
            disabled={physical}
            onClick={() => {
              setManualPosition(null);
              playback.reset();
            }}
          >
            Reset
          </button>
          <label>
            Speed
            <select
              disabled={physical}
              value={playback.speed}
              onChange={(event) => playback.setSpeed(Number(event.target.value))}
            >
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
            </select>
          </label>
          <label className="timeline-control">
            Timeline
            <input
              type="range"
              disabled={physical}
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
