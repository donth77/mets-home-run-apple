# Working in this repository

These rules apply to the whole public monorepo.

## Keep one source of truth

- `firmware/lib/game_state` will own the canonical game state shared by the browser and device.
- `firmware/lib/core` owns celebration decisions and sequence safety; it consumes only the evidence it needs.
- Keep both portable libraries free of Arduino, networking, storage, display, motor, and wall-clock code.
- Compile the same libraries for native tests, browser WebAssembly, and the Nano.
- Do not recreate home-run, win, review, or deduplication rules outside the C++ core.
- Keep score, inning, runners, count, batter, pitcher, line score, and game disposition out of the motion engine unless a field is required for a decision.

## Preserve motion safety

- Unclear, stale, malformed, duplicate, wrong-game, or review-pending data means no motion.
- Only a newly confirmed Mets home run or Mets win may start a celebration.
- Persist the event key before exposing motion intent.
- Never celebrate opponent, overturned, bootstrap, or historical events.
- Run one sequence at a time. Every direction needs a timeout and must end home or in a disabled fault.
- Tests and browser demos always use fake or recording-only motion.

## Build repeatable devices

- Do not publish physical assembly or printable-part instructions until they
  have been validated on real hardware.
- Browser GLB assets are visual references, not manufacturing CAD.
- Give every physical Apple unique credentials. Never reuse a claim code, setup secret, or device key across units.
- Keep remote services optional. The device must follow games and remain safe without Apple Lab or a hosted service.
- Keep Apple Manager as the device-hosted owner interface and Apple Lab as the optional builder tool. Neither may become part of the autonomous game loop.
- Do not expose raw motor commands through local or remote management.
- Require physical presence and a short-lived authenticated maintenance session for hardware tests.

## Keep tests useful

- Prefer small synthetic fixtures over raw third-party feed captures.
- CI must never call the live MLB feed.
- Use fake monotonic time; tests must not sleep.
- Add a golden trace when a rule or protocol changes.
- Keep cross-target values in integer milliseconds, millimeters, and stable IDs.

## Keep files focused

- Package index files should mostly export public APIs.
- Separate transport, parsing, decisions, presentation, and React composition.
- Keep the Apple mesh and decal separate.
- Record the source and checksum of new binary assets.

## Before handing off

- Do not commit credentials, device tokens, local hostnames, diagnostic exports, or machine-local files.
- Do not add a contributor guide until the maintainer asks for one.
- Run the narrowest relevant tests, then:

```bash
pnpm lint
pnpm typecheck
pnpm check:public
```

Core changes also need native and WASM tests. Browser changes need an offline fixture check. A motion-adapter change needs a disarmed embedded test before any loaded cycle.
