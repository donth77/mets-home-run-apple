interface AppleCoreEmscriptenModule {
  _malloc(size: number): number;
  _free(pointer: number): void;
  UTF8ToString(pointer: number): string;
  stringToUTF8(value: string, pointer: number, maximumBytes: number): void;
  lengthBytesUTF8(value: string): number;
  _apple_core_create(): number;
  _apple_core_destroy(handle: number): void;
  _apple_core_begin_input(handle: number, schemaVersion: number, updateMode: number, gamePk: number, gameNumber: number, cursorPointer: number, phase: number, half: number, inning: number, outs: number, awayTeamId: number, homeTeamId: number, awayRuns: number, homeRuns: number): number;
  _apple_core_add_play(handle: number, eventKeyPointer: number, atBatIndex: number, battingTeamId: number, batterNamePointer: number, playKind: number, complete: number, reviewState: number): number;
  _apple_core_commit_input(handle: number, nowMs: number): number;
  _apple_core_tick(handle: number, nowMs: number): number;
  _apple_core_report_position(handle: number, positionMm: number, nowMs: number): number;
  _apple_core_set_ledger_failures(handle: number, reads: number, writes: number): void;
  _apple_core_ledger_contains(handle: number, eventKeyPointer: number): number;
  _apple_core_sequence_state(handle: number): number;
  _apple_core_fault_latched(handle: number): number;
  _apple_core_event_count(handle: number): number;
  _apple_core_event_type(handle: number, index: number): number;
  _apple_core_event_key(handle: number, index: number): number;
  _apple_core_event_celebration(handle: number, index: number): number;
  _apple_core_event_subject(handle: number, index: number): number;
  _apple_core_command_count(handle: number): number;
  _apple_core_command_type(handle: number, index: number): number;
  _apple_core_command_event_key(handle: number, index: number): number;
  _apple_core_command_position_mm(handle: number, index: number): number;
  _apple_core_command_deadline_ms(handle: number, index: number): number;
  _apple_core_trace_count(handle: number): number;
  _apple_core_trace_code(handle: number, index: number): number;
  _apple_core_trace_detail(handle: number, index: number): number;
}

export default function createAppleCoreModule(): Promise<AppleCoreEmscriptenModule>;
