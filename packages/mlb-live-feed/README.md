# MLB game data

Apple Lab and Virtual Apple use this package to read public MLB schedules, live games, and completed games. It is read-only and never controls the physical Apple.

## What it provides

The package can:

- find Mets games for a date, including doubleheaders;
- follow the score, inning, outs, runners, count, batter, and pitcher;
- recognize official play results and review status;
- find season boundaries and upcoming games;
- create a replay timeline for a completed game.

It translates MLB's response into consistent game information for the apps and the shared rules. The shared rules, not this package, decide whether the Apple should celebrate or move.

## How live updates stay reliable

When an app starts following a game, it first loads the current state. Plays that already happened are treated as history, so opening the app late cannot replay an old celebration.

After that, the package requests only the latest changes. If a change is missing information or cannot be applied safely, it reloads the full game instead of guessing.

Every network response has a time limit and size limit. The package rejects failed responses, malformed data, and updates that do not match the expected game. A cancelled screen or replay also cancels its outstanding request.

## Where to make changes

| Task | Files |
|---|---|
| Schedule and season dates | `schedule.ts` |
| Live-game updates | `client.ts` |
| MLB field reading and validation | `feedNormalization.ts`, `feedPayload.ts` |
| Scoreboard and decision-ready game information | `feedProjections.ts` |
| Completed-game replay | `historical.ts` |
| Network limits and errors | `transport.ts` |
| Public package exports | `index.ts` |

## Test the package

From the repository root, run:

```bash
pnpm --filter @apple/mlb-live-feed typecheck
pnpm --filter @apple/mlb-live-feed test
```

The tests use simulated network responses and never contact MLB. Automated repository tests must remain fully offline.
