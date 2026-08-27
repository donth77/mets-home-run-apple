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
| Apple Lab | device owner / builder | local monitor, synthetic, local historical replay, gated diagnostics | none |
| Virtual Apple | fans | live, quiet; local fixture demo in development | static host; optional cache Worker |
| Feed-cache Worker | public-site transport | live only | stateless edge runtime |

Apple Lab is diagnostic and can remain local/private. Virtual Apple contains no administrative controls, device credentials or raw trace details.

## Local device management

The Nano remains authoritative while Apple Lab is connected or closed. Apple Lab reads versioned device status, accepted game snapshots and a bounded event history over a future authenticated local transport; it does not run a second live-game decision service.

Apple Lab has three safety domains:

1. **Live Device** is read-only. It mirrors accepted state and cannot issue motion.
2. **Simulator** uses deterministic fixtures, fake time and recording ports with no device transport.
3. **Hardware Tests** is a separate service surface. A future physical adapter must require a firmware-issued, expiring maintenance lease, confirm idle/end-stop state and visibly suspend automatic motion before accepting a test request.

Meaningful events such as confirmed home runs, reviews, delays, Mets wins, completed motion and faults use stable identifiers. Viewing or selecting a historical event never replays it. A separate safe action may copy an event into Simulator without reaching the device.

## Shared core

The canonical decision layer is a hardware-free ISO C++ game core.

`firmware/lib/core` accepts versioned input envelopes and emits decisions, commands and stable traces. It knows nothing about JSON transport details or hardware APIs. Adapters perform parsing and I/O, then pass normalized values into the core. A supplied event-ledger port gives the core the synchronous persist-before-command guarantee; host/WASM use memory implementations and the Nano will use NVS.

The supported builds are:

- host compiler for fast deterministic tests;
- Emscripten for the `packages/game-core-wasm` browser binding;
- PlatformIO for the Nano ESP32 application.

Web and firmware outputs should be trace-equivalent after documented diagnostic fields are removed.

## Dependency direction

```text
apps ───────────────► packages/game-core-wasm ──► compiled core
apps ───────────────► packages/mlb-live-feed ───► packages/protocol
apps ───────────────► packages/apple-3d
apps ───────────────► packages/scoreboard-ui
Virtual demo UI ─────► packages/web-debug
all adapters ───────► packages/protocol
native/WASM/Nano ───► packages/test-fixtures
firmware adapters ──► firmware/lib/core
edge cache ─────────► upstream transport only
```

The arrows must never point from the core toward a framework or device adapter.

## Game-data flow

1. Select all Mets games by team ID and preserve a separate context for each `gamePk`.
2. Bootstrap an authoritative snapshot and seed the event ledger without replaying history.
3. Request bounded incremental windows using the last accepted upstream cursor and a current end timecode.
4. Accept direct or wrapped RFC 6902 patch batches and full updates defensively.
5. Normalize score, inning, outs, status, batting side, review state and completed plays.
6. Reject regression, duplicates, wrong-game inputs and incomplete evidence.
7. Persist accepted cursor/event state before issuing commands.
8. Render display and motion through replaceable ports.

`packages/mlb-live-feed` owns the bounded browser transport and normalization shared by Apple Lab and Virtual Apple. Apple Lab exposes it as a developer-only recording source; Virtual Apple automatically checks the schedule and starts it only for an active game. Both request `diffPatch` after bootstrap, fall back to a full feed for an unrecognized patch shape, preserve valid state transitions even when MLB reuses the payload timestamp, and pass normalized evidence into the compiled C++ core. Neither has a local-device command adapter, and automated tests never make live requests.

The package is divided by responsibility:

- `transport.ts` owns abort propagation, the internal deadline, status handling, streaming byte limits, and JSON decoding;
- `jsonPatch.ts` owns RFC 6902 application and rejects prototype-mutating path tokens;
- `feedPayload.ts` identifies full feeds and accepted patch envelopes;
- `feedNormalization.ts` converts an authoritative feed into versioned snapshots and evidence;
- `client.ts` owns bootstrap/diff cursor state and full-feed fallback;
- `schedule.ts`, `historical.ts`, and `timecode.ts` own their corresponding read-only discovery concerns;
- `index.ts` is a compatibility barrel and contains no transport or game rules.

Apple Lab can also index MLB archive timestamps after an explicit operator action. Bookmark discovery is navigation metadata only: the archived update must still pass through the normalizer and compiled C++ core before any home-run or win receipt appears. It is a standard internal Apple Lab source with no device-command path.

## Browser module boundaries

`@apple/apple-3d` keeps assembly loading, Lab lighting, outfield scenery, procedural textures, stadium-board drawing, and stage orchestration separate. `AppleStage` composes those pieces and owns no game-decision rules. The stadium video board uses a canvas drawing module; the React/Three component only manages texture lifetime and animation scheduling.

Virtual Apple's `App` composes focused radio, upcoming-game, Gameday, confetti, audio, live-controller, and presentation modules. Apple Lab follows the same pattern with a small manager shell, reusable timeline/export components, and one module per workspace. Stylesheets are ordered imports split along those feature boundaries so the cascade remains explicit without a monolithic app stylesheet.

The live browser controller is the only bridge from normalized inputs to compiled C++ decisions. It translates emitted commands into browser-only celebration and position targets; presentation components do not reinterpret home-run, review, win, deduplication, or sequence rules.

## Motion boundary

The core emits intent such as `MOTION_EXTEND`, `MOTION_RETRACT` and `MOTION_DISABLE`. The ESP32 adapter owns pins, H-bridge direction, end behavior, timers and watchdog interaction. Apple Lab records the same commands and animates a dimensioned 3D model; it never toggles real GPIO.

## Device fixture execution

Each Simulator scenario carries a separate versioned `DeviceFixtureDefinition` containing normalized input envelopes and fake monotonic offsets—not motor commands. The same definition is evaluated by WASM now and will be accepted by a future Nano fixture runner.

An on-device **Logic recording** run executes every fixture with display/motion ports replaced by recorders. A **Physical** run executes the same inputs but requires an authenticated local session, an expiring maintenance lease, confirmed home position, idle motion, and suspended live automation. The firmware remains the decision authority in both modes; Apple Lab never sends a raw “raise now” instruction for a game scenario.

## Public-site hosting

Virtual Apple is a static application. A small edge Worker may normalize allowed request paths, cache by URL for the upstream wait interval and cap response size/time. It retains no device secrets and is not a general proxy. If it fails, the site freezes the last confirmed state and retries according to the bounded transport policy; local debug fixtures are not a production fallback.
