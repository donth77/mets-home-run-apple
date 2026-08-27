# Apple Lab

Private-by-default local manager and engineering simulator for the Home Run Apple. The manager is designed to monitor an autonomous device on the local network; the simulator provides offline fixture replay, fake time, trace inspection and dimensioned 3D motion.

```bash
pnpm dev:lab
```

The current browser slice includes seven workspaces:

- Overview for device, game and safety health;
- Live Game for a read-only device timeline plus an opt-in direct MLB recording transport;
- Historical Replay for archived MLB game playback through the canonical core;
- Simulator for deterministic fixture playback;
- Hardware Tests for explicitly armed, time-limited service controls;
- Diagnostics for telemetry and the event ledger;
- Settings for the future authenticated device configuration model.

Live Game does not contact MLB on page load. Its developer transport discovers Mets games for an operator-selected date, bootstraps the full live feed, requests bounded `diffPatch` windows using the last cursor, honors the upstream wait value and defensively accepts full-update responses and wrapped patch batches. Raw JSON is normalized into versioned inputs; only the compiled C++ core decides whether an event is accepted. Commands are displayed as in-memory receipts and cannot reach a device.

Historical Replay is an internal workspace for testing completed games between live broadcasts. Start Apple Lab at `http://localhost:4173`, choose **Historical replay** directly in the left sidebar, discover a date, select a game, and load its archive. The tool then exposes timecode stepping, play/pause/speed controls, home-run and final-state bookmarks, normalized state, C++ command receipts and a bounded delivery log. Moving backward resets and bootstraps the core so browsing old history cannot manufacture a celebration. Opening the workspace does not contact MLB; every schedule and archive request follows an explicit operator action.

Apple Lab is already the internal engineering tool, so Historical Replay requires no additional query flag. It still has no local-device command route.

Event-history views are filtered and paginated in five-row pages with 5, 10, and 25-row options. Every timeline and the Simulator trace can be exported as CSV. Timeline exports include all rows matching the active filter—not only the visible page—plus browser-local, IANA-zone, and UTC timestamps. Spreadsheet-formula prefixes are neutralized before download.

Every Simulator scenario now contains a versioned on-device input fixture. The WASM suite executes all of them through C++ today. The UI exposes future **Logic recording** and **Physical cycle** modes while **Run on device** remains disabled until an authenticated Nano transport exists. A physical run will additionally require home position, suspended live automation and an expiring firmware maintenance lease.

Physical-device transport is represented by a fake adapter for now. All service requests remain in browser memory, the simulator uses a recording-only motion adapter, and no browser code can access GPIO. The Nano remains the eventual source of truth and must continue operating when Apple Lab is closed.

The React shell is intentionally small: reusable manager components live in `src/managerComponents.tsx`, and each workspace lives under `src/workspaces/`. Live Game further separates its autonomous-device and direct-MLB views. CSS is split into ordered feature stylesheets under `src/styles/`. New device transports should enter behind hooks/adapters used by a workspace rather than adding connection or parsing logic to `App.tsx`.
