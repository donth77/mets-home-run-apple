# Apple Lab test protocol

How Apple Lab runs a hardware test on a physical Apple over the LAN. Server:
`lib/manager`. Client: `apps/apple-lab/src/appleClient.ts`. Pinned by
`test/native/lab_protocol_tests.cpp` (`pnpm test:native`).

- The Apple decides all motion. A client can only start a built-in test and stop it.
- Every test needs the setup code and one tap of the owner button on the Apple. Nothing else approves.
- One tap, one run. A refused start uses it up too.

## Steps

1. `POST /api/maintenance` with the setup code in `X-Apple-Code` (required even
   with "Require code" off). Returns a one-time 32-hex token.
2. The Apple's screen asks for a tap. Tap the owner button within 30 seconds.
   A hold does not count.
3. Within 60 seconds, send the token in `X-Apple-Maintenance` with
   `POST /api/fixture` or `POST /api/replay`. That spends the token, even if
   the start is refused.
4. Poll `GET /api/status`. `POST /api/fixture/stop` with the same token cancels.

## Requests

| Request | Header | Notes |
| --- | --- | --- |
| `GET /api/status` | none | Status, snapshot, `maintenance` and `fixture` objects. Never the token. |
| `POST /api/maintenance` | `X-Apple-Code` | Returns `{"ok":true,"token":"…","expiresInMs":90000}`. |
| `POST /api/fixture?scenario=<id>` | `X-Apple-Maintenance` | Refused unless idle, at home, no fault, not updating, motor on. |
| `POST /api/fixture/stop` | `X-Apple-Maintenance` | Takes the token that started the fixture, or one still waiting for the tap. Never starts anything. Safe to repeat. |
| `POST /api/replay?kind=hr\|win` | `X-Apple-Maintenance` | Recorded home run or win. A win may pass the score to show: `away`, `home`, `awayRuns`, `homeRuns`, `metsHome`, `venue`, `awayName`, `homeName`. |

Errors are `{"ok":false,"error":"<code>"}`:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `CODE` | 401 | Wrong or missing setup code |
| `LOCKED` | 429 | Five wrong codes; codes ignored for 60 seconds |
| `BUSY` | 409 | Moving, celebrating, faulted, replaying, away from home, or updating |
| `NO_MAINTENANCE` | 409 | Firmware too old |
| `MAINTENANCE_REQUIRED` | 403 | No token, or token expired or already used |
| `BAD_FIXTURE` | 409 | Unknown scenario |
| `MOTOR_DISABLED` | 409 | Motor off in Apple Manager |
| `BAD_KIND` | 400 | Kind is not `hr` or `win` |
| `NO_REPLAY` | 404 | No recorded replay in this firmware |
| `CELEBRATING` | 409 | A real celebration is running |

## Status

- `maintenance`: `{supported, pending, armed, remainingMs}`. Pending: waiting
  for the tap, 30 s. Armed: tapped, waiting for the start, 60 s.
- `fixture`: `{version: 1, scenarioId, state, frame, totalFrames}`. State is
  `IDLE`, `RUNNING`, `COMPLETED`, `CANCELLED`, or `FAILED`.
- `snapshot`: the shared game-state schema. Old compact fields stay for the
  Manager page.

## Scenarios

`live`, `home-run`, `grand-slam`, `review-confirmed`, `review-overturned`,
`rain-delay`, `game-delay`, `game-suspended`, `game-postponed`,
`game-cancelled`, `mets-win`, `doubleheader`, `sleep`, `offseason`.

Generated from `@apple/test-fixtures` by `pnpm fixtures:generate`;
`pnpm check:fixtures` catches drift.
