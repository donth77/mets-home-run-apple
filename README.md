<p align="center">
  <img src="docs/assets/home-run-apple-roundel.svg" width="150" height="150" alt="Home Run Apple logo" />
</p>

<h1 align="center">Mets Home Run Apple</h1>

<p align="center"><strong>A Home Run Apple, hardware lab, and a live gameday website.</strong></p>

<p align="center">
  <a href="https://github.com/donth77/mets-home-run-apple/actions/workflows/ci.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/donth77/mets-home-run-apple/ci.yml?branch=main&style=flat-square&label=checks&logo=githubactions&logoColor=white" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.13 or newer" src="https://img.shields.io/badge/Node.js-22.13%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" /></a>
  <a href="https://pnpm.io/"><img alt="pnpm 10" src="https://img.shields.io/badge/pnpm-10-F69220?style=flat-square&logo=pnpm&logoColor=white" /></a>
  <img alt="C++17" src="https://img.shields.io/badge/C%2B%2B-17-00599C?style=flat-square&logo=cplusplus&logoColor=white" />
</p>

This is a fan project inspired by the Home Run Apple at Citi Field. The build is designed to follow Mets games, show the score, and raise the Apple for confirmed home runs and wins.

The repository also includes two browser apps:

- **Apple Lab** is the local manager, simulator, and replay tool used for physical Apple.
- **Virtual Apple** is a public gameday experience with a 3D center-field scene, live scoreboards, upcoming games, radio, and celebrations.

## Project status

Working today:

- the shared C++ core, native tests, and WebAssembly build;
- live schedule/feed reading and completed-game replay;
- review, delay, doubleheader, win, duplicate-event, and between-game handling;
- Apple Lab's simulator, diagnostics, CSV exports, and 3D preview;
- Virtual Apple's live presentation, local demo mode, audio, rain, and accessibility features.

Still to build:

- the Nano ESP32 networking, display, storage, provisioning, and motor adapters;
- authenticated local device management and a safe update path;
- final physical calibration after the giveaway Apple arrives;
- unloaded and guarded actuator tests before the Apple is attached.

The browser apps cannot command physical hardware. The Nano will remain in charge once the hardware layer is added.

## Quick start

You need Node.js 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm dev:lab
```

Run Virtual Apple in a second terminal:

```bash
pnpm dev:virtual
```

- Apple Lab: `http://localhost:4173`
- Virtual Apple: `http://localhost:4174`
- Virtual Apple demo controls: `http://localhost:4174/?demo=1`

To replay a completed game, open Apple Lab and choose **Historical replay**. Nothing is fetched until you choose a date and game.

## Architecture

One C++ core owns event decisions and sequence safety. It runs in native tests, in both browser apps through WebAssembly, and eventually on the Nano ESP32. The optional edge Worker can cache public feed requests, but it never decides whether the Apple should move.

Read the [architecture guide](docs/ARCHITECTURE.md).

## Check your work

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The full test command also needs CMake, a C++17 compiler, and Emscripten. Generated WebAssembly is checked in, so normal browser development does not require rebuilding it by hand.

## Repository guide

| Path | What lives there |
|---|---|
| `apps/apple-lab/` | Local manager, simulator, and historical replay |
| `apps/virtual-apple/` | Public game-day website |
| `firmware/` | Shared C++ core, native tests, and future ESP32 adapters |
| `packages/apple-3d/` | Apple model, scene, textures, and actuator animation |
| `packages/game-core-wasm/` | Browser wrapper around the C++ core |
| `packages/mlb-live-feed/` | Schedule, live-feed, and archive handling |
| `packages/protocol/` | Shared snapshots, inputs, commands, and identifiers |
| `packages/scoreboard-ui/` | Reusable accessible scoreboard |
| `packages/test-fixtures/` | Offline game scenarios |
| `edge/mlb-feed-cache/` | Optional public-site request cache |


## Inspiration and credit

Special thanks to Reddit user [u/jboogie1844](https://www.reddit.com/user/jboogie1844/) for sharing his WiFi Home Run Apple in [this r/NewYorkMets post](https://www.reddit.com/r/NewYorkMets/comments/1v96vfz/1_year_later_and_my_wifi_home_run_apple_has/).