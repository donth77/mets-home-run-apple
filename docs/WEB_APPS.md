# Browser Apps

Apple Lab and Virtual Apple are separate deployable applications with intentionally different presentation layers.

## Apple Lab

Apple Lab is a private-by-default local manager plus engineering surface. Its manager shell separates read-only observation from simulation and future physical service controls:

- Overview summarizes device, game, feed, Wi-Fi, power and safety health;
- Live Game mirrors state accepted by the device and also offers an explicit developer-only live recording source;
- Historical Replay exposes archived MLB game playback as a discoverable top-level workspace;
- Simulator uses a neutral grid/test plinth with orbit controls, optional wireframe rendering and a 0–50 mm recording-position override;
- Hardware Tests requires an explicit, expiring service session;
- Diagnostics exposes telemetry, safety invariants and stable event-ledger identifiers;
- Settings previews the authenticated local configuration model.

The simulator exposes:

- deterministic fixture selection;
- fake time with play, pause, frame-step, reset and speed controls;
- normalized score, inning, outs, review and game status;
- current recording commands and motion position;
- line-oriented event, ledger and adapter traces.
- a future on-device run surface with logic-recording and guarded physical modes.

It does not render the outfield by default because stadium scenery would reduce diagnostic contrast and consume screen area needed by controls. Apple Lab does not contain home-run detection rules and cannot access hardware GPIO.

The direct MLB source is inert until the operator chooses a date/game and starts it. It bootstraps a full feed, then requests bounded cursor-based diff patches at the upstream wait interval. Normalization is TypeScript transport work; event acceptance is compiled C++. Resulting commands are receipts only.

Historical Replay uses MLB's archived timecodes to exercise a completed game without waiting for a live broadcast. It supports sequential stepping, controlled playback and event bookmarks while routing every normalized update through the same C++ core. Reverse navigation resets and bootstraps the core, and selecting a bookmark only stages its preceding state until the operator runs the event. It is a standard internal Apple Lab source and requires no query flag; opening the source alone still makes no archive request.

Timeline views paginate filtered history and export all matching rows as CSV. Exports include browser-local time with its IANA timezone plus the original UTC instant. The Simulator trace uses the same reusable CSV export path.

The first manager implementation uses a fake device adapter. Its service requests are recorded in browser memory only. A physical transport must preserve the same boundary: selecting a workspace cannot change device operation, live monitoring is read-only, and service commands require a firmware-enforced authorization handshake, idle-state checks and a time-limited maintenance lease.

The manager shell only owns workspace selection and the fake service session. Shared timeline/export components and the seven workspaces live in separate modules; Live Game also keeps autonomous-device and direct-MLB views separate. A future authenticated device transport can therefore be introduced behind an adapter without expanding the shell or coupling simulator state to live monitoring.

## Virtual Apple

Virtual Apple is the presentation surface. Its fixed cinematic camera looks toward a lightweight center-field composition made from procedural Three.js geometry:

- striped grass and warning track;
- blue wall, orange rail and center-field distance marker;
- dark batter's-eye structures;
- the shared Apple/base model behind the wall.

The compact accessible scoreboard is an HTML overlay, keeping live text sharp and responsive. The stadium line scoreboard is a Three.js canvas texture used as scene artwork. The default presentation checks live schedule data, rests between games, and sends active-game evidence through the compiled C++ core. The **Demo** fixture bar can override it only when an explicit `demo` or `debug` query flag is present in local development. It is absent from production builds; raw traces, administrative device controls and manual motion overrides are intentionally absent.

Public accessibility work is concentrated in Virtual Apple. It provides a keyboard skip link, visible focus treatment, reduced-motion and forced-colors handling, responsive non-overlapping scoreboards, accessible opt-in audio controls, and a dedicated low-frequency game-status live region. That live region announces score/inning/outs and major phase changes without repeating every pitch description. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for the automated matrix and manual release checks.

## Shared implementation

Both apps import:

- `@apple/apple-3d` for the model loader, runtime decal, actuator animation and scene modes;
- `@apple/scoreboard-ui` for score, inning and outs;
- `@apple/protocol` for versioned snapshots and commands;
- `@apple/test-fixtures` for deterministic offline scenarios.
- `@apple/game-core-wasm` where a browser must evaluate normalized game evidence.
- `@apple/mlb-live-feed` for bounded MLB schedule/feed transport and normalization.
- `@apple/web-debug` for Virtual Apple's development-build, loopback-host and query-flag gate.

Synthetic presentation frames still contain snapshots and expected UI commands for deterministic rendering. Each scenario additionally contains normalized device inputs; compiled C++ evaluates those inputs independently and the suite checks the expected motion count. The presentation commands are never uploaded to firmware.

## Development

From the repository root:

```bash
pnpm install
pnpm dev:lab
pnpm dev:virtual
```

Run each development command in its own terminal. Use `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before committing browser changes. Production builds do not emit source maps by default.
