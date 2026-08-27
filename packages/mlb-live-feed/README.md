# MLB live feed

The read-only schedule, live-game, and replay adapter shared by Apple Lab and Virtual Apple. It turns MLB responses into versioned evidence for the C++ core; it does not decide whether the Mets hit a home run or won.

## Main modules

| Module | Responsibility |
| --- | --- |
| `client.ts` | Bootstrap, patch polling, and cursor delivery |
| `transport.ts` | Status checks, deadlines, cancellation, byte limits, and JSON parsing |
| `jsonPatch.ts` | Defensive RFC 6902 patching |
| `feedPayload.ts` | Full-feed and patch-envelope checks |
| `feedNormalization.ts` | Snapshots and play evidence |
| `schedule.ts` | Mets schedule and season dates |
| `historical.ts` | Bounded replay indexes and bookmarks |
| `timecode.ts` | MLB UTC timecodes |
| `index.ts` | Stable public exports |

The client loads one full feed, seeds earlier plays as history, and then asks for `diffPatch` updates from the last accepted cursor. An unknown or rejected patch shape triggers a bounded full-feed refresh.

All network tests use fake `fetch` implementations. CI must remain offline.

```bash
pnpm --filter @apple/mlb-live-feed typecheck
pnpm --filter @apple/mlb-live-feed test
```
