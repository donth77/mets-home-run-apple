# Apple Lab

Apple Lab is the local workshop for builders and maintainers. It can inspect live game data, replay completed games, run controlled scenarios, and eventually connect to a physical Apple for telemetry and guarded tests. The device remains autonomous when the Lab is closed.

Apple Lab is not the owner's everyday setup page. The planned **Apple Manager** will be a smaller, phone-friendly interface served directly by each physical Apple for Wi-Fi setup, track uploads, settings, status, and firmware updates.

```bash
pnpm dev:lab
```

Open [http://localhost:4173](http://localhost:4173).

## Workspaces

| Workspace | What it is for |
| --- | --- |
| Overview | Device, game, and safety health |
| Live Game | A read-only event timeline and opt-in MLB feed recorder |
| Historical Replay | Playback of completed MLB games through the C++ core |
| Simulator | Fast, repeatable test scenarios |
| Hardware Tests | Future armed and time-limited service controls |
| Diagnostics | Telemetry and the event ledger |
| Settings | Development defaults and future paired-device inspection |

## What works without hardware

Live Game and Historical Replay never contact MLB just because their page opened. Choose a date or start a recording to make a request. Incoming JSON is normalized first; only the compiled C++ core can accept a home run or win.

To replay a completed game:

1. Open **Historical Replay** in the sidebar.
2. Discover games for a date.
3. Choose a game and load its archive.
4. Use play, pause, speed, stepping, and event bookmarks to inspect it.

Seeking backward resets and bootstraps the core, so revisiting an old home run cannot create a new celebration. The workspace shows normalized state, command receipts, and a bounded delivery log. It is always available in Apple Lab and needs no query flag.

Simulator scenarios also pass through the real C++ decision code. The browser records the commands it would have sent, but it cannot move hardware. **Run on device** stays disabled until an authenticated Nano ESP32 connection exists.

The Simulator previews the 320 x 240 physical screen alongside the selected audio slot, LED state, and actuator sequence. Home-run, grand-slam, and Mets-win frames come from the same portable C++ renderer compiled for the Nano; ordinary screen layouts consume the structured display snapshot while the planned C++ game-state migration remains behind an archived-feed parity gate. Browser audio remains opt-in.

Timeline tables are filtered and paginated, with 5, 10, and 25-row page sizes. CSV exports include every row matching the filter, not only the current page. They include browser-local, IANA-zone, and UTC timestamps and neutralize spreadsheet-formula prefixes.

## Physical-device boundary

The current device adapter is a fake. A future connection will pair with a Nano on the same local network, fetch a status snapshot, and subscribe to authenticated live telemetry. The Nano can keep a bounded event and fault ledger so the Lab can recover useful history after reconnecting; it does not need to store every animation frame or rapid sensor sample.

Telemetry is optional and only runs while Apple Lab is connected. The normal development setup is a local `pnpm dev:lab` session on the same network as the Apple—no hosted Lab or cloud relay is required. A public HTTPS deployment is not the preferred path because browsers may block it from connecting to a local HTTP device.

A physical test will require a confirmed home position, paused live automation, an idle sequence, and an expiring maintenance lease from the firmware. Apple Lab will never be the source of truth for autonomous game tracking, and it will not expose unrestricted motor controls.

## Apple Manager boundary

Apple Manager and Apple Lab may share configuration contracts and small UI controls, but they serve different people. Apple Manager handles the short, safe owner workflow and is available from the device itself. Apple Lab keeps historical replay, feed inspection, debug traces, simulator controls, and advanced diagnostics. Neither interface makes celebration or motion-safety decisions for the Nano.

## Code layout

The app shell stays small. Shared manager components live in `src/managerComponents.tsx`, workspaces live in `src/workspaces/`, and feature styles live in `src/styles/`. New feed or device connections should enter through workspace hooks and adapters instead of adding transport logic to `App.tsx`.
