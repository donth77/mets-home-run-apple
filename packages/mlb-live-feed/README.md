# MLB live-feed transport

Shared read-only MLB schedule, live-feed, and historical-replay adapter for Apple Lab and Virtual Apple. This package does not decide whether an event is a Mets home run or win; it emits versioned normalized evidence for the canonical compiled C++ core.

## Modules

- `client.ts` — stateful bootstrap/diff client and cursor delivery;
- `transport.ts` — status validation, abort/deadline handling, streaming byte caps, and JSON decoding;
- `jsonPatch.ts` — defensive RFC 6902 application;
- `feedPayload.ts` — full-feed and patch-envelope shape checks;
- `feedNormalization.ts` — snapshots and normalized play evidence;
- `schedule.ts` — Mets schedule and season-boundary reads;
- `historical.ts` — bounded archive index and event bookmarks;
- `timecode.ts` — MLB UTC timecode parsing/formatting;
- `index.ts` — stable public exports only.

The client bootstraps once, seeds historical plays, then requests `diffPatch` updates using the accepted upstream cursor. Unknown or rejected patch shapes trigger a full-feed fallback. State-changing responses that reuse an upstream timestamp receive a stable delivery revision so the C++ core can accept the new evidence without weakening cursor regression checks.

All network behavior is tested with synthetic `fetch` implementations. CI must remain network-free.

```bash
pnpm --filter @apple/mlb-live-feed typecheck
pnpm --filter @apple/mlb-live-feed test
```
