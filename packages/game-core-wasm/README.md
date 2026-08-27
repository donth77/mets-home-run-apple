# C++ core for the web

This package compiles the hardware-free C++ core to WebAssembly so the browser apps make the same game decisions as the future device.

`src/c_api.cpp` exposes the small C boundary. `src/index.ts` converts enums and strings and cleans up memory; it contains no home-run or win rules. Browser motion and persistence are recording-only.

```bash
pnpm --filter @apple/game-core-wasm build
pnpm --filter @apple/game-core-wasm test
```

The parity test sends the Simulator scenarios through compiled C++, checks expected motion counts, and confirms that a storage failure ends with `MOTION_DISABLE`. Emscripten writes the single-file module to `src/generated/apple-core.mjs`. Do not edit generated output by hand.
