import type { AppleCommand, AppleCoreEvent, NormalizedGameInput } from "./core";
import type { PresentationSnapshot } from "./game";

export interface FixtureFrame {
  atMs: number;
  snapshot: PresentationSnapshot;
  positionMm: number;
  events: readonly AppleCoreEvent[];
  commands: readonly AppleCommand[];
  trace: string;
}

export interface FixtureScenario {
  id: string;
  title: string;
  shortLabel: string;
  description: string;
  frames: readonly FixtureFrame[];
  deviceFixture: DeviceFixtureDefinition;
}

export interface DeviceFixtureInputFrame {
  atMs: number;
  input: NormalizedGameInput;
}

export interface DeviceFixtureDefinition {
  schemaVersion: 1;
  fixtureVersion: 1;
  frames: readonly DeviceFixtureInputFrame[];
  expectedMotionSequences: number;
}

export type DeviceFixtureRunMode = "LOGIC_RECORDING" | "PHYSICAL";

export interface DeviceFixtureRunRequest {
  schemaVersion: 1;
  requestId: string;
  scenarioId: string;
  mode: DeviceFixtureRunMode;
  fixture: DeviceFixtureDefinition;
}

export type DeviceFixtureRunStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "CANCELLED";

export interface DeviceFixtureRunReceipt {
  schemaVersion: 1;
  requestId: string;
  scenarioId: string;
  mode: DeviceFixtureRunMode;
  status: DeviceFixtureRunStatus;
  currentFrame: number;
  totalFrames: number;
  recordedEvents: readonly AppleCoreEvent[];
  recordedCommands: readonly AppleCommand[];
  trace: readonly string[];
}
