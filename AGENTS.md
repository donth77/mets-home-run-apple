# Working in this repository

These rules apply to the whole public monorepo.

## Keep one source of truth

- `firmware/lib/core` owns game decisions and sequence safety.
- Keep the core free of Arduino, networking, storage, display, motor, and wall-clock code.
- Compile the same core for native tests, browser WebAssembly, and the Nano.
- Do not recreate home-run, win, review, or deduplication rules in TypeScript or the edge Worker.
- The edge Worker may validate, limit, and cache requests. It must never make game decisions.

## Preserve motion safety

- Unclear, stale, malformed, duplicate, wrong-game, or review-pending data means no motion.
- Only a newly confirmed Mets home run or Mets win may start a celebration.
- Persist the event key before exposing motion intent.
- Never celebrate opponent, overturned, bootstrap, or historical events.
- Run one sequence at a time. Every direction needs a timeout and must end home or in a disabled fault.
- Tests and browser demos always use fake or recording-only motion.

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
