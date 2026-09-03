import type {
  AppleCoreEvent,
  AppleCommandType,
  CelebrationKind,
  GamePhase,
  NormalizedGameInput,
  NormalizedPlayEvidence,
  NormalizedPlayKind,
  NormalizedUpdateMode,
  ReviewState,
} from "@apple/protocol";
import createAppleCoreModule from "./generated/apple-core.mjs";

export type CoreUpdateMode = NormalizedUpdateMode;
export type CoreHalf = "TOP" | "BOTTOM" | "MIDDLE" | "END";
export type CorePlayKind = NormalizedPlayKind;
export type CoreCelebration = CelebrationKind;
export type CoreSequenceState = "IDLE" | "LEAD_IN" | "REVIEW_HOLD" | "EXTENDING" | "RAISED" | "RETRACTING" | "FAULT";

export type CorePlayEvidence = NormalizedPlayEvidence;
export type CoreInputEnvelope = NormalizedGameInput;

export interface CoreCommand {
  type: AppleCommandType;
  eventKey: string;
  positionMm: number;
  deadlineMs: number;
}

export type CoreEvent = AppleCoreEvent;

export interface CoreTraceEntry {
  code: string;
  detail: string;
}

export interface CoreResult {
  events: readonly CoreEvent[];
  commands: readonly CoreCommand[];
  traces: readonly CoreTraceEntry[];
  sequenceState: CoreSequenceState;
  faultLatched: boolean;
}

const updateModes: Record<CoreUpdateMode, number> = {
  BOOTSTRAP: 0,
  INCREMENTAL: 1,
};
const phases: Record<GamePhase, number> = {
  PREGAME: 0,
  LIVE: 1,
  REVIEW: 2,
  DELAYED: 3,
  FINAL: 4,
  SLEEP: 5,
};
const halves: Record<CoreHalf, number> = {
  TOP: 0,
  BOTTOM: 1,
  MIDDLE: 2,
  END: 3,
};
const playKinds: Record<CorePlayKind, number> = {
  OTHER: 0,
  HOME_RUN: 1,
  GRAND_SLAM: 2,
};
const reviews: Record<ReviewState, number> = {
  NONE: 0,
  PENDING: 1,
  CONFIRMED: 2,
  OVERTURNED: 3,
};
const commandTypes: readonly AppleCommandType[] = ["MOTION_EXTEND", "MOTION_RETRACT", "MOTION_DISABLE"];
const celebrations: readonly CoreCelebration[] = ["HOME_RUN", "METS_WIN", "GRAND_SLAM"];
const sequenceStates: readonly CoreSequenceState[] = [
  "IDLE",
  "LEAD_IN",
  "REVIEW_HOLD",
  "EXTENDING",
  "RAISED",
  "RETRACTING",
  "FAULT",
];

type Module = Awaited<ReturnType<typeof createAppleCoreModule>>;
export type GameCoreModuleFactory = () => Promise<Module>;

export class GameCore {
  static async create(moduleFactory: GameCoreModuleFactory = createAppleCoreModule): Promise<GameCore> {
    const module = await moduleFactory();
    return new GameCore(module);
  }

  readonly #module: Module;
  #handle: number;

  private constructor(module: Module) {
    this.#module = module;
    this.#handle = module._apple_core_create();
    if (this.#handle === 0) throw new Error("Unable to allocate the core");
  }

  dispose(): void {
    if (this.#handle === 0) return;
    this.#module._apple_core_destroy(this.#handle);
    this.#handle = 0;
  }

  ingest(input: CoreInputEnvelope, nowMs: number): CoreResult {
    this.#assertAlive();
    this.#withStrings([input.cursor], ([cursorPointer]) => {
      const started = this.#module._apple_core_begin_input(
        this.#handle,
        input.schemaVersion,
        updateModes[input.updateMode],
        input.gamePk,
        input.gameNumber,
        cursorPointer,
        phases[input.phase],
        halves[input.half],
        input.inning,
        input.outs,
        input.awayTeamId,
        input.homeTeamId,
        input.awayRuns,
        input.homeRuns,
      );
      if (started !== 1) throw new Error("Core rejected the input boundary enums");
    });

    for (const play of input.plays) {
      this.#withStrings([play.eventKey, play.batterName], ([key, batter]) => {
        const added = this.#module._apple_core_add_play(
          this.#handle,
          key,
          play.atBatIndex,
          play.battingTeamId,
          batter,
          playKinds[play.kind],
          play.complete ? 1 : 0,
          reviews[play.review],
        );
        if (added !== 1) throw new Error("Core rejected the play boundary enums");
      });
    }
    if (this.#module._apple_core_commit_input(this.#handle, nowMs) !== 1) {
      throw new Error("Core could not commit the input envelope");
    }
    return this.#readResult();
  }

  tick(nowMs: number): CoreResult {
    this.#assertAlive();
    if (this.#module._apple_core_tick(this.#handle, nowMs) !== 1) {
      throw new Error("Core rejected the monotonic tick boundary");
    }
    return this.#readResult();
  }

  reportPosition(positionMm: number, nowMs: number): CoreResult {
    this.#assertAlive();
    if (this.#module._apple_core_report_position(this.#handle, positionMm, nowMs) !== 1) {
      throw new Error("Core rejected the position boundary");
    }
    return this.#readResult();
  }

  setLedgerFailures(failReads: boolean, failWrites: boolean): void {
    this.#assertAlive();
    this.#module._apple_core_set_ledger_failures(this.#handle, failReads ? 1 : 0, failWrites ? 1 : 0);
  }

  ledgerContains(eventKey: string): boolean {
    this.#assertAlive();
    return this.#withStrings(
      [eventKey],
      ([pointer]) => this.#module._apple_core_ledger_contains(this.#handle, pointer) === 1,
    );
  }

  #assertAlive(): void {
    if (this.#handle === 0) throw new Error("GameCore has been disposed");
  }

  #withStrings<T>(values: readonly string[], callback: (pointers: readonly number[]) => T): T {
    const pointers = values.map((value) => {
      const bytes = this.#module.lengthBytesUTF8(value) + 1;
      const pointer = this.#module._malloc(bytes);
      if (pointer === 0) throw new Error("Unable to allocate a WASM string");
      this.#module.stringToUTF8(value, pointer, bytes);
      return pointer;
    });
    try {
      return callback(pointers);
    } finally {
      for (const pointer of pointers) this.#module._free(pointer);
    }
  }

  #readResult(): CoreResult {
    const events = Array.from({ length: this.#module._apple_core_event_count(this.#handle) }, (_, index): CoreEvent => {
      const celebration = celebrations[this.#module._apple_core_event_celebration(this.#handle, index)];
      if (!celebration || this.#module._apple_core_event_type(this.#handle, index) !== 0) {
        throw new Error("Unknown event enum from WASM");
      }
      return {
        type: "CELEBRATION_STARTED",
        eventKey: this.#module.UTF8ToString(this.#module._apple_core_event_key(this.#handle, index)),
        celebration,
        subject: this.#module.UTF8ToString(this.#module._apple_core_event_subject(this.#handle, index)),
      };
    });
    const commands = Array.from(
      { length: this.#module._apple_core_command_count(this.#handle) },
      (_, index): CoreCommand => {
        const type = commandTypes[this.#module._apple_core_command_type(this.#handle, index)];
        if (!type) throw new Error("Unknown command enum from WASM");
        return {
          type,
          eventKey: this.#module.UTF8ToString(this.#module._apple_core_command_event_key(this.#handle, index)),
          positionMm: this.#module._apple_core_command_position_mm(this.#handle, index),
          deadlineMs: this.#module._apple_core_command_deadline_ms(this.#handle, index),
        };
      },
    );
    const traces = Array.from(
      { length: this.#module._apple_core_trace_count(this.#handle) },
      (_, index): CoreTraceEntry => ({
        code: this.#module.UTF8ToString(this.#module._apple_core_trace_code(this.#handle, index)),
        detail: this.#module.UTF8ToString(this.#module._apple_core_trace_detail(this.#handle, index)),
      }),
    );
    const sequenceState = sequenceStates[this.#module._apple_core_sequence_state(this.#handle)];
    if (!sequenceState) throw new Error("Unknown sequence state from WASM");
    return {
      events,
      commands,
      traces,
      sequenceState,
      faultLatched: this.#module._apple_core_fault_latched(this.#handle) === 1,
    };
  }
}
