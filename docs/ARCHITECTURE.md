# Architecture

![Mets Home Run Apple architecture](assets/architecture.svg)

## Components

| Name | What it does |
|---|---|
| Shared C++ core | Makes the game and celebration decisions  |
| Apple Lab | Simulate games, replay past games, diagnose, and configure a physical Apple |
| Virtual Apple | Follow games live with a 3D Apple, scoreboards, sound, and celebrations |
| Physical Apple | Uses a Nano ESP32 to follow games, update its display, and control the motor |

## Game data and decisions

Each MLB update is read once and split into two parts:

- `gameSnapshot` has the score, inning, outs, runners, count, batter, pitcher, status, and line score. Scoreboards and display code read it.
- `coreInput` has only the facts the C++ core needs to decide whether a celebration should start and whether motion should change.

The core returns celebration events and extend, retract, or disable commands. It does not build a scoreboard, choose screen text, play sound, or control hardware directly.

`CELEBRATION` is a temporary screen state, not an MLB game state, so it never goes back into the core. The physical screen receives a smaller `DeviceDisplayState` made from `gameSnapshot`; firmware owns its 1.96-inch layout.
