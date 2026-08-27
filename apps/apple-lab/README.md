# Apple Lab

Apple Lab is the local workshop for the Home Run Apple. It can inspect live game data, replay completed games, run controlled scenarios, and eventually manage a physical Apple on the same network. The device remains autonomous when the Lab is closed.

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
| Settings | Future device configuration |

## What works without hardware

Live Game and Historical Replay never contact MLB just because their page opened. Choose a date or start a recording to make a request. Incoming JSON is normalized first; only the compiled C++ core can accept a home run or win.

To replay a completed game:

1. Open **Historical Replay** in the sidebar.
2. Discover games for a date.
3. Choose a game and load its archive.
4. Use play, pause, speed, stepping, and event bookmarks to inspect it.

Seeking backward resets and bootstraps the core, so revisiting an old home run cannot create a new celebration. The workspace shows normalized state, command receipts, and a bounded delivery log. It is always available in Apple Lab and needs no query flag.

Simulator scenarios also pass through the real C++ decision code. The browser records the commands it would have sent, but it cannot move hardware. **Run on device** stays disabled until an authenticated Nano ESP32 connection exists.

Timeline tables are filtered and paginated, with 5, 10, and 25-row page sizes. CSV exports include every row matching the filter, not only the current page. They include browser-local, IANA-zone, and UTC timestamps and neutralize spreadsheet-formula prefixes.

## Physical-device boundary

The current device adapter is a fake. A future physical test will require a confirmed home position, paused live automation, an idle sequence, and an expiring maintenance lease from the firmware. Apple Lab will never be the source of truth for autonomous game tracking.

## Code layout

The app shell stays small. Shared manager components live in `src/managerComponents.tsx`, workspaces live in `src/workspaces/`, and feature styles live in `src/styles/`. New feed or device connections should enter through workspace hooks and adapters instead of adding transport logic to `App.tsx`.
