import type {
  CanonicalGameFrame,
  GameHalf,
  GamePhase,
  GameSnapshot,
  GameStatusClassification,
  GameStatusFacts,
  NormalizedGameInput,
  NormalizedPlayKind,
  NormalizedUpdateMode,
  ReviewState,
} from "@apple/protocol";
import createGameStateModule from "./generated/game-state.mjs";

export interface GameStateProjection {
  gameSnapshot: GameSnapshot;
  coreInput: NormalizedGameInput;
}

const updateModes: Record<NormalizedUpdateMode, number> = {
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
const halves: Record<GameHalf, number> = {
  TOP: 0,
  BOTTOM: 1,
  MIDDLE: 2,
  END: 3,
};
const reviews: Record<ReviewState, number> = {
  NONE: 0,
  PENDING: 1,
  CONFIRMED: 2,
  OVERTURNED: 3,
};
const playKinds: Record<NormalizedPlayKind, number> = {
  OTHER: 0,
  HOME_RUN: 1,
  GRAND_SLAM: 2,
};

type Module = Awaited<ReturnType<typeof createGameStateModule>>;
export type GameStateModuleFactory = () => Promise<Module>;

/** Browser boundary around the portable C++ game-state projector. */
export class GameStateProjector {
  static async create(moduleFactory: GameStateModuleFactory = createGameStateModule): Promise<GameStateProjector> {
    const module = await moduleFactory();
    return new GameStateProjector(module);
  }

  readonly #module: Module;
  #handle: number;

  private constructor(module: Module) {
    this.#module = module;
    this.#handle = module._apple_game_state_create();
    if (this.#handle === 0) throw new Error("Unable to allocate the game-state projector");
  }

  dispose(): void {
    if (this.#handle === 0) return;
    this.#module._apple_game_state_destroy(this.#handle);
    this.#handle = 0;
  }

  project(frame: CanonicalGameFrame): GameStateProjection {
    this.#assertAlive();
    this.#withStrings(
      [
        frame.cursor,
        frame.label,
        frame.away.abbreviation,
        frame.away.name,
        frame.home.abbreviation,
        frame.home.name,
        frame.lastEvent,
      ],
      ([cursor, label, awayAbbreviation, awayName, homeAbbreviation, homeName, lastEvent]) => {
        this.#require(
          this.#module._apple_game_state_begin_frame(
            this.#handle,
            frame.gamePk,
            frame.gameNumber,
            cursor,
            updateModes[frame.updateMode],
            phases[frame.phase],
            label,
            frame.away.id,
            awayAbbreviation,
            awayName,
            frame.away.runs,
            frame.home.id,
            homeAbbreviation,
            homeName,
            frame.home.runs,
            frame.inning,
            halves[frame.half],
            frame.displayOuts,
            frame.evidenceOuts,
            reviews[frame.review],
            lastEvent,
          ),
          "begin the canonical frame",
        );
      },
    );

    this.#withStrings([frame.scheduledStart ?? "", frame.venue ?? ""], ([scheduledStart, venue]) => {
      this.#require(
        this.#module._apple_game_state_set_context(
          this.#handle,
          frame.scheduledStart === undefined ? 0 : 1,
          scheduledStart,
          frame.venue === undefined ? 0 : 1,
          venue,
        ),
        "set the game context",
      );
    });

    if (frame.atBat) {
      const atBat = frame.atBat;
      this.#withStrings(
        [atBat.batter ?? "", atBat.batterLine ?? "", atBat.pitcher ?? ""],
        ([batter, line, pitcher]) => {
          this.#require(
            this.#module._apple_game_state_set_at_bat(
              this.#handle,
              atBat.balls,
              atBat.strikes,
              atBat.bases.first ? 1 : 0,
              atBat.bases.second ? 1 : 0,
              atBat.bases.third ? 1 : 0,
              atBat.batter === undefined ? 0 : 1,
              batter,
              atBat.batterLine === undefined ? 0 : 1,
              line,
              atBat.pitcher === undefined ? 0 : 1,
              pitcher,
              atBat.pitchCount === undefined ? 0 : 1,
              atBat.pitchCount ?? 0,
            ),
            "set the at-bat state",
          );
        },
      );
    }

    const linescore = frame.linescore;
    this.#require(
      this.#module._apple_game_state_set_linescore_totals(
        this.#handle,
        linescore.awayHits === undefined ? 0 : 1,
        linescore.awayHits ?? 0,
        linescore.homeHits === undefined ? 0 : 1,
        linescore.homeHits ?? 0,
        linescore.awayErrors === undefined ? 0 : 1,
        linescore.awayErrors ?? 0,
        linescore.homeErrors === undefined ? 0 : 1,
        linescore.homeErrors ?? 0,
      ),
      "set the line-score totals",
    );
    for (const inning of linescore.innings) {
      this.#require(
        this.#module._apple_game_state_add_inning(
          this.#handle,
          inning.inning,
          inning.away === null ? 0 : 1,
          inning.away ?? 0,
          inning.home === null ? 0 : 1,
          inning.home ?? 0,
        ),
        "add a line-score inning",
      );
    }

    for (const play of frame.changedPlays) {
      this.#withStrings([play.eventKey, play.batterName], ([eventKey, batterName]) => {
        this.#require(
          this.#module._apple_game_state_add_play(
            this.#handle,
            eventKey,
            play.atBatIndex,
            play.battingTeamId,
            batterName,
            playKinds[play.kind],
            play.complete ? 1 : 0,
            reviews[play.review],
          ),
          "add play evidence",
        );
      });
    }

    this.#require(this.#module._apple_game_state_commit(this.#handle), "commit the canonical frame");
    const gameSnapshot = this.#readJson<GameSnapshot>(this.#module._apple_game_state_snapshot_json(this.#handle));
    // The established TypeScript projection includes these optional keys with
    // `undefined`; retain that object shape until consumers migrate together.
    if (!("scheduledStart" in gameSnapshot)) gameSnapshot.scheduledStart = undefined;
    if (!("venue" in gameSnapshot)) gameSnapshot.venue = undefined;
    if (!("atBat" in gameSnapshot)) gameSnapshot.atBat = undefined;
    return {
      gameSnapshot,
      coreInput: this.#readJson<NormalizedGameInput>(this.#module._apple_game_state_decision_json(this.#handle)),
    };
  }

  /** Phase and label for MLB's status fields, classified by the shared C++. */
  classifyStatus(facts: GameStatusFacts): GameStatusClassification {
    this.#assertAlive();
    return this.#withStrings(
      [facts.abstractState, facts.detailedState, facts.statusCode, facts.reason, facts.latestAdvisory],
      ([abstractState, detailedState, statusCode, reason, latestAdvisory]) =>
        this.#readJson<GameStatusClassification>(
          this.#module._apple_game_status_classify(
            abstractState,
            detailedState,
            statusCode,
            reason,
            latestAdvisory,
            facts.reviewPending ? 1 : 0,
          ),
        ),
    );
  }

  #assertAlive(): void {
    if (this.#handle === 0) throw new Error("GameStateProjector has been disposed");
  }

  #require(result: number, action: string): void {
    if (result === 1) return;
    const pointer = this.#module._apple_game_state_last_error(this.#handle);
    const detail = pointer === 0 ? "" : this.#module.UTF8ToString(pointer);
    throw new Error(`Unable to ${action}${detail ? `: ${detail}` : ""}`);
  }

  #readJson<T>(pointer: number): T {
    if (pointer === 0) throw new Error("The game-state projector returned an empty result");
    const json = this.#module.UTF8ToString(pointer);
    if (!json) throw new Error("The game-state projector returned an empty result");
    return JSON.parse(json) as T;
  }

  #withStrings<T>(values: readonly string[], callback: (pointers: readonly number[]) => T): T {
    const pointers: number[] = [];
    try {
      for (const value of values) {
        const bytes = this.#module.lengthBytesUTF8(value) + 1;
        const pointer = this.#module._malloc(bytes);
        if (pointer === 0) throw new Error("Unable to allocate a WASM string");
        this.#module.stringToUTF8(value, pointer, bytes);
        pointers.push(pointer);
      }
      return callback(pointers);
    } finally {
      for (const pointer of pointers) this.#module._free(pointer);
    }
  }
}
