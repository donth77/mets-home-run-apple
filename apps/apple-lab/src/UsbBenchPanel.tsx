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
type SessionKind = "logic" | "jog" | "motion";

/** Physical conditions the operator attests to before a session can arm. */
const confirmationLabels: Record<"logic" | "powered", { power: string; actuator: string; outputs: string }> = {
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
};

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
  const powered = kind !== "logic";
  const labels = confirmationLabels[powered ? "powered" : "logic"];
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
        : bench.motionState?.sequence === "IDLE" && !bench.motionState.fault;
  const canArm = recognized && confirmed && idle;

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
    bench.hello?.firmwareVersion ?? bench.jogHello?.firmwareVersion ?? bench.motionHello?.firmwareVersion;
  const jogWindowMs = bench.jogHello?.maxJogMs ?? bench.jogStatus?.maxJogMs;

  const safety = (() => {
    if (kind === "jog" && bench.jogHello) {
      return { value: "POWERED_JOG", detail: `${jogWindowMs} ms window, one jog per arm` };
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
    return bench.driverState?.state;
  })();

  const receipt = (() => {
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
    kind === "jog" ? jogPins(bench.jogStatus?.motion) : kind === "motion" ? bench.motionState : bench.driverState;

  const description = (() => {
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

        <div className="usb-bench-state" aria-live="polite">
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
              {armed ? (powered ? "Powered session armed" : "USB logic session armed") : "Physical disconnect check"}
            </span>
            <strong>
              {armed
                ? powered
                  ? "One command per arm; the firmware disarms itself after each"
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
                {powered ? "Arm powered session" : "Arm USB-only test"}
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
          <button
            type="button"
            className="stop-button"
            disabled={!connected}
            onClick={() => void runAction(bench.forceStop)}
          >
            Force outputs low
          </button>
          <button type="button" disabled={!connected} onClick={() => void runAction(bench.queryStatus)}>
            Refresh status
          </button>
        </div>
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
