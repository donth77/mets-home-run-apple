<p align="center">
  <img src="docs/assets/home-run-apple-roundel.svg" width="150" height="150" alt="Home Run Apple logo" />
</p>

<h1 align="center">Mets Home Run Apple</h1>

<p align="center"><strong>An autonomous Wi-Fi Home Run Apple, a local builder's lab, and a live virtual gameday experience.</strong></p>

<p align="center">
  <a href="https://nodejs.org/"><img alt="Node.js 22.13 or newer" src="https://img.shields.io/badge/Node.js-22.13%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" /></a>
  <img alt="C++17" src="https://img.shields.io/badge/C%2B%2B-17-00599C?style=flat-square&logo=cplusplus&logoColor=white" />
</p>


This is a fan project inspired by the Home Run Apple at Citi Field. The build is designed to follow Mets games, show the score, and raise the Apple for confirmed home runs and wins.

The project separates everyday ownership from development and debugging:

- **Apple Manager** is the planned phone-friendly setup and settings page served directly by the physical Apple. It will not need a cloud service or a running PC.
- **Apple Lab** is the local simulator, replay, diagnostics, and hardware-testing tool for builders and maintainers.
- **Virtual Apple** is a [public gameday experience](https://metsapple.com/) with a 3D center-field scene, live scoreboards, radio, celebrations, and desktop Focus and Mini views. See the [Virtual Apple guide](apps/virtual-apple/README.md).

After initial setup, the physical Apple will follow games and control its display, speaker, lights, and lift on its own. Apple Manager and Apple Lab are optional while it runs.

<p align="center"><a href="https://metsapple.com/"><strong>Live Virtual Mets Apple</strong></a></p>

## Project status

Working today:

- the shared C++ core, native tests, and WebAssembly build;
- the same C++ home-run and win display animations on the Nano and in Apple Lab;
- live schedule/feed reading and completed-game replay;
- review, delay, doubleheader, win, duplicate-event, and between-game handling;
- Apple Lab's simulator, diagnostics, CSV exports, and 3D preview;
- Virtual Apple's live presentation, Focus and Mini views, local demo mode, audio, rain, and accessibility features.

Still to build:

- repeatable Nano setup with per-device identity, Wi-Fi provisioning, storage, display, audio, lighting, and motor adapters;
- the device-hosted Apple Manager, ownership transfer, and a safe signed update path;
- optional future owner claiming and remote telemetry that never replaces local management or autonomous operation;
- an approved parts list and a physical assembly, calibration, and acceptance process;
- measured, printable Apple and base files that eliminate the need for a giveaway donor;
- reference measurements and initial physical calibration after the giveaway Apple arrives;
- a complete donor-free validation build using the printable Apple and base;
- unloaded and guarded actuator tests before the Apple is attached.

The current browser apps cannot command physical hardware. When Apple Manager and Apple Lab gain device connections, the Nano will still validate every request and remain in charge of motion safety.

Physical assembly and printable-part instructions will be published after the
real build has been measured and validated.

## Quick start

You need Node.js 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm dev:lab
```

Run Virtual Apple:

```bash
pnpm dev:virtual
```

- Apple Lab: `http://localhost:4173`
- Virtual Apple: `http://localhost:4174`
- Virtual Apple demo controls: `http://localhost:4174/?demo=1`

## Architecture

Portable C++ code is split by responsibility. The planned game-state layer will become the source of truth for score, inning, runners, count, players, line score, and game status. The existing decision core receives only the evidence needed to accept a new home run or win and return safe sequence commands. Virtual Apple will stay on its current working snapshot path until archived-feed parity tests for the new layer pass. Both layers will ultimately run in native tests, browser WebAssembly, and the Nano ESP32. Apple Manager will configure and inspect the Nano over the local network; it will not run the game loop or make celebration decisions.

[Architecture guide](docs/ARCHITECTURE.md).

## Test and build

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The full test command also needs CMake, a C++17 compiler, and Emscripten. Generated WebAssembly is checked in, so normal browser development does not require rebuilding it by hand.

## Repository structure

| Path | What lives there |
|---|---|
| `apps/apple-lab/` | Local simulator, historical replay, diagnostics, and hardware tests |
| `apps/virtual-apple/` | Public game-day website |
| `firmware/` | Shared C++ core, native tests, autonomous ESP32 adapters, and the future device-hosted Manager |
| `hardware/` | Physical parts list and per-unit build record |
| `packages/apple-3d/` | Apple model, scene, textures, and actuator animation |
| `packages/device-display-wasm/` | Browser wrapper around the C++ physical-display animations |
| `packages/game-core-wasm/` | Browser wrapper around the C++ core |
| `packages/mlb-live-feed/` | Schedule, live-feed, and archive handling |
| `packages/protocol/` | Game, core, display, event, and motion contracts |
| `packages/scoreboard-ui/` | Reusable accessible scoreboard |
| `packages/test-fixtures/` | Offline game scenarios |


## Inspiration and credit

Special thanks to Reddit user [u/jboogie1844](https://www.reddit.com/user/jboogie1844/) for sharing his WiFi Home Run Apple in [this r/NewYorkMets post](https://www.reddit.com/r/NewYorkMets/comments/1v96vfz/1_year_later_and_my_wifi_home_run_apple_has/).
