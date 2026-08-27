# Testing

The project must be fully testable between games and without any physical hardware.

## Deterministic bench

Apple Lab provides:

- fixture and synthetic-input transports;
- a fake monotonic clock with play, pause, step and advance controls;
- in-memory and failure-injecting persistence;
- recording display and motion ports;
- a line-oriented trace of requests, cursor changes, normalized state, decisions, ledger writes, display frames, motion commands and wake plans;
- fault injection for network, payload, ordering, game status, time, storage, display and motion failures.

Tests advance fake time and never call a real sleep function.

The first browser slice implements this contract with synthetic normalized snapshots and pre-authored command traces. It is explicitly a recording-renderer test source; the same cases will move behind the WASM core as that binding comes online.

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

Live capture is an optional later workflow. It stays disarmed and creates a candidate fixture that must be minimized and reviewed before entering the repository.

## Core invariants

- No reliable evidence means no motion.
- One completed Mets batting home run produces exactly one event.
- Opponent, overturned, duplicate and historical plays produce zero events.
- Only one motion sequence is active.
- Every extend ends home or in a latched disabled fault.
- Booting from an in-progress or final snapshot never celebrates old plays.
