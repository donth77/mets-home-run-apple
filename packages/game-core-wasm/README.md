# Shared game rules in the browser

Apple Lab and Virtual Apple use the same C++ game rules intended for the physical Apple. This package makes that C++ code runnable in a web browser.

It uses WebAssembly, a browser format for compiled code. Emscripten is the tool that converts the C++ source into that format.

## What happens when an app uses it

1. The app provides the latest accepted facts about the game.
2. The shared rules decide whether a celebration started and whether simulated movement changed.
3. The app receives a short result that it can show, animate, or record.

The result may include the celebration type and player name, a raise or lower instruction, or a safety shutdown. Diagnostic messages explain why a game update was accepted or ignored.

This package does not choose scoreboard text, animation, sound, lighting, or screen layout. It also cannot operate physical hardware. Browser movement and storage are simulations used for previews and tests.

## Where to make changes

- Change home run, win, review, duplicate-event, or movement rules in `firmware/lib/core`.
- Change the small C++ to browser connection in `src/c_api.cpp`.
- Change JavaScript-friendly names and memory handling in `src/index.ts`.
- Do not edit `src/generated/apple-core.mjs` by hand. The build command replaces it.

## Build and test

From the repository root, run:

```bash
pnpm --filter @apple/game-core-wasm build
pnpm --filter @apple/game-core-wasm test
```

The tests run the same offline game scenarios through C++ and the browser build. They confirm that both produce the same movement count and that serious failures end in a safe shutdown.
