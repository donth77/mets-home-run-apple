interface GameStateEmscriptenModule {
  _malloc(size: number): number;
  _free(pointer: number): void;
  UTF8ToString(pointer: number): string;
  stringToUTF8(value: string, pointer: number, maximumBytes: number): void;
  lengthBytesUTF8(value: string): number;
  _apple_game_state_create(): number;
  _apple_game_state_destroy(handle: number): void;
  _apple_game_state_begin_frame(handle: number, gamePk: number, gameNumber: number, cursor: number, updateMode: number, phase: number, label: number, awayTeamId: number, awayAbbreviation: number, awayName: number, awayRuns: number, homeTeamId: number, homeAbbreviation: number, homeName: number, homeRuns: number, inning: number, half: number, displayOuts: number, evidenceOuts: number, review: number, lastEvent: number): number;
  _apple_game_state_set_context(handle: number, hasScheduledStart: number, scheduledStart: number, hasVenue: number, venue: number): number;
  _apple_game_state_set_at_bat(handle: number, balls: number, strikes: number, first: number, second: number, third: number, hasBatter: number, batter: number, hasBatterLine: number, batterLine: number, hasPitcher: number, pitcher: number, hasPitchCount: number, pitchCount: number): number;
  _apple_game_state_set_linescore_totals(handle: number, hasAwayHits: number, awayHits: number, hasHomeHits: number, homeHits: number, hasAwayErrors: number, awayErrors: number, hasHomeErrors: number, homeErrors: number): number;
  _apple_game_state_add_inning(handle: number, inning: number, hasAway: number, away: number, hasHome: number, home: number): number;
  _apple_game_state_add_play(handle: number, eventKey: number, atBatIndex: number, battingTeamId: number, batterName: number, kind: number, complete: number, review: number): number;
  _apple_game_state_commit(handle: number): number;
  _apple_game_state_last_error(handle: number): number;
  _apple_game_state_snapshot_json(handle: number): number;
  _apple_game_state_decision_json(handle: number): number;
  _apple_game_status_classify(abstractState: number, detailedState: number, statusCode: number, reason: number, latestAdvisory: number, reviewPending: number): number;
}

interface GameStateModuleOptions {
  instantiateWasm?(
    imports: WebAssembly.Imports,
    successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ): WebAssembly.Exports;
}

export default function createGameStateModule(options?: GameStateModuleOptions): Promise<GameStateEmscriptenModule>;
