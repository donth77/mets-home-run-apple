# Apple Lab

Apple Lab is the local workshop for building and testing the project. It
simulates games, replays MLB history, previews the physical display, connects
to your Apple over Wi-Fi to watch it and run test celebrations, and talks to
commissioning firmware over USB.

The Apple does not need the Lab. It keeps following games with the Lab closed.

## Run it

```bash
pnpm dev:lab
```

Open <http://localhost:4173>. USB features need Chrome, Edge, or Brave.

## Workspaces

| Workspace | Use it for |
| --- | --- |
| Overview | Device, game, and safety previews; test home run and Mets win |
| Simulator | Browser scenarios, and approved runs on the Apple over Wi-Fi |
| Apple now | What the connected Apple is showing, or an opt-in MLB recording |
| Historical Replay | Completed MLB games with play, pause, seek, and speed |
| Hardware Tests | Guarded USB commissioning with receipts from the Nano |
| Diagnostics | Device telemetry and event history |

## No hardware needed

- Apple now and Historical Replay only contact MLB when you start a recording
  or pick a game.
- Both run the same C++ game-state and decision code as the Apple. Seeking
  backward resets it, so an old home run never becomes a new celebration.
- Simulator scenarios use that code and the Nano's 320 × 240 display renderer.
  Browser runs only record motion commands.
- The **Custom** scenario is yours to edit. It runs in the browser only.

## Connect to your Apple

Use **Connect to Apple** in the sidebar. The address defaults to
`home-run-apple.local`; an IP works too. The setup code is on the Apple's info
screen (short press of the owner button). Both are remembered in this browser.

The browser reaches the Apple through the dev server's `/device/*` relay
(`vite-apple-relay.ts`), so this only works from `pnpm dev:lab` or
`vite preview`. Set `APPLE_HOST` to change the default address.

## Run a test on the Apple

1. Connect over Wi-Fi. The motor must be enabled in Apple Manager.
2. In Simulator, turn on **Physical Apple**, pick a scenario, and choose
   **Run on the Apple**. Or use **Test home run** or **Test Mets win** in
   Overview.
3. Tap the owner button on the Apple within 30 seconds. Do not hold it.

- One tap allows one run.
- Runs use a 30-second raised dwell and end within 180 seconds.
- **Stop the Apple** or turning the toggle off cancels. A stop while moving
  latches a fault that a person must clear.
- If the connection drops, the Apple finishes or faults on its own and never
  repeats a run.
- Every test needs the setup code, even when Manager's **Require code** is off.

Details: [Apple Lab test protocol](../../firmware/lib/manager/LAB_PROTOCOL.md).

## USB

Hardware Tests recognizes these firmware profiles:

| Profile | Bounded action |
| --- | --- |
| `nano_esp32_motor_logic_test` | One no-power ENA/IN1/IN2 signal test |
| `nano_esp32_actuator_jog_test` | One short actuator jog per arm |
| `nano_esp32_l298n_meter_test` | One longer meter window per arm |
| `nano_esp32_motion_commissioning` | One engine-driven celebration per arm |
| `nano_esp32_audio_test` | Storage, amplifier, and display/SD bus checks |

The Nano owns every deadline, stop, and fault. The browser never gets raw motor
controls. Follow the on-screen steps in order before connecting motor power.

Production firmware over USB is read-only: status, scoreboard, and diagnostics.
Tests go over Wi-Fi. With both attached, Wi-Fi wins.

## Lab and Manager

Apple Manager is the owner page served by the Nano; it configures the Apple.
Apple Lab is for development; its settings stay in this browser. Neither makes
motion-safety decisions.

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
