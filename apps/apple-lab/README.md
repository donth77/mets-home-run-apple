# Apple Lab

Private-by-default engineering simulator for offline fixture replay, fake time, trace inspection, fault injection and dimensioned 3D motion. Its default scene is a neutral diagnostic test bay—not the Citi outfield used by Virtual Apple.

```bash
pnpm dev:lab
```

The current browser slice replays pre-authored normalized snapshots and command traces through a recording-only motion adapter. It contains no home-run detection logic and cannot access GPIO.
