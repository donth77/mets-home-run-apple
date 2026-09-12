import { ACTUATOR_FULL_STROKE_SECONDS } from "@apple/apple-3d/actuator-physics";
import { GameCore, type CoreCelebration, type CoreResult } from "@apple/game-core-wasm";
import { MAX_STROKE_MM, type NormalizedGameInput } from "@apple/protocol";

export interface LiveCelebration {
  eventKey: string;
  kind: CoreCelebration;
  subject: string;
}

export interface LiveCorePresentation {
  decision?: CoreResult;
  celebration?: LiveCelebration;
  targetPositionMm: number;
}

export interface LiveGameCoreControllerOptions {
  /** Drive time before a motion command counts as arrived. Defaults to the animated actuator's full stroke. */
  strokeMs?: number;
}

/**
 * Like the firmware's timed actuator, the Virtual Apple decides arrival by the
 * clock rather than by position feedback. The animated actuator normally
 * reports the same arrival a frame earlier, but a browser that pauses
 * animation frames (a hidden or occluded tab, a stalled main thread) would
 * otherwise leave the core waiting past its motion deadline, which faults the
 * sequence, drops the Apple mid-celebration, and disables every later
 * celebration in the game.
 */
export const VIRTUAL_ACTUATOR_STROKE_MS = Math.round(ACTUATOR_FULL_STROKE_SECONDS * 1_000);

const TIMER_DRIVEN_SEQUENCE_STATES = new Set<CoreResult["sequenceState"]>([
  "LEAD_IN",
  "EXTENDING",
  "RAISED",
  "RETRACTING",
]);

export function coreSequenceNeedsTicking(sequenceState: CoreResult["sequenceState"] | undefined) {
  return sequenceState !== undefined && TIMER_DRIVEN_SEQUENCE_STATES.has(sequenceState);
}

export class LiveGameCoreController {
  readonly #core: GameCore;
  readonly #strokeMs: number;
  #expectedPositionMm: number | undefined;
  #motionDueAtMs: number | undefined;
  #lastNowMs = 0;
  #presentation: LiveCorePresentation = { targetPositionMm: 0 };

  private constructor(core: GameCore, strokeMs: number) {
    this.#core = core;
    this.#strokeMs = strokeMs;
  }

  static async create(options: LiveGameCoreControllerOptions = {}) {
    return new LiveGameCoreController(await GameCore.create(), options.strokeMs ?? VIRTUAL_ACTUATOR_STROKE_MS);
  }

  ingest(input: NormalizedGameInput, nowMs: number) {
    this.#settleTimedMotion(nowMs);
    return this.#accept(this.#core.ingest(input, nowMs), nowMs);
  }

  tick(nowMs: number) {
    this.#settleTimedMotion(nowMs);
    return this.#accept(this.#core.tick(nowMs), nowMs);
  }

  reportPosition(positionMm: number, nowMs: number): LiveCorePresentation | undefined {
    const expected = this.#expectedPositionMm;
    if (expected === undefined || Math.abs(positionMm - expected) > 0.25) return undefined;
    return this.#arrive(expected, nowMs);
  }

  dispose() {
    this.#core.dispose();
  }

  /** Reports arrival once the timed drive has run its course, whether or not an animation frame ever did. */
  #settleTimedMotion(nowMs: number) {
    const expected = this.#expectedPositionMm;
    const dueAtMs = this.#motionDueAtMs;
    if (expected === undefined || dueAtMs === undefined || nowMs < dueAtMs) return;
    // Arrival happened when the drive finished, but the core's clock may never move backwards.
    this.#arrive(expected, Math.max(dueAtMs, this.#lastNowMs));
  }

  #arrive(positionMm: number, nowMs: number) {
    this.#expectedPositionMm = undefined;
    this.#motionDueAtMs = undefined;
    return this.#accept(this.#core.reportPosition(positionMm, nowMs), nowMs);
  }

  #accept(result: CoreResult, nowMs: number): LiveCorePresentation {
    this.#lastNowMs = Math.max(this.#lastNowMs, nowMs);
    let celebration = this.#presentation.celebration;
    let targetPositionMm = this.#presentation.targetPositionMm;
    for (const event of result.events) {
      if (event.type === "CELEBRATION_STARTED") {
        celebration = {
          eventKey: event.eventKey,
          kind: event.celebration,
          subject: event.subject,
        };
      }
    }
    for (const command of result.commands) {
      if (command.type === "MOTION_EXTEND") {
        this.#expectedPositionMm = MAX_STROKE_MM;
        this.#motionDueAtMs = nowMs + this.#strokeMs;
        targetPositionMm = MAX_STROKE_MM;
      } else if (command.type === "MOTION_RETRACT") {
        this.#expectedPositionMm = 0;
        this.#motionDueAtMs = nowMs + this.#strokeMs;
        targetPositionMm = 0;
      } else if (command.type === "MOTION_DISABLE") {
        this.#expectedPositionMm = undefined;
        this.#motionDueAtMs = undefined;
        targetPositionMm = 0;
        celebration = undefined;
      }
    }
    if (result.sequenceState === "IDLE" && this.#expectedPositionMm === undefined) {
      celebration = undefined;
    }
    this.#presentation = { decision: result, celebration, targetPositionMm };
    return this.#presentation;
  }
}
