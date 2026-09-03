# Architecture

The Nano ESP32 runs the physical Apple. It reads the game, decides whether an
event counts, draws the screen, and controls the lift.

![Mets Home Run Apple architecture](assets/architecture.svg)

## Parts

| Part | Runs on | Job |
| --- | --- | --- |
| Physical Apple | Nano ESP32 | Follow the game, run the display, and control the lift |
| Apple Manager | Web page served by the Nano | Set up Wi-Fi, show device status, and change owner settings |
| Apple Lab | Developer's computer | Simulate games, replay history, inspect feeds, and run guarded USB tests |
| Virtual Apple | Public website and edge worker | Show the game in a 3D Citi Field scene and send optional alerts |
| Shared game code | Nano, native tests, and browser WebAssembly | Build game state, approve celebrations, and render the physical display |

## Game flow

Each platform handles MLB data. The browser rebuilds
MLB's live-feed patches. The Nano requests a smaller, field-limited feed. 

The game-state code produces two outputs:

- `gameSnapshot` contains everything needed to draw the game: score, inning,
  count, runners, players, status, and line score.
- `coreInput` contains only the evidence needed to approve or reject a home run
  or win.

The decision core returns sequence commands. In a browser those commands are
recorded or animated. Only the Nano's hardware adapter turns them into
electrical outputs.

## What each app is for

### Apple Manager

Apple Manager lives on the Nano. It handles first-time Wi-Fi setup, current
status, owner settings, restarts, and signed firmware updates, which the Apple
fetches from the project's GitHub releases on its own and installs between
games. It works on the local network and does not run the game loop.

### Apple Lab

Apple Lab is a local workshop. It contains the simulator,
historical replay, display previews, and
tests over USB. Those tests already receive live serial data. 

### Virtual Apple

Virtual Apple is the public gameday site. It uses the same game-state and
decision code, but has its own 3D scene. One edge function relays MLB requests.
A scheduled worker uses the shared decision core for opt-in push alerts and
keeps anonymous subscriptions and its event ledger in D1. It cannot discover
or control a physical Apple.

## Code map

| Path | Owns |
| --- | --- |
| `firmware/src/apple_live.cpp` | Autonomous Nano game loop |
| `firmware/lib/mlb_feed/` | Nano schedule and live-feed adapter |
| `firmware/lib/game_state/` | Canonical game snapshot and status labels |
| `firmware/lib/core/` | Celebration decisions, deduplication, and sequence safety |
| `firmware/lib/device_screens/` | Physical scoreboard and status screens |
| `firmware/lib/home_run_loop/` | Physical celebration frames |
| `firmware/lib/manager/` | Nano-hosted setup and settings page |
| `apps/apple-lab/` | Local developer tools |
| `apps/virtual-apple/` | Public browser experience |
| `edge/notifications/` | Push subscriptions, game watcher, and delivery |
| `packages/*-wasm/` | Browser wrappers around the shared C++ code |
| `packages/mlb-live-feed/` | Browser schedule, live-feed, and replay adapter |
