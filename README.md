# Mets Home Run Apple

An unofficial, open-source fan project for a self-contained Wi-Fi Home Run Apple. The target device uses an Arduino Nano ESP32 to read live game updates, show score/inning/outs, and control a small linear actuator without an always-on PC or paid application server.

This repository also houses two web experiences built around the same decision core:

- **Apple Lab** — a deterministic engineering simulator with historical replay, fake time, fault injection and a 3D hardware preview.
- **Virtual Apple** — a public game-day presentation that follows the live Mets schedule/feed through the same compiled core, with fixture controls available only in an explicitly enabled local development session.

The physical Apple operates independently. Neither web app is required after the firmware is installed and Wi-Fi is configured.

## Status

The first canonical decision slice is implemented. `firmware/lib/core` now compiles as ISO C++17 for host tests and as a self-contained Emscripten module. It owns bootstrap suppression, cursor ordering, Mets/opponent selection, review gating, event-ledger writes, win detection, the two-second display lead-in, 50 mm motion intent, 30-second raised hold and timeout fault latch.

Apple Lab can replay synthetic presentation fixtures, step through archived MLB updates, run every normalized device fixture through the WASM core and—only after an explicit developer selection—record direct MLB schedule/live-feed data. Virtual Apple automatically checks the Mets schedule, stays quiet between games, and follows an active game through the same normalized transport and WASM core. Neither browser transport has a device-command route. The Nano networking, NVS, display, provisioning and physical motion adapters remain future gates, as do calibrated donor measurements and guarded loaded testing.

## Run the browser apps

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm dev:lab
```

In a second terminal:

```bash
pnpm dev:virtual
```

Apple Lab defaults to `http://localhost:4173`; Virtual Apple defaults to `http://localhost:4174`. Apple Lab’s direct MLB source remains opt-in. Virtual Apple checks the schedule on load, opens a live feed only when a Mets game is active, and otherwise renders its between-games state.

Historical Replay is a first-class Apple Lab workspace: open `http://localhost:4173` and select **Historical replay** directly in the left sidebar. No query flag is required.

Virtual Apple's public-facing fixture controls remain locally gated: `http://localhost:4174/?demo=1` enables its **Demo** bar only in a Vite development build on a loopback hostname.

The Virtual Apple bar is absent by default and cannot be enabled in a production build, even when the query parameter is present.

Validate the public boundary, asset checks, offline fixtures and both production bundles with:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The complete verification path also requires CMake, a C++17 compiler and Emscripten. `pnpm test` verifies that shared web constants still match the canonical C++ motion constants before running native and browser suites. Generated WASM is checked in for normal app development; `pnpm wasm:build` regenerates it from the C++ core sources.

## Architecture

```text
                    hardware-free ISO C++ game core
                     /            |             \
             native tests       WASM         Nano ESP32
                                  |              |
                    Apple Lab + Virtual Apple   device ports
                                  |
                      optional feed-cache Worker
```

Game decisions live in one hardware-free C++ core. Native tests, the browser WebAssembly wrapper and the Nano firmware replay the same normalized inputs and golden traces. The optional edge Worker validates and caches transport requests only; it never decides whether to move the Apple.

## Repository map

```text
apps/apple-lab/            engineering simulator and trace console
apps/virtual-apple/        public fan experience
packages/apple-3d/         Three.js scene and model adapter
packages/game-core-wasm/   generated browser binding for the C++ core
packages/mlb-live-feed/    shared bounded MLB transport and normalizer
packages/protocol/         versioned cross-target contracts
packages/scoreboard-ui/    accessible score, inning and outs display
packages/test-fixtures/    synthetic and redistributable replay cases
packages/web-debug/        Virtual Apple local-development query gate
firmware/                  canonical core plus ESP32 adapters
edge/mlb-feed-cache/       optional stateless cache/proxy
docs/                      public architecture, testing, security and accessibility policy
```

Start with [the architecture](docs/ARCHITECTURE.md) and [browser-app guide](docs/WEB_APPS.md), then read the [test strategy](docs/TESTING.md), [security model](docs/SECURITY.md), and [accessibility notes](docs/ACCESSIBILITY.md).
