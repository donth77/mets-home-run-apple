# Apple Lab

Apple Lab is the local workshop for building and testing the project. It can
connect to your Apple over Wi-Fi to watch it and fire test celebrations,
simulate games, replay MLB history, inspect feed behavior, preview the physical
display, and talk to guarded commissioning firmware over USB.

The physical Apple does not depend on Apple Lab. It keeps following games when
the Lab is closed.

## Run it

From the repository root:

```bash
pnpm dev:lab
```

Open <http://localhost:4173>.

## Workspaces

| Workspace | Use it for |
| --- | --- |
| Overview | Quick device, game, and safety previews |
| Simulator | Browser scenarios and approved physical fixture runs over Wi-Fi |
| Apple now | What the connected Apple is showing and doing, or an opt-in MLB recording |
| Historical Replay | Completed MLB games with play, pause, seek, and speed controls |
| Hardware Tests | Guarded USB commissioning and receipts from the Nano |
| Diagnostics | A preview of autonomous-device telemetry and event history |

## No hardware required

Apple now does not contact MLB until you start a recording. Historical Replay
waits until you choose a date and game. Both use the shared C++ game-state and
decision code.

Seeking backward in a replay resets that code before rebuilding the state. An
old home run therefore cannot become a new celebration. The timeline and CSV
export show the decisions and commands for the full filtered result, not just
the visible page.

Simulator scenarios use the same decision code and 320 × 240 display renderer
as the Nano. Browser previews record motion commands. The Physical Apple toggle
opts into a separate, approved run on the device.

The **Custom** scenario at the top of the list is yours to edit: opponent,
score, inning and half, outs, count, runners, batter and pitcher, the last
play, and an optional home run, grand slam, or Mets win with the name shown on
screen. It previews through the real display renderer (a long surname shows
exactly how the Apple would fit it) and is remembered in this browser. It runs
in the browser only; the Apple runs its built-in fixtures.

## USB hardware tests

Hardware Tests uses Web Serial and works from localhost in Chrome, Edge, or
Brave. It recognizes these firmware profiles:

| Profile | Bounded action |
| --- | --- |
| `nano_esp32_motor_logic_test` | One no-power ENA/IN1/IN2 signal test |
| `nano_esp32_actuator_jog_test` | One short actuator jog per arm |
| `nano_esp32_l298n_meter_test` | One longer meter window per arm |
| `nano_esp32_motion_commissioning` | One engine-driven celebration per arm |
| `nano_esp32_audio_test` | Storage, amplifier, and display/SD bus checks |

The Nano owns every deadline, stop, and fault. The browser never gets raw motor
controls. Each motion request needs a new short-lived arm and returns a receipt.
Follow the Hardware Tests instructions in order before connecting motor power
or an actuator.

## Connect to your Apple over Wi-Fi

Use **Connect to Apple** in the sidebar. The address defaults to
`home-run-apple.local` (an IP such as `192.168.1.139` also works) and the
setup code is the one on the Apple's info screen (short press of the owner
button). Both are remembered in this browser, and the Lab reconnects on the
next visit.

While connected, Overview, Apple now, and Diagnostics use the Apple's reported
status. Apple now paints what the Apple's panel is showing — the game or
upcoming screen, its card screens such as the test-approval prompt, and a
celebration in progress — with the same renderer the firmware uses. Missing safety fields are shown as unknown; stale status disables new
tests. Failed connections retry automatically. Disconnect stops retries.

### Physical Apple in Simulator

1. Install firmware containing the Simulator fixture API, then connect over
   Wi-Fi with this Apple's setup code.
2. Open Simulator and turn on **Physical Apple**. Connection alone does not arm
   hardware. The toggle controls Simulator tests; autonomous game following is
   still controlled by Apple Manager.
3. Select a scenario and choose **Run on the Apple**.
4. Press and release the physical owner button once within 30 seconds. Do not
   hold it: holds retain their restart/reset meanings.
5. The scenario starts by itself as soon as the tap lands. Approval permits one
   run; the next one asks for another tap.

The motor must be enabled in Apple Manager. The device runs the selected shared
fixture through the canonical projector and C++ engine, using its own actuator
adapter. Scenarios use a 30-second raised dwell, with a 180-second total limit.
Review and no-motion scenarios still pass through the same decision rules.
Preview speed, pause, and timeline scrubbing never change physical motor timing.

Turning the toggle off or selecting **Stop the Apple** requests cancellation.
Stopping away from home latches a disabled fault for attended recovery. If the
connection is lost, Stop may not arrive; the device independently completes its
bounded sequence or disables motion on fault. Reconnecting never repeats a run.

**Test home run** and **Test Mets win** in Overview also require the same
physical approval. All hardware-test sessions require the setup code even when
Apple Manager's general **Require code** setting is off. Session tokens stay in
memory and are neither stored in browser settings nor published in status.

The browser uses the Lab dev server's `/device/*` relay (see
`vite-apple-relay.ts`), available from `pnpm dev:lab` and `vite preview`. A copy
hosted elsewhere cannot reach a LAN device. Set `APPLE_HOST` to change the
default address. General settings and firmware updates retain Apple Manager's
existing owner-lock behavior.

### Production USB

Hardware Tests also recognizes `APPLE_LIVE` production firmware. USB provides
read-only status, scoreboard, and diagnostics; it polls only `?` and hides
commissioning controls. Wi-Fi is the transport for approved production tests.
If both are attached, Wi-Fi is the selected device source. Commissioning builds
retain their existing, separate USB test workflows.

### Offline validation

`pnpm fixtures:generate` regenerates device inputs from `@apple/test-fixtures`.
`pnpm check:fixtures` detects drift and runs as part of `pnpm test`. Native tests
run all 14 fixtures with a recording actuator and compare a golden motion trace.
The native status JSON golden is also read by the Lab's parser and offline UI
tests. No validation fixture contacts MLB or drives hardware.

Without a connected Apple, Overview, Apple now, and Diagnostics show labeled
reference data. Older firmware supports telemetry but needs an update for the
full scoreboard and guarded Simulator API. These code and build checks do not
replace a disarmed embedded test before the first loaded hardware run.

## Apple Lab and Apple Manager

Apple Manager is the owner page served by the Nano. It changes the physical
Apple's Wi-Fi and device settings.

Apple Lab is for development. Any Lab settings affect only the local Lab
browser. They never configure the physical Apple, and neither browser interface
makes motion-safety decisions.

## Code map

| Path | Contents |
| --- | --- |
| `src/workspaces/` | Main Lab screens |
| `src/HistoricalReplayPanel.tsx` | Replay controls and event timeline |
| `src/UsbBenchPanel.tsx` | Guarded serial test UI |
| `src/useUsbBenchDevice.ts` | Web Serial connection |
| `src/mlbRecordingRuntime.ts` | Live recording pipeline |
| `src/physicalDisplayCanvas.ts` | Shared physical-display preview |
| `src/styles/` | Workspace styles |
