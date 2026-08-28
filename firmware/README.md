# Physical Apple firmware

This directory contains the shared decision-making code and the first Nano ESP32
target for the Home Run Apple. The full device firmware is still being built.

The physical build is intended to be reproduced for other owners. See the [Physical build guide](../docs/PHYSICAL_BUILD.md) for the parts, assembly, calibration, and acceptance process.

## Current status

Working today:

- the game and celebration rules;
- the timed raise, hold, and lower sequence;
- safety checks for bad, old, duplicated, or unconfirmed game events;
- automated tests that run without physical hardware;
- a USB-only Nano ESP32 diagnostic build that keeps the future motor pins low,
  checks the board and radio, and proves that the C++ core links on the device.

Still to build:

- Wi-Fi setup and game updates;
- saved settings and event history;
- the physical display;
- motor, end-stop, and power controls;
- local setup and management from Apple Lab;
- per-device identity, ownership, and recovery;
- sleep and recovery behavior.

## What the shared code does

The shared code receives a small game update and decides whether a celebration should begin. It supports doubleheaders, ignores plays that happened before startup, and waits for reviews to finish before accepting a home run.

Before starting movement, it records the accepted event so a restart cannot trigger the same celebration again. The current tested sequence waits two seconds, raises the Apple 50 mm, holds it for 30 seconds, and lowers it.

If time moves backward, storage fails, or movement takes too long, the sequence stops and records what went wrong.

## Why hardware code stays separate

The shared rules do not know how to join Wi-Fi, draw a screen, save to a particular chip, or power a motor. The Nano firmware will provide those hardware-specific pieces.

Keeping them separate lets Apple Lab, Virtual Apple, automated tests, and the physical device follow the same celebration rules. The Nano still makes the final decision about whether physical movement is safe.

## Run the firmware tests

From the repository root, run:

```bash
pnpm test:native
```

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
