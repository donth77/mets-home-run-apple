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
| Live Game | An opt-in MLB recording and a demo device timeline |
| Historical Replay | Completed MLB games with play, pause, seek, and speed controls |
| Simulator | Fast, repeatable game scenarios |
| Hardware Tests | Guarded USB commissioning and receipts from the Nano |
| Diagnostics | A preview of autonomous-device telemetry and event history |

## No hardware required

Live Game does not contact MLB until you start a recording. Historical Replay
waits until you choose a date and game. Both use the shared C++ game-state and
decision code.

Seeking backward in a replay resets that code before rebuilding the state. An
old home run therefore cannot become a new celebration. The timeline and CSV
export show the decisions and commands for the full filtered result, not just
the visible page.

Simulator scenarios use the same decision code and 320 × 240 display renderer
as the Nano. The browser records motion commands; it cannot drive an actuator.

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

While connected, Overview shows what the Apple is showing — the live
scoreboard during a game, the next game otherwise — plus its position, motion
state, Wi-Fi signal, card and track counts, and firmware slot. **Test home run**
and **Test Mets win** ask the Apple to replay its own recorded game through the
real engine: display, audio, lights, and the full lift. They are enabled only
while the Apple is idle, and the Apple still owns every timeout, stop, and
fault. Diagnostics shows the Apple's telemetry and the events the Lab observed
since it connected.

The browser never talks to the Apple directly. The Lab's dev server relays
`/device/*` to the Apple (see `vite-apple-relay.ts`), so this works from
`pnpm dev:lab` and `vite preview`; a copy of the Lab hosted elsewhere cannot
reach a LAN device. Set `APPLE_HOST` to change the default address.

Turn on **Require code** in the Apple Manager: without it, anyone on the same
Wi-Fi can trigger motion or upload firmware, code or no code.

## What is still a preview

Without a connected Apple, Overview and Diagnostics fall back to
representative device data and say so. The disabled **Run fixture on device**
button in the Simulator waits on a firmware endpoint that accepts external
fixtures, which does not exist yet.

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
