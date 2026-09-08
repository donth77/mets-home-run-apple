# Apple Lab test protocol

Apple Manager remains the device-hosted owner interface. Apple Lab is an
optional client of these production-firmware endpoints. No client supplies
motor direction, distance, dwell, deadlines, or arbitrary game inputs.

| Request | Result |
| --- | --- |
| `GET /api/status` | Read-only device status, canonical snapshot, maintenance availability and fixture receipt |
| `POST /api/maintenance` | Requires this Apple's setup code in `X-Apple-Code`, even with owner lock off; returns an unpredictable 32-hex-character token |
| Physical owner-button short press | Confirms the pending request within 30,000 ms; grants 60,000 ms for one attempt |
| `POST /api/fixture?scenario=<id>` | Consumes `X-Apple-Maintenance`, validates idle/no fault/home estimate/motor enabled, and starts the named built-in fixture |
| `POST /api/fixture/stop` | Accepts only the token that started the current/last fixture; cancels without authorizing another run |
| `POST /api/replay?kind=hr\|win` | Uses the same one-use approval for existing recorded celebration tests |

Tokens never appear in status or logs. Expired tokens are retired by the device
loop. Button holds retain restart/reset behavior; serial commands cannot confirm
presence or start a production replay. A failed attempt consumes approval too.

Status adds `maintenance: {supported, pending, armed, remainingMs}` and
`fixture: {version: 1, scenarioId, state, frame, totalFrames}`. Fixture states are
`IDLE`, `RUNNING`, `COMPLETED`, `CANCELLED`, and `FAILED`. `frame` is the count of
inputs consumed while running. `snapshot` contains the shared game-state schema,
including teams, at-bat and line score; legacy compact fields remain for Manager.

The fixture generator imports the existing `@apple/test-fixtures` definitions.
Native tests validate each generated frame through the canonical projector and
decision core, check persistence before motion intent, and compare a golden
motion trace. Device fixtures use the standard 30,000 ms dwell, do not extend it
to a full win track, and have a 180,000 ms total bound. Their ledger is isolated
from autonomous game history. Network feed/release work pauses during a fixture;
completion resets intake so the next real game frame is a bootstrap.

Stop at idle/home ends the test. Stop during a sequence disables outputs and
latches a motion fault; it never silently resets the engine into a movable state.
Loss of Apple Lab does not remove device deadlines or resume/repeat a test.
The browser retains cancellation permission after an uncertain start response,
but cannot promise that a Stop request reached an offline device.
Stop also retires an unconsumed matching approval, so it can safely overtake a
delayed Start. The browser's Stop control remains available while Start awaits
its response.

`APPLE_LIVE:` over USB exposes the same status. Apple Lab sends only `?` to this
production profile; commissioning firmware has separate bounded test commands.
