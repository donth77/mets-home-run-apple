# Browser Apps

Apple Lab and Virtual Apple are separate deployable applications with intentionally different presentation layers.

## Apple Lab

Apple Lab is an engineering surface. Its default viewport is a neutral grid/test plinth with orbit controls, optional wireframe rendering and a 0–50 mm recording-position override. The surrounding dashboard exposes:

- deterministic fixture selection;
- fake time with play, pause, frame-step, reset and speed controls;
- normalized score, inning, outs, review and game status;
- current recording commands and motion position;
- line-oriented event, ledger and adapter traces.

It does not render the outfield by default because stadium scenery would reduce diagnostic contrast and consume screen area needed by controls. It does not contain home-run detection rules and cannot access hardware GPIO.

## Virtual Apple

Virtual Apple is the presentation surface. Its fixed cinematic camera looks toward a lightweight center-field composition made from procedural Three.js geometry:

- striped grass and warning track;
- blue wall, orange rail and center-field distance marker;
- dark batter's-eye structures;
- instanced seating;
- the shared Apple/base model behind the wall.

The accessible scoreboard is an HTML overlay rather than a WebGL texture, keeping live text sharp and responsive. Public controls select fixture-driven moments; raw traces, administrative device controls and manual motion overrides are intentionally absent.

## Shared implementation

Both apps import:

- `@apple/apple-3d` for the model loader, runtime decal, actuator animation and scene modes;
- `@apple/scoreboard-ui` for score, inning and outs;
- `@apple/protocol` for versioned snapshots and commands;
- `@apple/test-fixtures` for deterministic offline scenarios.

The synthetic fixtures contain pre-authored snapshots and commands. They are a UI/renderer test source, not a replacement for the planned canonical C++ game core. Live MLB transport will not be connected until native and WASM traces agree on the required scenarios.

## Development

From the repository root:

```bash
pnpm install
pnpm dev:lab
pnpm dev:virtual
```

Run each development command in its own terminal. Use `pnpm test` and `pnpm build` before committing browser changes.
