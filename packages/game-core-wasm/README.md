# Game Core WASM

Generated Emscripten binding around the canonical hardware-free C++ core. Memory ownership and schema versions are explicit; generated output is never edited by hand.

`src/c_api.cpp` exposes a flat begin/add/commit boundary, monotonic ticks, position feedback, commands and traces. `src/index.ts` owns only enum/string marshaling and memory cleanup; it contains no home-run or win rules. The browser build uses an in-memory ledger and is recording-only.

```bash
pnpm --filter @apple/game-core-wasm build
pnpm --filter @apple/game-core-wasm test
```

The parity test feeds the same normalized scenarios used by Simulator through compiled C++, checks expected motion counts, and verifies persistence failure closes with `MOTION_DISABLE`. The single-file ESM output is generated at `src/generated/apple-core.mjs` so Vite and Node tests load the same artifact.
