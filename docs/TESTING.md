# Testing

The project must be fully testable between games and without any physical hardware.

## Deterministic bench

Apple Lab provides:

- a fake local-device adapter for manager UI and safety-state testing;
- a read-only significant-event timeline containing home runs, review outcomes, Mets wins, motion results and faults without pitch-by-pitch noise;
- fixture and synthetic-input transports;
- a fake monotonic clock with play, pause, step and advance controls;
- in-memory and failure-injecting persistence;
- recording display and motion ports;
- a line-oriented trace of requests, cursor changes, normalized state, decisions, ledger writes, display frames, motion commands and wake plans;
- fault injection for network, payload, ordering, game status, time, storage, display and motion failures.

Tests advance fake time and never call a real sleep function.

The browser slice implements this contract with a fake managed device, synthetic presentation snapshots and versioned normalized device fixtures. Hardware-test requests are explicitly armed, expire automatically and remain recording-only. Every Simulator device fixture is already executed by the compiled WASM core; the Nano runner and authenticated transport remain pending.

## Required scenarios

- Mets solo and multi-run home runs;
- opponent home runs;
- duplicate and out-of-order updates;
- bootstrap/full-update responses containing historical plays;
- review pending, stands, confirmed and overturned;
- rain delay, postponed, suspended and resumed games;
- doubleheaders with independent game contexts;
- Mets win and non-Mets final;
- offline, DNS/TLS failure, timeout, rate limit and server error;
- malformed, truncated, oversized, stale, regressed and wrong-game data;
- reboot before/after ledger persistence;
- clock/NTP discontinuity, DST boundary and monotonic wrap handling;
- storage corruption/write failure;
- missing display and motion timeout.

## Cross-target golden traces

Each fixture has expected normalized snapshots and command traces. CI first runs the canonical core natively, then runs the same fixture through WebAssembly. Nano integration tests run a smaller high-value subset with motion disarmed. Differences are failures unless an ignored diagnostic field is explicitly documented.

## Test layers

1. **Pure unit tests:** reducers, selection, review handling, deduplication, queueing and sleep planning.
2. **Native scenario tests:** complete saved sequences with fake ports and time.
3. **WASM contract tests:** schema, memory ownership and golden-trace equality.
4. **Browser tests:** Apple Lab controls, 3D motion and accessible scoreboard using offline fixtures.
5. **Embedded disarmed tests:** Wi-Fi/TLS, storage, display and recording-motion integration.
6. **Fused motion bench:** unloaded actuator, then measured load, then guarded donor; never in CI.

Package ownership follows the implementation boundary. The MLB package tests schedule selection, timecode behavior, full/diff transitions, historical indexing, streamed response limits, timeout/abort behavior, malformed payloads, and prototype-pollution rejection without opening a network connection. The scoreboard package tests home/away Mets identity and minimum white-text contrast. The 3D package tests actuator physics, model wireframe restoration, stadium presentation helpers, bounded team-logo loading, and request deadlines.

`pnpm check:constants` parses the canonical C++ constants and fails if the web protocol or actuator simulation drifts on team ID, stroke, lead-in, direction timeout, or either 30-second dwell. Every workspace package with TypeScript participates in `pnpm typecheck`.

Live recording stays disarmed. Saving a capture as a candidate fixture is a later workflow; any candidate must be minimized and reviewed before entering the repository.

Apple Lab also includes opt-in direct MLB recording and Historical Replay tools for manual development. Their transport parsing is covered by synthetic `fetch` responses; CI never calls MLB. Historical Replay is a standard Apple Lab source with no additional query gate. It indexes a completed game's archive only after operator action, then supports sequential timecode stepping and staging immediately before home-run/final bookmarks. Reverse navigation resets and bootstraps the core so historical browsing cannot trigger stale events.

A manual archive acceptance check should confirm one completed Mets game end to end: stage before a known home run, advance once and observe one C++ home-run receipt; stage before the final transition, advance once and observe a Mets-win receipt when appropriate. Also verify wrapped patch batches, RFC 6902 `copy`, and state-changing responses that reuse an upstream timestamp. Live or archived payloads are not committed as fixtures until minimized and reviewed.

## Core invariants

- No reliable evidence means no motion.
- One completed Mets batting home run produces exactly one event.
- Opponent, overturned, duplicate and historical plays produce zero events.
- Only one motion sequence is active.
- Every extend ends home or in a latched disabled fault.
- Booting from an in-progress or final snapshot never celebrates old plays.

## Local verification

Run the same static and deterministic gates used by CI:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:public
```

`pnpm test` requires CMake, a C++17 compiler, and a working Emscripten toolchain. CI pins its Ubuntu image and Emscripten SDK version rather than relying on a moving system package. Tests must remain network-free; manual live/archive acceptance checks are separate and opt-in.
