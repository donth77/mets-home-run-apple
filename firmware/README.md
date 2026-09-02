# Firmware

This folder contains the shared C++ code and Nano ESP32 test builds for the
Home Run Apple.

The firmware is still under development. The current Nano builds are for USB
diagnostics and display testing only. They do not drive a motor.

## What works today

- One shared C++ rules engine decides whether a new Mets home run or Mets win
  may start a celebration.
- A shared game-state layer turns MLB data into a consistent score, inning,
  game status, and display snapshot.
- Native tests and browser WebAssembly builds exercise the shared C++ layers.
  The Nano diagnostic also proves that the decision core runs on the board.
- Home run and Mets win animations run on the 320 × 240 display and in Apple
  Lab.
- A USB-only Nano diagnostic checks the board, radio, and shared C++ code while
  keeping the planned motor pins low.
- A USB live-display prototype can show game updates sent by a computer. Motion
  remains disabled.
- A timed motion model drives a two-wire actuator with internal end stops from
  the engine's commands, and a guarded commissioning build has run the full
  production sequence, lead-in, raise, 30 s dwell, lower, on the bench actuator.

The Nano does not yet follow games by itself. Wi-Fi setup, saved settings,
event history, the production motion adapter with end-stop sensing, audio,
lighting, Apple Manager, device identity, updates, and power recovery still
need to be built.

## Safety rules

The shared rules approve motion only for a newly confirmed Mets home run or
Mets win. Old, duplicate, malformed, uncertain, opponent, wrong-game, and
review-pending events do nothing.

The firmware saves the accepted event ID before it exposes motion intent. It
runs only one sequence at a time, gives every movement a time limit, and must
finish either safely home or in a disabled fault state.

Tests use a fake clock, fake storage, and a recording-only motor. Do not attach
an actuator to these builds. Real motor code must first pass an unloaded,
disarmed test with measured travel limits and working switches at both ends.

## Run the C++ tests

You need pnpm 10, CMake, and a C++17 compiler. From the repository root:

```bash
pnpm install
pnpm test:native
```

Run the complete repository test suite with:

```bash
pnpm test
```

## Nano test builds

PlatformIO provides these development builds:

| Build | Purpose | Connected hardware |
|---|---|---|
| `nano_esp32_usb_diagnostics` | Checks startup, Wi-Fi scanning, and the shared core | Nano over USB only |
| `nano_esp32_usb_smoke` | Checks basic startup, serial output, and the built-in LED | Nano over USB only |
| `nano_esp32_display_test` | Previews game screens and celebration animations | Nano and test display |
| `nano_esp32_display_test_hwcdc` | Display test with lower-level USB crash output | Nano and test display |
| `nano_esp32_live_display_usb` | Shows game snapshots received from a computer | Nano and test display |
| `nano_esp32_motor_logic_test` | Exercises ENA/IN1/IN2 for five seconds and automatically disarms | Nano, display, and USB-powered L298N logic only |
| `nano_esp32_actuator_jog_test` | One 200 ms jog per arm, then automatic stop and disarm | Nano, display, L298N, fused 12 V supply, and an unloaded attended actuator |
| `nano_esp32_l298n_meter_test` | Same protocol with a 10 s window so a multimeter can read the driver | Nano, display, L298N, and 12 V supply; actuator disconnected or unloaded and attended |
| `nano_esp32_motion_commissioning` | Runs the real celebration engine against the timed actuator model, one simulated home run per arm | Nano, display, L298N, fused 12 V supply; actuator disconnected first, then unloaded and attended |
| `nano_esp32_audio_test` | Mounts the microSD on the shared SPI bus, plays a built-in tone and a WAV fixture through the I2S amplifier, and runs the display/SD alternation check | Nano, display, ADA254 microSD breakout, MAX98357A amplifier and one speaker; 12 V unplugged |

Every target boots with motion disabled. Only the two commissioning builds can
enable the bridge, and only inside a bounded, attended window.

### Run the USB diagnostic

Connect only the Nano ESP32 over USB. Do not connect a motor driver, actuator,
display, or 12 V supply.

From `firmware/`, run:

```bash
pio run -e nano_esp32_usb_diagnostics
pio run -e nano_esp32_usb_diagnostics --target upload
pio device monitor --baud 115200
```

A successful run prints `DIAGNOSTIC_RESULT=PASS`. Wi-Fi network names are not
printed. Send `d` to run the checks again without reflashing the board.

### Preview the display

Use this only with the supported display already connected in a validated
bench setup:

```bash
pio run -e nano_esp32_display_test --target upload
pio device monitor --baud 115200
```

Useful serial controls:

- `3` starts the home run animation.
- `4` starts the Mets win animation.
- `g` switches between home run and grand slam.
- `b` changes the demo batter.
- `w` changes the demo final score.
- `a` returns to the automatic screen cycle.

If the normal display build stops without useful serial output, flash
`nano_esp32_display_test_hwcdc` to collect an ESP32-S3 crash report.

### Test the motor-driver logic without motor power

Remove the L298N `ENA` and `5V-EN` jumpers. Connect Nano `VUSB`, `GND`,
`D6`, `D4`, and `D5` to L298N `+5V`, `GND`, `ENA`, `IN1`, and `IN2`.
Leave `+12V`, `OUT1`, `OUT2`, and the actuator disconnected.

```bash
pio run -e nano_esp32_motor_logic_test --target upload
pio device monitor --baud 115200
```

The serial commands are `t` for one bounded raise/stop/lower/stop self-test,
`x` for stop, and `?` for status. The test firmware intentionally has no raw
raise or lower command. Every path returns all three outputs LOW automatically.

Versioned `APPLE_BENCH:` JSON lines identify the firmware profile and report
logic state and self-test receipts to Apple Lab. This target tests logic only
and must never be used with 12 V, OUT1/OUT2, or an actuator connected.

### Jog an unloaded actuator

Only after the logic test passes. Keep the same Nano to L298N wiring, then add
a fused 12 V supply to `+12V` and `GND` and the actuator to `OUT1` (red) and
`OUT2` (black). The actuator must be unloaded, free to move, and attended. Keep
the `ENA` and `5V-EN` jumpers removed.

Power up in this order: USB first, so the Nano boots with its outputs low, then
the 12 V supply. Unplug the 12 V supply before every flash and every wiring
change, because the pins float while the board reboots.

```bash
pio run -e nano_esp32_actuator_jog_test --target upload
python3 tools/jog.py status
python3 tools/jog.py extend
python3 tools/jog.py retract
```

`tools/jog.py` arms, sends one jog, logs every serial receipt, and always
finishes with stop-and-disarm. Use it instead of `pio device monitor`. A monitor
started from a script or an agent never exits and keeps the port open, which
splits the serial stream between readers; the tool refuses to run while another
process holds the port. If you do use the monitor, the keys are `a` to arm, `u`
to extend, `d` to retract, `x` to stop, and `?` for status. One arm authorizes
exactly one jog.

A 200 ms jog cannot move the actuator off its internal end stop. At an end stop
the actuator only conducts through the limit-switch bypass diode, and after the
L298N drop there is too little voltage for such a short pulse. Finish every
session with the actuator mid-stroke. The meter build below can do that with an
early stop, for example `python3 tools/jog.py retract --hold 4`.

### Measure the driver under load

`nano_esp32_l298n_meter_test` runs the same protocol with a 10 s window so a
handheld multimeter can settle. No-load readings prove wiring, not the bridge:
a damaged L298N can read full voltage into a meter and 0 V into the actuator.

1. Actuator disconnected, meter across `OUT1` and `OUT2`, one `extend`. Expect
   the supply voltage minus about 0.2 V.
2. Actuator connected, unloaded, mid-stroke, attended. Same reading. Expect the
   supply voltage minus 1 to 3 V, and ten seconds of travel.
3. If step 2 reads near 0 V, meter the `+12V` terminal during another jog. If it
   holds, the bridge is dead and the module gets replaced.

Reflash the jog build afterward so the bench returns to the 200 ms window.

### Run the engine-driven motion sequence

`nano_esp32_motion_commissioning` runs the shared celebration engine with its
production lead-in, motion deadlines, and raised dwell against the timed
actuator model in `lib/motion`. The model drives the bridge for the measured
full-stroke time plus an overrun in each direction, so the actuator's internal
end stops are reached from any position and no position feedback is needed.
The reference profile in `lib/motion` records the bench measurement: about
5.1 s to extend and 5.0 s to retract from an 11 V pack, rounded up.

Run it first with the actuator disconnected from `OUT1` and `OUT2` and watch
the receipts and the pins, then with the actuator unloaded, mid-stroke or home,
and attended. One arm authorizes one run.

```bash
pio run -e nano_esp32_motion_commissioning --target upload
pio device monitor --baud 115200
```

`nano_esp32_motion_commissioning_ina219` is the same build with an INA219
current sensor on the fused 12 V lead (I2C on `A6`/`A7`). The model then
confirms arrival early when the motor current collapses at an end stop and
latches a stall fault if the current stays high; without the sensor it falls
back to the timed drive.

Serial keys: `a` arms for 60 s, `h` starts one simulated Mets home run, `x`
stops the bridge and resets the engine, `?` prints status. From a script,
`python3 tools/jog.py homerun` arms, starts one run, and logs the receipts
until the run completes, faults, or is stopped. A run must end with
`run` status `COMPLETED` and the sequence back at `IDLE`; a deadline miss
latches a fault and the bridge stays off. Versioned `APPLE_MOTION:` JSON lines
carry the hello, state, traces, and run receipts to Apple Lab.

For the acceptance soak, `python3 tools/soak.py --cycles 25 --cooldown 10`
repeats the run and writes one CSV row per cycle with the run status, extend
and retract drive times, raised dwell, peak motor current when the build
reports it, and any fault. It stops at the first cycle that does not complete
and always ends with stop-and-disarm. Keep the actuator unloaded, free, and
attended for the whole run.

### Test the microSD card and the amplifier

`nano_esp32_audio_test` proves the storage and audio parts without any motor
power. Keep the 12 V supply unplugged; the motor pins stay low for the whole
session. Wire the ADA254 breakout to the shared SPI bus (`D13` clock, `D11`
data, `D12` return) with its own chip select on `A0`, powered from `VBUS` and
ground for this isolated test. Wire the MAX98357A to `A1` (BCLK), `A2` (LRC),
and `A3` (DIN) with one speaker across its bridge output and nothing to ground.

Make the fixture on the computer and copy it to the card as `/tone.wav`:

```bash
python3 tools/make_tone_wav.py /Volumes/<card>/tone.wav
```

The tool prints the file's CRC-32. Then:

```bash
pio run -e nano_esp32_audio_test --target upload
pio device monitor --baud 115200
```

Serial keys: `m` mounts the card and lists its files, `k` prints the fixture's
CRC-32 for comparison, `t` plays a one-second tone built in RAM so the
amplifier can be proven before the card, `p` plays the fixture from the card,
`s` stops, `1`, `2`, and `3` set the software gain to 10, 20, and 35 percent,
and `a` runs one hundred alternating display writes and card reads. Gain starts
at 10 percent and the build cannot exceed 35 until the accessory rail has been
qualified. Versioned `APPLE_AUDIO:` JSON lines carry the state, card listing,
checksums, playback receipts, and test results.

## Code map

- `lib/core/` owns celebration decisions and sequence safety.
- `lib/game_state/` owns the game snapshot used by displays and decisions.
- `lib/home_run_loop/` owns the home run and Mets win display animations.
- `lib/motion/` owns the timed drive model for the two-wire actuator.
- `src/` contains the Nano-specific test programs.
- `test/native/` contains hardware-free native tests.

Hardware, networking, storage, and display adapters stay outside the shared
rules. This lets native tests, browser tools, and the Nano use the same game
decisions without giving a browser control of physical motion.

## Display font

`PixelOperator8-Bold.ttf` is Pixel Operator 8 Bold by Jayvee Enaguas
(HarvettFox96). The [source release](https://www.dafont.com/pixel-operator.font)
and [CC0 license](assets/fonts/pixel-operator/LICENSE.txt) record its origin and
terms.
