# Firmware

`lib/core` is the portable C++17 decision and motion-sequence engine shared by native tests and the browser build. Nano ESP32 adapters for networking, storage, display, motor control, setup, local management, and sleep still need to be added through PlatformIO.

The core accepts small, versioned game updates instead of raw MLB JSON. It:

- keeps separate state for each `gamePk`, including doubleheaders;
- treats the first observation as history and does not celebrate it;
- rejects malformed, wrong-team, duplicate, older, or review-pending evidence;
- saves a confirmed Mets home run or win before starting a sequence;
- runs one sequence at a time with a two-second display/LED lead-in;
- extends 50 mm, waits for position feedback, holds for 30 seconds, and retracts;
- disables motion and latches a fault after persistence, clock, or direction-timeout failures.

Run the native suite from the repository root:

```bash
pnpm test:native
```

The core deliberately knows nothing about Arduino APIs, Wi-Fi, JSON, displays, motors, storage implementations, or wall-clock time. Those details belong in adapters. Before a loaded physical test, the motion adapter must use the real end-stop strategy and measured travel.
