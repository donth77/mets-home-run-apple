# Agent Guide

These rules apply to the complete public monorepo.

## Product boundaries

- The Nano ESP32 must operate without Apple Lab, Virtual Apple, a desktop computer or a paid server.
- `firmware/lib/core` is the canonical game-decision implementation. Keep it free of Arduino, networking, storage, display, motor and wall-clock headers.
- Compile that core for native tests, browser WebAssembly and the Nano target. Do not reproduce event rules in TypeScript, UI components or the edge Worker.
- The edge Worker is a bounded transport/cache adapter. It may allowlist requests, enforce limits and cache confirmed responses; it must not infer home runs, wins or motion commands.

## Safety invariants

- Uncertain, malformed, stale, duplicate, wrong-game or review-pending data produces no physical motion.
- Only a completed Mets batting home run can enqueue a home-run sequence.
- Persist the accepted event key before issuing a motion command.
- Opponent, overturned and historical bootstrap plays never trigger motion.
- One motion sequence may run at a time. Every extend/retract command has a hard timeout and ends at home or in a latched disabled fault.
- Tests and web demos use recording/fake motion unless the operator explicitly builds and arms an embedded hardware target.

## Data and tests

- Keep fixtures deterministic, minimal and redistributable. Prefer synthetic normalized cases over checking in large third-party feed captures.
- Never make live MLB network calls in CI.
- Use a fake monotonic clock; tests must not sleep.
- Add a golden trace for every rule or protocol change and compare native, WASM and embedded outputs where practical.
- Use integer milliseconds, millimeters and stable identifiers across target boundaries.

## Module ownership

- Keep package barrels small. Stateful transport, normalization, rendering, and React orchestration belong in separate modules with package-owned tests.
- Web app shells own navigation and composition only. Reusable widgets, workspaces, presentation rules, and scene drawing helpers belong in focused files.
- Keep the Apple geometry and the Mets decal separate. The runtime decal must remain replaceable without modifying the 3D mesh.
- Add or update source metadata when introducing externally sourced binary assets. Never silently replace a checked-in model or audio file.

## Repository hygiene

- Keep credentials, device tokens, local hostnames, raw diagnostic exports, and machine-local artifacts out of the repository.
- Run `pnpm check:public` before every commit and push.
- Do not add `CONTRIBUTING.md` until the maintainer asks for a contributor workflow.

## Verification

For every change, run the narrowest relevant tests plus:

```bash
pnpm lint
pnpm typecheck
pnpm check:public
```

Firmware rule changes also require native replay tests. Browser changes require an offline fixture smoke test. Motion-adapter changes require an embedded disarmed test before any loaded cycle.
