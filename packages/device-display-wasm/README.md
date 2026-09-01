# Device display WebAssembly

This package compiles the portable 320 x 240 home-run, grand-slam, and Mets-win
renderer from `firmware/lib/home_run_loop` to WebAssembly. Apple Lab uses it to
show the same celebration frames that run on the Nano display.

The browser build always uses the committed CC0 font, so an ignored local font
override can never be embedded in the public WebAssembly artifact.

```bash
pnpm --filter @apple/device-display-wasm build
pnpm --filter @apple/device-display-wasm test
```

It does not contain live-game rules or hardware controls.
