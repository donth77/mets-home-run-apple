# Game-state WebAssembly

This package compiles the portable C++ game-state projector for browser tests.
It turns one normalized feed frame into the complete scoreboard snapshot and the
smaller evidence envelope consumed by the decision core.

It does not fetch MLB data, render a screen, or control hardware.
