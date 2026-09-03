# Firmware

This directory contains the shared C++ game code, the Nano ESP32 firmware, and
hardware-free native tests.

The main target, `nano_esp32_apple`, follows Mets games over Wi-Fi and runs the
display on its own. It records motion commands but keeps the motor pins low.
`nano_esp32_apple_motion` uses the same code and drives the commissioned lift.

## Build and test

You need pnpm 10, CMake, and a C++17 compiler for the native tests. From the
repository root:

```bash
pnpm install
pnpm test:native
```

PlatformIO builds and flashes the Nano targets. From `firmware/`:

```bash
pio run -e nano_esp32_apple
pio run -e nano_esp32_apple --target upload
pio device monitor --baud 115200
```

Do not flash `nano_esp32_apple_motion` until the attached actuator and driver
have passed the guarded tests in Apple Lab. Disconnect 12 V before every flash
or wiring change.

## What works

- The Nano finds Mets games, follows the live MLB feed, and draws the 320 × 240
  game screens.
- Shared C++ code builds game state and approves new Mets home runs and wins.
- The lift uses a timed motion model with deadlines and a persistent ledger of
  accepted event IDs.
- Apple Manager handles Wi-Fi, status, owner settings, restarts, and signed
  firmware updates from a page served by the Nano.
- Native tests and browser WebAssembly builds run the same game rules and
  display renderer.

Production audio and lighting, autonomous current/end-stop sensing, and the
Apple Lab local-network telemetry connection are not finished.

## Safety rules

- Old, duplicate, malformed, opponent, wrong-game, and review-pending events do
  not start motion.
- The accepted event ID is saved before motion intent is exposed.
- One sequence runs at a time, and every movement has a deadline.
- A fault turns all motor outputs off and leaves motion disabled.
- Browser tools never receive raw motor controls.
- Bench motion must be unloaded, attended, and powered from a fused 12 V supply.

The shared tests use a fake clock, fake storage, and a recording motor. Passing
them does not qualify real hardware. Use Apple Lab's Hardware Tests in order
before enabling the motion build.

## Nano targets

| Target | Purpose |
| --- | --- |
| `nano_esp32_apple` | Autonomous game follower; real display, recorded motion |
| `nano_esp32_apple_motion` | Autonomous game follower with the commissioned lift enabled |
| `nano_esp32_usb_diagnostics` | Board, Wi-Fi scan, and shared-core checks over USB |
| `nano_esp32_usb_smoke` | Minimal startup, serial, and built-in LED check |
| `nano_esp32_display_test` | Physical game screens and celebrations |
| `nano_esp32_display_test_hwcdc` | Display test with lower-level USB crash output |
| `nano_esp32_live_display_usb` | Game snapshots supplied by a computer; no motion |
| `nano_esp32_motor_logic_test` | ENA/IN1/IN2 test with motor power disconnected |
| `nano_esp32_actuator_jog_test` | One 200 ms unloaded jog per arm |
| `nano_esp32_l298n_meter_test` | One 10 s output window per arm for meter readings |
| `nano_esp32_motion_commissioning` | One real decision-engine celebration per arm |
| `nano_esp32_motion_commissioning_ina219` | The same test with current sensing |
| `nano_esp32_audio_test` | microSD, amplifier, speaker, and shared-bus checks |

Every target starts with motion disabled. The commissioning targets enable the
bridge only inside a short, attended session. The autonomous motion target
enables it only for an event accepted by the decision core.

## First boot

After flashing `nano_esp32_apple`:

1. Join the **Home Run Apple** Wi-Fi network with the eight-digit code shown on
   the display.
2. If the setup page does not open, visit <http://192.168.4.1>.
3. Choose a 2.4 GHz home network and enter its password.
4. Open Apple Manager at <http://home-run-apple.local>. Android users should use
   the IP address shown after setup because Android does not resolve `.local`.

Apple Manager controls raised time, motor enable, pause, screen sleep,
brightness, time zone, and its optional password lock. Settings and Wi-Fi
credentials live in flash.

A short press of the reset button on `D3` shows the address and setup code. Hold
it for ten seconds to erase Wi-Fi and settings. If the saved network cannot be
reached, the setup network reopens after about 45 seconds.

The full owner walkthrough is at [metsapple.com/setup](https://metsapple.com/setup/).

## Live operation

The Nano chooses a live Mets game first, then the next scheduled game. It uses
certificate-checked HTTPS and follows MLB's suggested polling interval. Network
requests wait while the motor is moving and resume when the sequence ends.

Accepted celebration keys are stored in the `ledger` flash namespace, so a
reboot cannot replay them. The regular target runs the complete sequence with a
recording motor. The `_motion` target sends the same commands to the L298N.

Useful serial keys:

| Key | Action |
| --- | --- |
| `?` | Print identity and status |
| `x` | Stop motion and reset the sequence |
| `s` | Refresh the schedule |
| `p` | Poll the live feed now |
| `r` | Replay the built-in recorded game |
| `w` | Forget Wi-Fi and reopen setup |
| `i` | Show the local address and setup code |

`APPLE_LIVE:` JSON lines carry status, game frames, sequence changes, and
celebration receipts.

## Code map

| Path | Contents |
| --- | --- |
| `src/apple_live.cpp` | Autonomous Nano program |
| `lib/core/` | Celebration decisions and sequence safety |
| `lib/game_state/` | Game snapshot and status classification |
| `lib/mlb_feed/` | Nano MLB schedule and live-feed adapter |
| `lib/motion/` | Timed actuator model |
| `lib/device_screens/` | Scoreboard and status screens |
| `lib/home_run_loop/` | Home run and Mets win animations |
| `lib/manager/` | Nano-hosted setup, settings, and update page |
| `fixtures/mlb/` | Recorded MLB responses used by tests and replay |
| `test/native/` | Hardware-free C++ tests |
| `tools/` | Bench, fixture, recovery, and release scripts |

To edit Apple Manager, change `lib/manager/page/index.html` and its nearby
assets. The build runs `tools/embed_page.py`; do not edit the generated headers.
Use `python3 tools/manager_mock.py` to work on the page without a board.

The display uses Pixel Operator 8 Bold by Jayvee Enaguas. Its
[source](https://www.dafont.com/pixel-operator.font) and
[CC0 license](assets/fonts/pixel-operator/LICENSE.txt) are included.
