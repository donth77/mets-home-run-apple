# Architecture

## Goals

1. A Nano ESP32 owns schedule selection, live-feed ingestion, game state, event deduplication, display state, sleep planning and motion commands.
2. The firmware remains useful with every computer and hosted service turned off.
3. Apple Lab and Virtual Apple reuse the exact decision implementation through WebAssembly.
4. Every uncertain state fails still: no reliable event, no motion.

## Deployable products

| Product | Audience | Data modes | Required server |
|---|---|---|---|
| Nano firmware | device owner | live, fixture, diagnostics | none |
| Apple Lab | builder | synthetic, replay, optional disarmed capture | none |
| Virtual Apple | fans | live, replay, demo, quiet | static host; optional cache Worker |
| Feed-cache Worker | public-site transport | live only | stateless edge runtime |

Apple Lab is diagnostic and can remain local/private. Virtual Apple contains no administrative controls, device credentials or raw trace details.

## Shared core

The canonical decision layer is a hardware-free ISO C++ game core.

`firmware/lib/core` accepts versioned input envelopes and emits snapshots plus commands. It knows nothing about JSON transport details or hardware APIs. Adapters perform parsing, persistence and I/O, then pass normalized values into the core.

The supported builds are:

- host compiler for fast deterministic tests;
- Emscripten for the `packages/game-core-wasm` browser binding;
- PlatformIO for the Nano ESP32 application.

Web and firmware outputs should be trace-equivalent after documented diagnostic fields are removed.

## Dependency direction

```text
apps ───────────────► packages/game-core-wasm ──► compiled core
apps ───────────────► packages/apple-3d
apps ───────────────► packages/scoreboard-ui
all adapters ───────► packages/protocol
native/WASM/Nano ───► packages/test-fixtures
firmware adapters ──► firmware/lib/core
edge cache ─────────► upstream transport only
```

The arrows must never point from the core toward a framework or device adapter.

## Game-data flow

1. Select all Mets games by team ID and preserve a separate context for each `gamePk`.
2. Bootstrap an authoritative snapshot and seed the event ledger without replaying history.
3. Request incremental updates using the last accepted cursor.
4. Accept either an incremental patch or a full update defensively.
5. Normalize score, inning, outs, status, batting side, review state and completed plays.
6. Reject regression, duplicates, wrong-game inputs and incomplete evidence.
7. Persist accepted cursor/event state before issuing commands.
8. Render display and motion through replaceable ports.

## Motion boundary

The core emits intent such as `MOTION_EXTEND`, `MOTION_RETRACT` and `MOTION_DISABLE`. The ESP32 adapter owns pins, H-bridge direction, end behavior, timers and watchdog interaction. Apple Lab records the same commands and animates a dimensioned 3D model; it never toggles real GPIO.

## Public-site hosting

Virtual Apple is a static application. A small edge Worker may normalize allowed request paths, cache by URL for the upstream wait interval and cap response size/time. It retains no device secrets and is not a general proxy. If it fails, the site freezes the last confirmed state and offers replay/demo mode.
