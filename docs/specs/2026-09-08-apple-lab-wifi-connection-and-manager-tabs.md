# Apple Lab Wi-Fi connection and Manager tabs

Date: 2026-09-08. Status: approved in conversation; implemented in the same
session.

## Why

Apple Lab is the owner's tool for the physical Apple, but until now its
Overview and Diagnostics ran on representative data and the only device link
was USB for commissioning firmware. The live firmware already exposes what the
Lab needs over the LAN: `GET /api/status` (mode, game, snapshot, sequence,
position, Wi-Fi, card and tracks, firmware slot) and `POST /api/replay?kind=`
(`hr` or `win`), which runs a recorded game through the real engine so a full
celebration — display, audio, lights, motion — plays without touching the real
event ledger. Test celebrations belong in the Lab, not in a Python script.

The Manager page has grown Audio and Update sections and no longer reads well
as one scroll.

## Apple Lab

### Reaching the Apple

Browsers will not let a page call a plain-HTTP LAN device directly without
CORS, and never from an HTTPS origin. The Lab already runs locally
(`pnpm dev:lab`, which Web Serial requires too), so the Vite dev server relays
for it: requests to `/device/*` are forwarded to the Apple, same-origin from
the browser's point of view. The Apple to use is chosen per request from an
`X-Apple-Host` header (default `home-run-apple.local`, or `APPLE_HOST` in the
environment), so the address is switchable from the UI without restarting.
The setup code travels as `X-Apple-Code`, exactly as the Manager sends it.
The relay is a small Vite plugin (`vite-apple-relay.ts`) with no dependencies
and is also installed on `vite preview`. No firmware change is needed.

### One connection, used everywhere

- `useAppleDevice()` owns the connection: address and code (remembered in
  the browser), a status poll every second while the tab is visible, a
  consecutive-failure counter that marks the link stale and then drops it,
  and `testCelebration("hr" | "win")`.
- `appleDevice.ts` is the pure layer: parse `/api/status`, map it onto the
  `ManagedDevice` shape the workspaces already render, describe the next
  game and the motion sequence, and derive timeline events from status
  transitions (celebration started/ended, fault, home again).
- The sidebar's device slot shows the Apple (name, host, sequence, RSSI) with
  the connect form; the top bar reflects it. When the Apple is not connected
  the slot falls back to the USB bench, then to "No physical device".
- Overview: the device card renders the real snapshot when a game is live,
  the upcoming game card otherwise; the position gauge animates from the
  real `positionMm`; health items become game feed, Wi-Fi, storage and
  firmware; **Test home run** and **Test Mets win** live here, enabled only
  while the sequence is `IDLE` and no fault is set, with the live sequence
  and track shown while a run is in progress.
- Diagnostics: the connection summary, telemetry (heap, PSRAM, clock, poll
  counters, update state, last celebration) and the observed timeline come
  from the Apple when connected. Reference data remains the fallback and is
  labeled as such.
- Unchanged: Hardware Tests (USB commissioning), Simulator's disabled
  "Run fixture on device" (the Apple has no endpoint that accepts external
  fixtures), and the rule that the Apple owns every safety decision.

### Errors the user sees

The Apple's own refusals are shown verbatim in the Lab: `CODE` (wrong code),
`LOCKED` (five wrong codes; wait a minute), `CELEBRATING` and `BUSY` (already
running or not settled), `NO_REPLAY`. A relay failure (host unreachable,
timeout) reads as "Apple not reachable at host".

## Manager tabs

Sections become tabs: **Apple**, **Settings**, **Audio**, **Update**. The Wi-Fi
setup flow stays a full-page state shown instead of the tabs while the Apple
has no network, so a phone on the setup hotspot is not asked to find a tab.
The tab bar sits under the header, the last tab is remembered, and a hash
(`#audio`) opens a tab directly. Section ids, form ids and the page script's
behavior do not change.

Shipped by OTA. No change to `/api/status`: it already stops echoing
`setupKey` the moment "Require code" is turned on (the page shows the code once,
at lock-on, so the owner can write it down). With the lock off, anyone on the
network could change settings anyway, so the key's presence adds no exposure.
The Lab's Diagnostics flags a lock-off Apple so the owner turns it on.

## Tests

- `appleDevice.test.ts`: parsing a captured status frame, the device mapping,
  sequence descriptions, transition events.
- `appleClient.test.ts`: request shape (paths, headers) and error mapping
  with a mocked `fetch`.
- Existing App and workspace tests keep passing with no Apple connected.
- Manager tabs previewed against `firmware/tools/manager_mock.py` in a real
  browser before the OTA.
