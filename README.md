# Mets Home Run Apple

An unofficial, open-source fan project for a self-contained Wi-Fi Home Run Apple. The target device uses an Arduino Nano ESP32 to read live game updates, show score/inning/outs, and control a small linear actuator without an always-on PC or paid application server.

This repository also houses two web experiences built around the same decision core:

- **Apple Lab** — a deterministic engineering simulator with historical replay, fake time, fault injection and a 3D hardware preview.
- **Virtual Apple** — a public game-day presentation with fixture-driven demo/quiet modes today and planned live/replay modes.

The physical Apple operates independently. Neither web app is required after the firmware is installed and Wi-Fi is configured.

## Status

The first browser implementation is underway. Apple Lab now provides an offline diagnostic dashboard and neutral 3D test bay; Virtual Apple provides a fixture-driven Citi-inspired center-field scene. Both load the same optimized Apple/base models, runtime Mets decal, scoreboard and normalized fixture contracts.

The browser apps currently replay synthetic commands only. The canonical C++/WASM decision core, live-feed adapters and calibrated donor measurements remain future gates. Hardware dimensions, MLB feed behavior and all motion safety requirements must be verified before anyone connects an actuator.

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

Apple Lab defaults to `http://localhost:4173`; Virtual Apple defaults to `http://localhost:4174`. Neither development build makes a live MLB request.

Validate the public boundary, asset checks, offline fixtures and both production bundles with:

```bash
pnpm test
pnpm build
```

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
packages/protocol/         versioned cross-target contracts
packages/scoreboard-ui/    accessible score, inning and outs display
packages/test-fixtures/    synthetic and redistributable replay cases
firmware/                  canonical core plus ESP32 adapters
edge/mlb-feed-cache/       optional stateless cache/proxy
docs/                      public architecture, testing and asset policy
```

Start with [the architecture](docs/ARCHITECTURE.md), [browser-app guide](docs/WEB_APPS.md), then read [the test strategy](docs/TESTING.md). Automated contributors should also follow [AGENTS.md](AGENTS.md).

## Operating-cost target

- Device: direct Wi-Fi access to game data and a local management page; **$0/month** software cost.
- Apple Lab: local/offline by default.
- Virtual Apple: static hosting, with an optional free-tier edge cache for a small hobby audience.

Free-tier quotas and third-party endpoint behavior can change. The physical device never relies on the public website or edge cache.

## Unofficial-project notice

This project is not affiliated with, endorsed by or sponsored by the New York Mets or Major League Baseball. The Mets roundel is kept as a replaceable decal asset rather than baked into the model.

## License status

The intended code, hardware and documentation licenses are being selected before the first public release. Until explicit license files are added, this scaffold is source-available but does not grant reuse rights. See [LICENSES/README.md](LICENSES/README.md). Do not publish a release from this state.
