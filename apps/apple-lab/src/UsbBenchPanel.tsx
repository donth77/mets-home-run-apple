import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CsvExportButton, HealthItem } from "./managerComponents";
import type { UsbBenchDevice } from "./useUsbBenchDevice";

const CHECKLIST_STORAGE_KEY = "apple-lab.commissioning.v1";

const checklistItems = [
  { id: "nano", label: "Nano detected", detail: "USB serial identity received" },
  { id: "display", label: "Display steady", detail: "Waveshare backlight and frame verified" },
  { id: "logic-power", label: "L298N logic power", detail: "Nano, display, and driver LEDs remain steady" },
  { id: "logic-signals", label: "Motor signals", detail: "Stop, raise, lower, and auto-stop verified" },
  { id: "power-harness", label: "12 V harness", detail: "Fuse, polarity, and voltage validation pending" },
  { id: "actuator", label: "Actuator jog", detail: "Unloaded short-jog test pending" },
  { id: "motion", label: "Motion sequence", detail: "Engine-driven raise, dwell, and lower pending" },
  { id: "audio", label: "Audio and SD", detail: "Amplifier, speaker, and track playback pending" },
  { id: "lights", label: "Celebration lights", detail: "LED current and patterns pending" },
] as const;

type ChecklistId = (typeof checklistItems)[number]["id"];
type ChecklistState = Partial<Record<ChecklistId, boolean>>;
type SessionKind = "logic" | "jog" | "motion" | "audio";

/** Physical conditions the operator attests to before a session can arm. */
const confirmationLabels: Record<"logic" | "powered" | "audio", { power: string; actuator: string; outputs: string }> =
  {
    logic: {
      power: "12 V disconnected",
      actuator: "Actuator disconnected",
      outputs: "OUT1 and OUT2 empty",
    },
    powered: {
      power: "12 V supply fused and switched",
      actuator: "Actuator unloaded, secured, and attended",
      outputs: "Travel path clear of hands, wires, and tools",
    },
    audio: {
      power: "12 V supply unplugged",
      actuator: "Motor pins low on the Nano display",
      outputs: "Speaker wired across the amplifier output only",
    },
  };

function formatBytes(bytes: number) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function loadChecklist(): ChecklistState {
  try {
    const stored = window.localStorage.getItem(CHECKLIST_STORAGE_KEY);
    if (!stored) return {};
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      checklistItems.map((item) => [item.id, (value as Record<string, unknown>)[item.id] === true]),
    );
  } catch {
    return {};
  }
}

function saveChecklist(value: ChecklistState) {
  try {
    window.localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The checklist is a convenience only; private browsing may reject storage.
  }
}

function sessionKindFor(profile: UsbBenchDevice["profile"]): SessionKind {
  if (profile === "audio_test") return "audio";
  if (profile === "motion_commissioning") return "motion";
  if (profile === "actuator_jog_test" || profile === "l298n_output_meter_test") return "jog";
  return "logic";
}

function jogPins(motion: "STOP" | "EXTEND" | "RETRACT" | undefined) {
  if (motion === "EXTEND") return { ena: 1, in1: 1, in2: 0 };
  if (motion === "RETRACT") return { ena: 1, in1: 0, in2: 1 };
  return motion ? { ena: 0, in1: 0, in2: 0 } : undefined;
}

export function UsbBenchPanel({
  bench,
  armed,
  onArm,
  onDisarm,
  onTestRecorded,
}: {
  bench: UsbBenchDevice;
  armed: boolean;
  onArm: () => void;
  onDisarm: () => void;
  onTestRecorded: (title: string) => void;
}) {
  const [confirmations, setConfirmations] = useState({ power: false, actuator: false, outputs: false });
  const [checklist, setChecklist] = useState<ChecklistState>(loadChecklist);
  const [actionError, setActionError] = useState<string>();
  const recordedReceiptRef = useRef<string | undefined>(undefined);
  const connected = bench.connection === "CONNECTED";
  const recognized = connected && bench.profile !== undefined;
  const kind = sessionKindFor(bench.profile);
  const powered = kind === "jog" || kind === "motion";
  const labels = confirmationLabels[kind === "audio" ? "audio" : powered ? "powered" : "logic"];
  const confirmed = confirmations.power && confirmations.actuator && confirmations.outputs;
  const testRunning = bench.testReceipt?.status === "STARTED";
  const jogMoving = bench.jogStatus !== undefined && bench.jogStatus.motion !== "STOP";
  const motionBusy =
    bench.motionState !== undefined && (bench.motionState.sequence !== "IDLE" || bench.motionState.fault);
  const idle =
    kind === "logic"
      ? bench.driverState?.state === "STOP"
      : kind === "jog"
        ? bench.jogStatus?.motion === "STOP"
        : kind === "audio"
          ? bench.audioState !== undefined
          : bench.motionState?.sequence === "IDLE" && !bench.motionState.fault;
  const canArm = recognized && confirmed && idle;
  const audioReady = armed && recognized && kind === "audio";

  useEffect(() => {
    if (connected) return;
    setConfirmations({ power: false, actuator: false, outputs: false });
    onDisarm();
  }, [connected, onDisarm]);

  const tick = useCallback((id: ChecklistId) => {
    setChecklist((current) => {
      const next = { ...current, [id]: true };
      saveChecklist(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!recognized) return;
    tick("nano");
  }, [recognized, tick]);

  useEffect(() => {
    if (bench.testReceipt?.status !== "PASSED") return;
    const receiptKey = `logic:${bench.testReceipt.logId}`;
    if (recordedReceiptRef.current === receiptKey) return;
    recordedReceiptRef.current = receiptKey;
    tick("logic-signals");
    onTestRecorded("Motor logic self-test passed");
  }, [bench.testReceipt, onTestRecorded, tick]);

  useEffect(() => {
    const receipt = bench.jogReceipt;
    if (!receipt) return;
    const receiptKey = `jog:${receipt.logId}`;
    if (recordedReceiptRef.current === receiptKey) return;
    recordedReceiptRef.current = receiptKey;
    if (receipt.receipt === "AUTO_STOP") {
      tick("actuator");
      onTestRecorded(
        `Actuator jog auto-stopped after ${bench.jogHello?.maxJogMs ?? bench.jogStatus?.maxJogMs ?? "?"} ms`,
      );
    } else if (receipt.receipt === "REJECTED") {
      setActionError(`The Nano rejected the jog: ${receipt.reason ?? "no reason given"}.`);
    }
  }, [bench.jogHello, bench.jogReceipt, bench.jogStatus, onTestRecorded, tick]);

  useEffect(() => {
    const run = bench.motionRun;
    if (!run) return;
    const receiptKey = `motion:${run.logId}`;
    if (recordedReceiptRef.current === receiptKey) return;
    recordedReceiptRef.current = receiptKey;
    if (run.status === "COMPLETED") {
      tick("motion");
      onTestRecorded("Motion sequence completed: raise, dwell, lower, home");
    } else if (run.status === "FAULTED") {
      onTestRecorded("Motion sequence faulted; bridge disabled");
      setActionError("The engine latched a fault and the bridge is off. Force outputs low resets it.");
    } else if (run.status === "STOPPED") {
      onTestRecorded("Motion sequence stopped by the operator");
    }
  }, [bench.motionRun, onTestRecorded, tick]);

  useEffect(() => {
    const play = bench.audioPlay;
    if (!play) return;
    const receiptKey = `audio-play:${play.logId}`;
    if (recordedReceiptRef.current === receiptKey) return;
    recordedReceiptRef.current = receiptKey;
    if (play.status === "STARTED" && play.source.startsWith("SD")) {
      tick("audio");
      onTestRecorded("Card fixture played through the amplifier");
    } else if (play.status === "FAILED") {
      setActionError(`The Nano could not start playback: ${play.source}.`);
    }
  }, [bench.audioPlay, onTestRecorded, tick]);

  useEffect(() => {
    const test = bench.audioTest;
    if (!test) return;
    const receiptKey = `audio-test:${test.logId}`;
    if (recordedReceiptRef.current === receiptKey) return;
    recordedReceiptRef.current = receiptKey;
    const passes = test.passes ?? 0;
    const total = passes + (test.fails ?? 0);
    if (test.status === "PASSED") {
      onTestRecorded(`Display and SD bus alternation passed ${passes}/${total}`);
    } else if (test.status === "FAILED") {
      setActionError(`Display and SD bus alternation failed: ${test.fails ?? "?"} of ${total} reads differed.`);
    } else {
      setActionError(
        test.status === "NO_CARD"
          ? "The alternation test needs a mounted card. Mount the card first."
          : "The alternation test needs the fixture on the card. Copy tone.wav to the card root.",
      );
    }
  }, [bench.audioTest, onTestRecorded]);

  async function runAction(action: () => Promise<void>) {
    setActionError(undefined);
    try {
      await action();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The USB command failed.");
    }
  }

  function updateChecklist(id: ChecklistId, checked: boolean) {
    setChecklist((current) => {
      const next = { ...current, [id]: checked };
      saveChecklist(next);
      return next;
    });
  }

  const connectionLabel = useMemo(() => {
    if (bench.connection === "CONNECTED") return recognized ? "Nano recognized" : "Serial connected";
    if (bench.connection === "CONNECTING") return "Waiting for device";
    if (bench.connection === "UNSUPPORTED") return "Browser unsupported";
    if (bench.connection === "ERROR") return "Connection error";
    return "Nano disconnected";
  }, [bench.connection, recognized]);

  const firmwareVersion =
    bench.hello?.firmwareVersion ??
    bench.jogHello?.firmwareVersion ??
    bench.motionHello?.firmwareVersion ??
    bench.audioHello?.firmwareVersion;
  const jogWindowMs = bench.jogHello?.maxJogMs ?? bench.jogStatus?.maxJogMs;

  const safety = (() => {
    if (kind === "jog" && bench.jogHello) {
      return { value: "POWERED_JOG", detail: `${jogWindowMs} ms window, one jog per arm` };
    }
    if (kind === "audio" && bench.audioHello) {
      return {
        value: "AUDIO_NO_MOTION",
        detail: `Gain cap ${bench.audioHello.gainCapPercent} %, 12 V unplugged`,
      };
    }
    if (kind === "motion" && bench.motionHello) {
      return {
        value: "POWERED_SEQUENCE",
        detail: `${bench.motionHello.deadlineMs} ms deadline, ${bench.motionHello.dwellMs} ms dwell`,
      };
    }
    if (bench.hello) return { value: bench.hello.safetyMode, detail: `Protocol v${bench.hello.protocolVersion}` };
    return { value: "Unavailable", detail: "No powered test authorized" };
  })();

  const intent = (() => {
    if (kind === "jog") return bench.jogStatus?.motion;
    if (kind === "motion" && bench.motionState) return `${bench.motionState.sequence} · ${bench.motionState.drive}`;
    if (kind === "audio" && bench.audioState) {
      return bench.audioState.playing
        ? `${bench.audioState.status} · ${bench.audioState.playing}`
        : bench.audioState.status;
    }
    return bench.driverState?.state;
  })();

  const receipt = (() => {
    if (kind === "audio") {
      const value = bench.audioPlay;
      return {
        label: "Last playback",
        value: value ? `${value.status} · ${value.source}` : "Not played",
        detail: "Tone or card fixture through the I2S amplifier",
        good: value?.status === "STARTED",
      };
    }
    if (kind === "jog") {
      const value = bench.jogReceipt;
      return {
        label: "Last jog receipt",
        value: value ? (value.reason ? `${value.receipt} (${value.reason})` : value.receipt) : "None",
        detail: "Armed, auto-stop, and rejection receipts from the Nano",
        good: value?.receipt === "AUTO_STOP",
      };
    }
    if (kind === "motion") {
      return {
        label: "Last run",
        value: bench.motionRun?.status ?? "Not run",
        detail: "Lead-in, extend, raised dwell, retract, home",
        good: bench.motionRun?.status === "COMPLETED",
      };
    }
    return {
      label: "Logic self-test",
      value: bench.testReceipt?.status ?? "Not run",
      detail: "Bounded raise / stop / lower / stop pattern",
      good: bench.testReceipt?.status === "PASSED",
    };
  })();

  const pins =
    kind === "jog"
      ? jogPins(bench.jogStatus?.motion)
      : kind === "motion"
        ? bench.motionState
        : kind === "audio"
          ? undefined
          : bench.driverState;

  const description = (() => {
    if (kind === "audio") {
      return "This profile proves the microSD card on the shared SPI bus and the I2S amplifier. The firmware holds every motor pin low for the whole session; keep the 12 V supply unplugged.";
    }
    if (kind === "jog") {
      return `This profile drives one bounded ${jogWindowMs ?? "?"} ms jog per arm and disarms itself afterward. It needs the fused 12 V supply and an unloaded, attended actuator.`;
    }
    if (kind === "motion") {
      return "This profile runs the real celebration engine: lead-in, extend, raised dwell, retract. Every direction has a deadline and a miss latches a fault with the bridge off.";
    }
    return "This profile exercises the L298N logic inputs only. It is not an actuator-control interface and must never be used with motor power connected.";
  })();

  return (
    <>
      <section className="manager-panel usb-bench-panel" aria-labelledby="usb-bench-title">
        <header className="panel-title usb-bench-heading">
          <div>
            <span>Physical USB session</span>
            <h2 id="usb-bench-title">Nano ESP32 bench connection</h2>
          </div>
          <div className="usb-bench-connection-actions">
            <span className={connected ? "state-badge state-badge--safe" : "read-only-badge"}>{connectionLabel}</span>
            {connected ? (
              <button type="button" className="secondary-button" onClick={() => void bench.disconnect()}>
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={!bench.supported || bench.connection === "CONNECTING"}
                onClick={() => void bench.connect()}
              >
                {bench.connection === "CONNECTING" ? "Connecting…" : "Connect Nano"}
              </button>
            )}
          </div>
        </header>

        {bench.connection === "UNSUPPORTED" && (
          <p className="bench-notice bench-notice--warning" role="status">
            Web Serial is unavailable in this browser. Open Apple Lab on localhost in Brave, Chrome, or Edge.
          </p>
        )}
        {(bench.error || actionError) && (
          <p className="bench-notice bench-notice--error" role="alert">
            {actionError ?? bench.error}
          </p>
        )}

        <div className="usb-bench-facts">
          <HealthItem
            label="Firmware profile"
            value={bench.profile ?? "Not identified"}
            detail={firmwareVersion ? `Firmware ${firmwareVersion}` : "Connect and query the Nano"}
            tone={recognized ? "good" : undefined}
          />
          <HealthItem
            label="Safety mode"
            value={safety.value}
            detail={safety.detail}
            tone={recognized ? "good" : undefined}
          />
          <HealthItem
            label="Driver intent"
            value={intent ?? "Unknown"}
            detail={intent ? "Reported by the Nano" : "Waiting for a state receipt"}
            tone={idle ? "good" : undefined}
          />
          <HealthItem
            label={receipt.label}
            value={receipt.value}
            detail={receipt.detail}
            tone={receipt.good ? "good" : undefined}
          />
        </div>

        <div
          className={kind === "audio" ? "usb-bench-state usb-bench-state--audio" : "usb-bench-state"}
          aria-live="polite"
        >
          {kind === "audio" ? (
            <>
              <div>
                <span>CARD</span>
                <strong>
                  {bench.audioState
                    ? bench.audioState.sdMounted
                      ? `MOUNTED ${bench.audioState.cardMb} MB`
                      : "NOT MOUNTED"
                    : "—"}
                </strong>
              </div>
              <div>
                <span>GAIN</span>
                <strong>{bench.audioState ? `${bench.audioState.gainPercent}%` : "—"}</strong>
              </div>
              <div>
                <span>PLAYBACK</span>
                <strong>{bench.audioState?.status ?? "—"}</strong>
              </div>
            </>
          ) : (
            <>
              <div>
                <span>ENA</span>
                <strong>{pins?.ena ?? "—"}</strong>
              </div>
              <div>
                <span>IN1</span>
                <strong>{pins?.in1 ?? "—"}</strong>
              </div>
              <div>
                <span>IN2</span>
                <strong>{pins?.in2 ?? "—"}</strong>
              </div>
            </>
          )}
          <p>
            {description}
            {kind === "motion" && bench.motionState
              ? ` Position about ${bench.motionState.positionMm} mm${bench.motionState.positionKnown ? "" : ", unverified until a drive completes"}.`
              : ""}
            {kind === "motion" && bench.motionHello?.currentSensor && bench.motionState?.currentMa !== undefined
              ? ` Motor current ${bench.motionState.currentMa} mA.`
              : ""}
          </p>
        </div>

        <div className={armed ? "service-safety is-armed" : "service-safety"}>
          <div>
            <span>
              {armed
                ? powered
                  ? "Powered session armed"
                  : kind === "audio"
                    ? "Audio session armed"
                    : "USB logic session armed"
                : "Physical disconnect check"}
            </span>
            <strong>
              {armed
                ? powered
                  ? "One command per arm; the firmware disarms itself after each"
                  : kind === "audio"
                    ? "Card, checksum, tone, fixture, gain, and bus checks are available"
                    : "The bounded self-test is available for 60 seconds"
                : "Confirm all three conditions each session"}
            </strong>
            <fieldset className="bench-confirmations" disabled={!recognized || armed}>
              <legend className="visually-hidden">Required physical confirmations</legend>
              <label>
                <input
                  type="checkbox"
                  checked={confirmations.power}
                  onChange={(event) => setConfirmations((value) => ({ ...value, power: event.target.checked }))}
                />
                {labels.power}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={confirmations.actuator}
                  onChange={(event) => setConfirmations((value) => ({ ...value, actuator: event.target.checked }))}
                />
                {labels.actuator}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={confirmations.outputs}
                  onChange={(event) => setConfirmations((value) => ({ ...value, outputs: event.target.checked }))}
                />
                {labels.outputs}
              </label>
            </fieldset>
          </div>
          <div className="bench-session-actions">
            {armed ? (
              <button type="button" className="secondary-button" onClick={onDisarm}>
                End session
              </button>
            ) : (
              <button type="button" className="arm-button" disabled={!canArm} onClick={onArm}>
                {powered ? "Arm powered session" : kind === "audio" ? "Arm audio session" : "Arm USB-only test"}
              </button>
            )}
          </div>
        </div>

        <div className="bench-command-bar">
          {kind === "logic" && (
            <button
              type="button"
              className="primary-button"
              disabled={!armed || !recognized || testRunning}
              onClick={() => void runAction(bench.runLogicSelfTest)}
            >
              {testRunning ? "Self-test running…" : "Run bounded logic self-test"}
            </button>
          )}
          {kind === "jog" && (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={!armed || !recognized || jogMoving}
                onClick={() => void runAction(bench.jogExtend)}
              >
                Extend {jogWindowMs} ms
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!armed || !recognized || jogMoving}
                onClick={() => void runAction(bench.jogRetract)}
              >
                Retract {jogWindowMs} ms
              </button>
            </>
          )}
          {kind === "motion" && (
            <button
              type="button"
              className="primary-button"
              disabled={!armed || !recognized || motionBusy}
              onClick={() => void runAction(bench.startHomeRun)}
            >
              {motionBusy ? "Sequence running…" : "Start one home run"}
            </button>
          )}
          {kind === "audio" && (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={!audioReady}
                onClick={() => void runAction(bench.mountCard)}
              >
                Mount card
              </button>
              <button type="button" disabled={!audioReady} onClick={() => void runAction(bench.checksumFixture)}>
                Verify fixture CRC
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!audioReady}
                onClick={() => void runAction(bench.playTone)}
              >
                Play 440 Hz tone
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!audioReady}
                onClick={() => void runAction(bench.playFixture)}
              >
                Play card fixture
              </button>
              <button
                type="button"
                className="stop-button"
                disabled={!audioReady}
                onClick={() => void runAction(bench.stopPlayback)}
              >
                Stop playback
              </button>
              <button type="button" disabled={!audioReady} onClick={() => void runAction(() => bench.setGain(1))}>
                Gain 10 %
              </button>
              <button type="button" disabled={!audioReady} onClick={() => void runAction(() => bench.setGain(2))}>
                Gain 20 %
              </button>
              <button type="button" disabled={!audioReady} onClick={() => void runAction(() => bench.setGain(3))}>
                Gain 35 %
              </button>
              <button type="button" disabled={!audioReady} onClick={() => void runAction(bench.runAlternationTest)}>
                Run display/SD alternation
              </button>
            </>
          )}
          {kind !== "audio" && (
            <button
              type="button"
              className="stop-button"
              disabled={!connected}
              onClick={() => void runAction(bench.forceStop)}
            >
              Force outputs low
            </button>
          )}
          <button type="button" disabled={!connected} onClick={() => void runAction(bench.queryStatus)}>
            Refresh status
          </button>
        </div>

        {kind === "audio" && (bench.audioCard || bench.audioChecksum) && (
          <div className="bench-audio-evidence">
            {bench.audioCard && (
              <div>
                <span>
                  {bench.audioCard.status === "MOUNTED"
                    ? `Card mounted · ${bench.audioCard.cardMb} MB · ${bench.audioCard.files.length} file${bench.audioCard.files.length === 1 ? "" : "s"}`
                    : "Card missing · check the A0 chip select and the card seating"}
                </span>
                {bench.audioCard.files.length > 0 && (
                  <ul aria-label="Card files">
                    {bench.audioCard.files.map((file) => (
                      <li key={file.name}>
                        <code>{file.name}</code>
                        <small>{formatBytes(file.bytes)}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {bench.audioChecksum && (
              <p>
                {bench.audioChecksum.status === "OK"
                  ? `Fixture ${bench.audioChecksum.file} · ${bench.audioChecksum.bytes} bytes · CRC-32 ${bench.audioChecksum.crc32}. Compare with the value printed by tools/make_tone_wav.py.`
                  : bench.audioChecksum.status === "NO_CARD"
                    ? "Checksum skipped: no card mounted."
                    : `Checksum skipped: ${bench.audioChecksum.file ?? "the fixture"} is missing from the card.`}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="manager-panel commissioning-panel" aria-labelledby="commissioning-title">
        <header className="panel-title">
          <div>
            <span>Stored in this browser</span>
            <h2 id="commissioning-title">Commissioning checklist</h2>
          </div>
          <small>
            {checklistItems.filter((item) => checklist[item.id]).length} of {checklistItems.length} complete
          </small>
        </header>
        <div className="commissioning-grid">
          {checklistItems.map((item) => (
            <label
              key={item.id}
              className={checklist[item.id] ? "commissioning-item is-complete" : "commissioning-item"}
            >
              <input
                type="checkbox"
                checked={checklist[item.id] === true}
                onChange={(event) => updateChecklist(item.id, event.target.checked)}
              />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="manager-panel bench-log-panel" aria-labelledby="bench-log-title">
        <header className="panel-title">
          <div>
            <span>Last {bench.log.length} lines</span>
            <h2 id="bench-log-title">Nano serial evidence</h2>
          </div>
          <div className="bench-log-actions">
            <CsvExportButton
              rows={bench.log}
              columns={[
                { header: "Received at (UTC)", value: (line) => line.receivedAt },
                { header: "Serial line", value: (line) => line.text },
              ]}
              fileName="apple-lab-usb-bench-log"
            />
            <button type="button" disabled={bench.log.length === 0} onClick={bench.clearLog}>
              Clear
            </button>
          </div>
        </header>
        {bench.log.length === 0 ? (
          <p className="empty-state">Connect a Nano to collect versioned status and test receipts.</p>
        ) : (
          <ol className="bench-serial-log" aria-label="Nano serial output">
            {[...bench.log].reverse().map((line) => (
              <li key={line.id}>
                <time dateTime={line.receivedAt}>
                  {new Intl.DateTimeFormat("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                    fractionalSecondDigits: 3,
                  }).format(new Date(line.receivedAt))}
                </time>
                <code>{line.text}</code>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
