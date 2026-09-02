export const USB_BENCH_PROTOCOL_PREFIX = "APPLE_BENCH:";
export const USB_JOG_PROTOCOL_PREFIX = "APPLE_JOG:";
export const USB_MOTION_PROTOCOL_PREFIX = "APPLE_MOTION:";
const JOG_RECEIPT_PREFIX = "ACTUATOR_JOG=";

export type UsbBenchLogicState = "STOP" | "RAISE" | "LOWER";
export type UsbBenchTestStatus = "STARTED" | "PASSED" | "CANCELLED";
export type UsbJogProfile = "actuator_jog_test" | "l298n_output_meter_test";
export type UsbJogMotion = "STOP" | "EXTEND" | "RETRACT";
export type UsbJogReceipt = "ARMED" | "DISARMED" | "AUTO_STOP" | "ARM_EXPIRED" | "REJECTED";
export type UsbMotionSequence = "IDLE" | "LEAD_IN" | "REVIEW_HOLD" | "EXTENDING" | "RAISED" | "RETRACTING" | "FAULT";
export type UsbMotionDrive = "OFF" | "EXTEND" | "RETRACT";
export type UsbMotionRunStatus = "STARTED" | "COMPLETED" | "FAULTED" | "STOPPED";
export type UsbFirmwareProfile = "motor_logic_test" | UsbJogProfile | "motion_commissioning";

export interface UsbBenchHelloMessage {
  type: "hello";
  protocolVersion: number;
  profile: "motor_logic_test";
  firmwareVersion: string;
  safetyMode: "USB_LOGIC_ONLY";
}

export interface UsbBenchStateMessage {
  type: "state";
  state: UsbBenchLogicState;
  ena: 0 | 1;
  in1: 0 | 1;
  in2: 0 | 1;
}

export interface UsbBenchTestMessage {
  type: "test";
  name: "motor_logic";
  status: UsbBenchTestStatus;
}

export interface UsbJogHelloMessage {
  type: "jog-hello";
  profile: UsbJogProfile;
  firmwareVersion: string;
  maxJogMs: number;
  armWindowMs: number;
}

export interface UsbJogStatusMessage {
  type: "jog-status";
  firmwareVersion: string;
  armed: boolean;
  motion: UsbJogMotion;
  maxJogMs: number;
}

export interface UsbJogReceiptMessage {
  type: "jog-receipt";
  receipt: UsbJogReceipt;
  reason?: string;
}

export interface UsbMotionHelloMessage {
  type: "motion-hello";
  profile: "motion_commissioning";
  firmwareVersion: string;
  strokeMm: number;
  extendFullMs: number;
  retractFullMs: number;
  overrunMs: number;
  deadlineMs: number;
  leadInMs: number;
  dwellMs: number;
  armWindowMs: number;
  /** Present on builds that carry the current-sense code; true only when the INA219 answered at boot. */
  currentSensor?: boolean;
}

export interface UsbMotionStateMessage {
  type: "motion-state";
  armed: boolean;
  sequence: UsbMotionSequence;
  drive: UsbMotionDrive;
  positionMm: number;
  positionKnown: boolean;
  fault: boolean;
  ena: 0 | 1;
  in1: 0 | 1;
  in2: 0 | 1;
  /** Last motor current sample in milliamps, when the build reports one. */
  currentMa?: number;
}

export interface UsbMotionTraceMessage {
  type: "motion-trace";
  code: string;
  detail: string;
}

export interface UsbMotionRunMessage {
  type: "motion-run";
  status: UsbMotionRunStatus;
}

export type UsbBenchMessage =
  | UsbBenchHelloMessage
  | UsbBenchStateMessage
  | UsbBenchTestMessage
  | UsbJogHelloMessage
  | UsbJogStatusMessage
  | UsbJogReceiptMessage
  | UsbMotionHelloMessage
  | UsbMotionStateMessage
  | UsbMotionTraceMessage
  | UsbMotionRunMessage;

const JOG_PROFILES: readonly UsbJogProfile[] = ["actuator_jog_test", "l298n_output_meter_test"];
const JOG_MOTIONS: readonly UsbJogMotion[] = ["STOP", "EXTEND", "RETRACT"];
const JOG_RECEIPTS: readonly UsbJogReceipt[] = ["ARMED", "DISARMED", "AUTO_STOP", "ARM_EXPIRED", "REJECTED"];
const MOTION_SEQUENCES: readonly UsbMotionSequence[] = [
  "IDLE",
  "LEAD_IN",
  "REVIEW_HOLD",
  "EXTENDING",
  "RAISED",
  "RETRACTING",
  "FAULT",
];
const MOTION_DRIVES: readonly UsbMotionDrive[] = ["OFF", "EXTEND", "RETRACT"];
const MOTION_RUN_STATUSES: readonly UsbMotionRunStatus[] = ["STARTED", "COMPLETED", "FAULTED", "STOPPED"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBit(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseJson(line: string, prefix: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line.slice(prefix.length));
  } catch {
    return undefined;
  }
  return isRecord(value) && typeof value.type === "string" ? value : undefined;
}

function parseBench(value: Record<string, unknown>): UsbBenchMessage | undefined {
  if (
    value.type === "hello" &&
    typeof value.protocolVersion === "number" &&
    value.profile === "motor_logic_test" &&
    typeof value.firmwareVersion === "string" &&
    value.safetyMode === "USB_LOGIC_ONLY"
  ) {
    return {
      type: value.type,
      protocolVersion: value.protocolVersion,
      profile: value.profile,
      firmwareVersion: value.firmwareVersion,
      safetyMode: value.safetyMode,
    };
  }

  if (
    value.type === "state" &&
    (value.state === "STOP" || value.state === "RAISE" || value.state === "LOWER") &&
    isBit(value.ena) &&
    isBit(value.in1) &&
    isBit(value.in2)
  ) {
    return { type: value.type, state: value.state, ena: value.ena, in1: value.in1, in2: value.in2 };
  }

  if (
    value.type === "test" &&
    value.name === "motor_logic" &&
    (value.status === "STARTED" || value.status === "PASSED" || value.status === "CANCELLED")
  ) {
    return { type: value.type, name: value.name, status: value.status };
  }

  return undefined;
}

function parseJog(value: Record<string, unknown>): UsbBenchMessage | undefined {
  if (
    value.type === "hello" &&
    isOneOf(value.profile, JOG_PROFILES) &&
    typeof value.firmwareVersion === "string" &&
    isCount(value.maxJogMs) &&
    isCount(value.armWindowMs)
  ) {
    return {
      type: "jog-hello",
      profile: value.profile,
      firmwareVersion: value.firmwareVersion,
      maxJogMs: value.maxJogMs,
      armWindowMs: value.armWindowMs,
    };
  }

  if (
    value.type === "status" &&
    typeof value.firmwareVersion === "string" &&
    typeof value.armed === "boolean" &&
    isOneOf(value.motion, JOG_MOTIONS) &&
    isCount(value.maxJogMs)
  ) {
    return {
      type: "jog-status",
      firmwareVersion: value.firmwareVersion,
      armed: value.armed,
      motion: value.motion,
      maxJogMs: value.maxJogMs,
    };
  }

  return undefined;
}

function parseJogReceipt(line: string): UsbJogReceiptMessage | undefined {
  const [receipt, ...rest] = line.slice(JOG_RECEIPT_PREFIX.length).trim().split(/\s+/);
  if (!isOneOf(receipt, JOG_RECEIPTS)) return undefined;
  const reason = rest.find((token) => token.startsWith("REASON="))?.slice("REASON=".length);
  return reason ? { type: "jog-receipt", receipt, reason } : { type: "jog-receipt", receipt };
}

function parseMotion(value: Record<string, unknown>): UsbBenchMessage | undefined {
  if (
    value.type === "hello" &&
    value.profile === "motion_commissioning" &&
    typeof value.firmwareVersion === "string" &&
    isCount(value.strokeMm) &&
    isCount(value.extendFullMs) &&
    isCount(value.retractFullMs) &&
    isCount(value.overrunMs) &&
    isCount(value.deadlineMs) &&
    isCount(value.leadInMs) &&
    isCount(value.dwellMs) &&
    isCount(value.armWindowMs)
  ) {
    return {
      type: "motion-hello",
      profile: value.profile,
      firmwareVersion: value.firmwareVersion,
      strokeMm: value.strokeMm,
      extendFullMs: value.extendFullMs,
      retractFullMs: value.retractFullMs,
      overrunMs: value.overrunMs,
      deadlineMs: value.deadlineMs,
      leadInMs: value.leadInMs,
      dwellMs: value.dwellMs,
      armWindowMs: value.armWindowMs,
      ...(typeof value.currentSensor === "boolean" ? { currentSensor: value.currentSensor } : {}),
    };
  }

  if (
    value.type === "state" &&
    typeof value.armed === "boolean" &&
    isOneOf(value.sequence, MOTION_SEQUENCES) &&
    isOneOf(value.drive, MOTION_DRIVES) &&
    typeof value.positionMm === "number" &&
    typeof value.positionKnown === "boolean" &&
    typeof value.fault === "boolean" &&
    isBit(value.ena) &&
    isBit(value.in1) &&
    isBit(value.in2)
  ) {
    return {
      type: "motion-state",
      armed: value.armed,
      sequence: value.sequence,
      drive: value.drive,
      positionMm: value.positionMm,
      positionKnown: value.positionKnown,
      fault: value.fault,
      ena: value.ena,
      in1: value.in1,
      in2: value.in2,
      ...(typeof value.currentMa === "number" && Number.isFinite(value.currentMa)
        ? { currentMa: value.currentMa }
        : {}),
    };
  }

  if (value.type === "trace" && typeof value.code === "string" && typeof value.detail === "string") {
    return { type: "motion-trace", code: value.code, detail: value.detail };
  }

  if (value.type === "run" && isOneOf(value.status, MOTION_RUN_STATUSES)) {
    return { type: "motion-run", status: value.status };
  }

  return undefined;
}

export function parseUsbBenchLine(line: string): UsbBenchMessage | undefined {
  if (line.startsWith(USB_BENCH_PROTOCOL_PREFIX)) {
    const value = parseJson(line, USB_BENCH_PROTOCOL_PREFIX);
    return value ? parseBench(value) : undefined;
  }
  if (line.startsWith(USB_JOG_PROTOCOL_PREFIX)) {
    const value = parseJson(line, USB_JOG_PROTOCOL_PREFIX);
    return value ? parseJog(value) : undefined;
  }
  if (line.startsWith(USB_MOTION_PROTOCOL_PREFIX)) {
    const value = parseJson(line, USB_MOTION_PROTOCOL_PREFIX);
    return value ? parseMotion(value) : undefined;
  }
  if (line.startsWith(JOG_RECEIPT_PREFIX)) return parseJogReceipt(line);
  return undefined;
}
