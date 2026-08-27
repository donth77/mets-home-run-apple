# Firmware

`lib/core` is the canonical hardware-free ISO C++17 decision and sequence engine. It currently builds for the host and browser WebAssembly; Nano ESP32 adapters for HTTPS, NVS, display, motion, provisioning, local administration and sleep remain to be added through PlatformIO.

The core accepts normalized, versioned envelopes rather than raw MLB JSON. It:

- keeps independent game contexts by `gamePk`, including doubleheaders;
- treats the first observation as bootstrap and seeds historical event keys without celebrating them;
- rejects malformed, wrong-team, duplicate, regressed and review-pending evidence;
- persists a confirmed Mets home-run or newly observed Mets-win key before queueing a sequence;
- allows only one active sequence, with a two-second display/LED lead-in;
- commands a 50 mm extend, waits for explicit position feedback, holds raised for **30,000 ms**, then retracts;
- emits `MOTION_DISABLE` and latches a fault on persistence, monotonic-clock or direction timeout failures.

Build and run native tests from the repository root:

```bash
pnpm test:native
```

The C++ layer intentionally contains no Arduino, networking, JSON, display, motor, storage implementation or wall-clock headers. `EventLedger` is a synchronous persistence port; the future NVS adapter must implement its durability contract. The physical motion adapter must verify the actual end-stop strategy and measured travel before a loaded test.
