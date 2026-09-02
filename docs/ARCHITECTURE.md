# Architecture

![Mets Home Run Apple architecture](assets/architecture.svg)

The diagram shows the target architecture. The decision core, game-state
foundation, and portable celebration renderer work today. Both browser apps
use the shared state path; Nano integration and Apple Manager are still planned.

## Components

| Name | What it does | Must stay open? |
| --- | --- | --- |
| C++ game state | Keeps the shared score, situation, players, line score, and game status | Used by Apple Lab recording/replay and Virtual Apple live games; Nano integration is next |
| C++ decision core | Accepts celebrations and guards the motion sequence | Runs wherever it is compiled |
| Physical Apple | Follows games and controls its display, speaker, lights, and lift | Yes; it is the autonomous device |
| Apple Manager | Handles owner setup and settings from a page served by the Nano | No |
| Apple Lab | Simulates games, replays history, diagnoses, and runs guarded tests | No |
| Virtual Apple | Presents a public 3D gameday experience | No connection to physical hardware |

## Three interfaces, three jobs

**Apple Manager** is the owner's local interface. Its static files will be
packaged with the firmware and served directly by the Nano ESP32. On first boot,
the Nano creates a temporary setup network; afterward the Manager is available
on the home network. It handles Wi-Fi, audio uploads, celebration settings,
device status, and firmware updates. It is not a cloud dashboard.

**Apple Lab** is the builder's workshop. It keeps the simulator, historical
replay, feed inspection, diagnostics, and advanced hardware tests out of the
simpler owner interface. It runs locally on a development computer.

**Virtual Apple** is the public website. It shares game rules and presentation
components where useful, but it cannot discover or command a physical Apple.

## Game data and decisions

Virtual Apple reaches the MLB Stats API through a narrow same-origin edge relay.
The relay removes a fragile cross-origin hop for mobile browsers, briefly shares
identical responses at Cloudflare's edge, and falls back to direct MLB access if
needed. It has no database and does not make game decisions.

The shared C++ projector accepts one normalized MLB update and produces two
projections:

- `gameSnapshot` has the score, inning, outs, runners, count, batter, pitcher,
  status, venue, scheduled start, and line score. Scoreboards and physical
  display code read it.
- `coreInput` has only the facts the decision core needs to decide whether a
  celebration should start and whether motion should change.

Browser and firmware transports fetch and decode MLB JSON in the way that fits
their platform. They pass extracted feed facts to the same portable C++
game-state layer. Native tests cover validation and stale-field cleanup, while
WebAssembly parity tests compare live, changeover, pregame, and final
projections with the established TypeScript output. A historical transport fixture also
checks the live-to-home-run-to-final transport path. Apple Lab's recording and
historical replay and Virtual Apple's live feed now use the C++ projection.
Virtual Apple keeps the TypeScript projection only as a parity oracle while the
migration settles; it is no longer the production default for that app.

The decision core returns celebration events and extend, retract, or disable
commands. It does not build a scoreboard, choose screen text, play sound,
control lights, or drive hardware directly.

`CELEBRATION` is a temporary output state, not an MLB game state, so it never
goes back into the core. The physical firmware turns the accepted event into a
coordinated display, audio, light, and lift sequence. The physical screen
receives a smaller `DeviceDisplayState` made from `gameSnapshot`; firmware owns
its 320 x 240 layout. The celebration renderer is also portable C++: the Nano
draws it directly and Apple Lab uses the same code through WebAssembly.

The two Apples share the underlying score, inning, outs, runners, count, batter,
and pitcher. Virtual Apple keeps the browser-only extras: long play descriptions,
the full line score with hits and errors, team artwork and colors, schedule
links, radio, the stadium scene, visual effects, and browser accessibility
controls. None of those extras can change a motion decision.

## Autonomous operation

The Nano owns live polling, saved settings, event history, output timing, and
motion safety. Once Wi-Fi is configured, it does not need Apple Manager, Apple
Lab, a PC, or a hosted service. Closing a browser cannot stop polling or
interrupt an active celebration.

Losing internet access prevents new game updates, but the device remains safe,
shows an honest offline state, and retries on its own. Losing the local browser
connection has no effect at all. Settings are validated and saved on the device
before they become active.

## Local management and telemetry

Apple Manager uses same-origin requests because its page and API both come from
the Nano. This keeps first-time setup phone-friendly and avoids a permanent
external dependency.

Apple Lab's USB bench connection is intentionally narrow: it recognizes only
the guarded commissioning firmware profiles, reads their versioned serial state,
and after physical-presence confirmations can request one bounded action per
arm: the no-power signal self-test, a single short actuator jog, or one
engine-driven celebration sequence on the commissioning build. The Nano owns
every deadline, auto-stop, and fault; the browser never holds a raw motor
command. Full telemetry remains optional. After explicit local pairing, the Lab will
fetch one status snapshot from the Nano and subscribe to authenticated updates
over WebSocket or server-sent events. Telemetry can include the current screen,
audio track and fade, LED pattern, motion phase, feed freshness, storage health,
faults, and safe-command receipts.

The Nano keeps a bounded, sequence-numbered event and fault history so Apple Lab
can catch up after reconnecting. Rapid animation and sensor samples are live
only. The Lab normally runs from `localhost` on the same network and does not
need to be deployed. A public HTTPS copy is not the preferred connection path
because browsers may block it from reaching a local HTTP device.

Neither interface gets unrestricted motor controls. Movement tests require the
firmware to confirm a safe state, physical presence, and a short-lived
maintenance session.

## Celebrations while the game continues

MLB polling does not pause when a celebration starts. The core saves each newly
confirmed event and queues consecutive home runs in order. The active
celebration keeps its own scoreboard snapshot until its complete raise, hold,
and lower sequence ends; ordinary pitch updates continue in the background.
The next queued celebration then starts, or the scoreboard catches up to the
newest game state when the queue is empty.

Reviews can still hold or overturn an event before motion. Final,
completed-early, postponed, and cancelled updates wait for active and queued
celebrations to finish before the app leaves that game. Doubleheader games keep
separate MLB game IDs, so finishing game one does not consume or disarm game two.
