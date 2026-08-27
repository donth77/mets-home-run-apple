# Browser apps

Apple Lab and Virtual Apple share the same core and 3D Apple, but they serve different people.

| App | For | Default data | Hardware access |
|---|---|---|---|
| Apple Lab | The builder | Fake device and offline fixtures | None today |
| Virtual Apple | Mets fans | Live schedule and game feed | None |

## Apple Lab

Start it from the repository root:

```bash
pnpm dev:lab
```

Open `http://localhost:4173`.

Apple Lab has seven workspaces:

- **Overview** — device, game, feed, power, and safety at a glance
- **Live game** — read-only device history or an opt-in MLB recording session
- **Historical replay** — step through a completed game
- **Simulator** — run offline scenarios with fake time and a 3D preview
- **Hardware tests** — preview the guarded service workflow
- **Diagnostics** — inspect telemetry and accepted event IDs
- **Settings** — preview future local-device configuration

The current manager uses a fake device. Live MLB and historical data are fetched only after you choose a game and start the tool. Updates still go through the compiled C++ core, and any resulting commands are shown as receipts rather than sent to hardware.

History and trace tables can be filtered, paged, and exported as CSV. Exports include the browser's local time, its timezone, and the original UTC time.

When real device management is added, the Nano will stay authoritative. Closing Apple Lab must never stop live tracking, and service controls will need a firmware-approved maintenance session.

## Virtual Apple

Start it in another terminal:

```bash
pnpm dev:virtual
```

Open `http://localhost:4174`.

Virtual Apple checks the Mets schedule when it loads. Between games it shows upcoming matchups. During a game it follows the live feed, sends normalized updates through the C++ core, and presents the result with:

- a compact scorebug and stadium line score;
- the 3D Apple and center-field scene;
- home-run and Mets-win board animations;
- review, challenge, delay, rain, final, and offseason states;
- opt-in scene audio and an official radio companion.

The local demo bar is available at `http://localhost:4174/?demo=1`. It is removed from production builds and cannot be enabled from a public hostname.

The public app has no diagnostics, device controls, or raw feed tools. Production builds are static files and do not include source maps.

## Shared packages

- `@apple/game-core-wasm` runs the C++ decisions in a browser.
- `@apple/mlb-live-feed` handles schedules, live updates, and replay archives.
- `@apple/apple-3d` renders the Apple and both scenes.
- `@apple/scoreboard-ui` renders the accessible scorebug.
- `@apple/protocol` keeps data shapes consistent.
- `@apple/test-fixtures` supplies offline scenarios.
