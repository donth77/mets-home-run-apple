# Physical Apple firmware

This directory contains the shared decision-making code and the first Nano ESP32
target for the Home Run Apple. The full device firmware is still being built.

The physical build is intended to be reproduced for other owners. Assembly
instructions will be published after the parts and completed build are measured
and validated.

## Current status

Working today:

- the game and celebration rules;
- the timed raise, hold, and lower sequence;
- safety checks for bad, old, duplicated, or unconfirmed game events;
- automated tests that run without physical hardware;
- the home run celebration renderer for the display, with native tests;
- the Mets-win renderer and live USB display states for upcoming, live, review, delay, rain delay, suspended, postponed, cancelled, final, and offseason games;
- a USB-only Nano ESP32 diagnostic build that keeps the future motor pins low,
  checks the board and radio, and proves that the C++ core links on the device.

Still to build:

- the portable C++ game-state projection shared with browser WebAssembly;
- autonomous Wi-Fi setup and game updates;
- saved settings and event history;
- the complete physical display, audio, and lighting adapters;
- motor, end-stop, and power controls;
- a device-hosted Apple Manager for local setup, tracks, settings, status, and updates;
- optional local Apple Lab telemetry and guarded hardware tests;
- per-device identity, ownership, and recovery;
- sleep and recovery behavior.

## What the shared code does

The shared code receives a small game update and decides whether a celebration should begin. It supports doubleheaders, ignores plays that happened before startup, and waits for reviews to finish before accepting a home run.

Before starting movement, it records the accepted event so a restart cannot trigger the same celebration again. The current tested sequence waits two seconds, raises the Apple 50 mm, holds it for 30 seconds, and lowers it.

If time moves backward, storage fails, or movement takes too long, the sequence stops and records what went wrong.

The canonical game-state layer is the next shared C++ boundary. It will own the
score, inning, situation, players, line score, review/delay/final disposition,
venue, and scheduled start needed by both the physical and virtual Apples. That
state remains separate from the smaller motion-decision input. Virtual Apple
will switch only after the new layer is implemented and archived fixtures prove
parity with its current path.

## Why hardware code stays separate

The shared rules do not know how to join Wi-Fi, draw a screen, save to a particular chip, or power a motor. The Nano firmware will provide those hardware-specific pieces.

Keeping them separate lets Apple Lab, Virtual Apple, automated tests, and the physical device follow the same celebration rules. The Nano still makes the final decision about whether physical movement is safe.

## Autonomous device and local management

The finished Nano firmware will run the game loop and every physical output by itself. Apple Manager will be a small website packaged with and served by the Nano. An owner can open it from a phone to provision Wi-Fi, upload audio to the microSD card, change celebration settings, inspect status, and install updates. Closing the page cannot pause game tracking or interrupt a celebration.

Apple Lab is a separate builder tool. It may pair with a Nano on the same network for optional live telemetry, diagnostics, and guarded tests, but the Lab does not need to be deployed or left running. The Nano will keep a bounded local event and fault history for later inspection.

No cloud dashboard is required. Any future remote access must remain optional and cannot replace local setup, local recovery, or device-side game decisions.

## Run the firmware tests

From the repository root, run:

```bash
pnpm test:native
```

## Home run celebration on the display

`lib/home_run_loop` renders the home run celebration for the 320 x 240 panel
without any hardware dependency: baked pixel-art frames for the flash, ball,
diamond and base path, then a live text sequence (rings, entrance, hold, exit,
wipe) shown once for HOME RUN or GRAND SLAM and once for the batter's name.
Every loop re-rolls the entrance, hold and exit from a small library, and the
name never repeats the headline's picks within a loop. The native tests
exercise every combination.

The frames, timing tables and fonts are generated headers under
`lib/home_run_loop/include/apple/display/generated/`. The committed font is
Pixel Operator 8 Bold (CC0, `assets/fonts/pixel-operator/`). A maintainer may
generate `home_run_font.local.hpp` from a font that is licensed for use but not
for redistribution; that file is gitignored and picked up automatically. Never
publish binaries built with a local font.

Preview it on the panel with the display test build:

```bash
pio run -e nano_esp32_display_test --target upload
pio device monitor --baud 115200
```

Send `3` to start the loop, `g` to toggle GRAND SLAM, `b` to cycle demo
batters of increasing length, `s` to switch the SPI clock (80 MHz default,
40 MHz for wiring that objects), and `a` to resume the automatic page cycle.
If the board ever wedges silently, build and flash
`nano_esp32_display_test_hwcdc` instead: same page, but the console is the
S3's hardware USB port, so panics print a backtrace and the board reboots.
Each loop prints the picks it rolled and its frame timing, e.g.
`HOME_RUN_LOOP=2 headline=slide/glint/twirl name=drop/wave/spin` and
`HOME_RUN_TIMING frames=… render_avg_us=… push_avg_us=… pushed_pct=…`.

The batter's name is fitted, not truncated: up to three lines with separate
whole-number width and height scales, so a long name fills the screen in a
condensed face instead of shrinking to ×1 (`HOME_RUN_BATTER=CHRISTOPHER|
ENCARNACION-|STRAND scale=2x3`). Both targets redraw only when the picture
can change (`HomeRunLoop::render_key`) and push only the rectangle that did
(`render()` returns it). The module has no tearing-effect pin, so celebration
frames go out through `apple::firmware::ScanLockedPanel`: the frame is pushed
in the panel's own gate-line order at its own line rate (39 Hz, 12-bit colour
while locked), which keeps the write and the refresh from ever crossing. In
the display test `k` switches that off for comparison, `m` flips the refresh
direction and `[` / `]` trim the line clock if a panel's oscillator is off.

Page `4` is the Mets win loop (`lib/home_run_loop/src/mets_win_loop.cpp`):
the roundel with fireworks, METS WIN! on its own, then the final card. `w`
cycles demo finals; each loop prints `MW_LOOP=…` with its logo / words / card
picks. Both loops share the text engine (`text_engine.cpp`).

The USB live-display prototype accepts `@CELEBRATION|HOME_RUN|JUAN SOTO|<key>`
(or `GRAND_SLAM`) and `@CELEBRATION|METS_WIN|NYM|6|ATL|3|<key>` (scoreboard
order; the line whose code is `NYM` is drawn as the Mets) and shows the loop
for the core's lead-in plus raised dwell before returning to the scoreboard;
`@CELEBRATION|END` stops it early. The host bridge sends one per new Mets home
run and one when a game goes final with the Mets ahead; `--test-celebration
NAME`, `--test-mets-win NYM 6 ATL 3` and `--replay-win` exist for rehearsals.
Motion stays disarmed in both targets.

## Run the disarmed Nano diagnostic

Connect only the Nano ESP32 over USB. Do not connect the motor driver, actuator,
display, or 12 V power while running this first check.

With PlatformIO installed, build and upload the diagnostic from this directory:

```bash
pio run -e nano_esp32_usb_diagnostics
pio run -e nano_esp32_usb_diagnostics --target upload
pio device monitor --baud 115200
```

The serial output ends with `DIAGNOSTIC_RESULT=PASS` after the board, shared core,
and Wi-Fi scanner initialize. Network names are deliberately omitted. The D4,
D5, and D6 outputs remain low and are reasserted on every loop. Send `d` in the
serial monitor to run the checks again without reflashing the board.

These tests use a simulated clock, storage, and motor. Before the real Apple is attached, the physical motor code must be tested without a load using measured travel limits and working switches at both ends of its travel.
