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

export class LiveGameCoreController {
  readonly #core: GameCore;
  #expectedPositionMm: number | undefined;
  #presentation: LiveCorePresentation = { targetPositionMm: 0 };

  private constructor(core: GameCore) {
    this.#core = core;
  }

  static async create() {
    return new LiveGameCoreController(await GameCore.create());
  }

  ingest(input: NormalizedGameInput, nowMs: number) {
    return this.#accept(this.#core.ingest(input, nowMs));
  }

  tick(nowMs: number) {
    return this.#accept(this.#core.tick(nowMs));
  }

  reportPosition(positionMm: number, nowMs: number): LiveCorePresentation | undefined {
    const expected = this.#expectedPositionMm;
    if (expected === undefined || Math.abs(positionMm - expected) > 0.25) return undefined;
    this.#expectedPositionMm = undefined;
    return this.#accept(this.#core.reportPosition(expected, nowMs));
  }

  dispose() {
    this.#core.dispose();
  }

  #accept(result: CoreResult): LiveCorePresentation {
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
        targetPositionMm = MAX_STROKE_MM;
      } else if (command.type === "MOTION_RETRACT" || command.type === "MOTION_DISABLE") {
        this.#expectedPositionMm = command.type === "MOTION_RETRACT" ? 0 : undefined;
        targetPositionMm = 0;
        if (command.type === "MOTION_DISABLE") celebration = undefined;
      }
    }
    if (result.sequenceState === "IDLE" && this.#expectedPositionMm === undefined) {
      celebration = undefined;
    }
    this.#presentation = { decision: result, celebration, targetPositionMm };
    return this.#presentation;
  }
}
