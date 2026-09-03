# Virtual Apple

Virtual Apple is the public, browser-based version of the project. It follows
Mets games in a 3D Citi Field scene and raises the Apple for confirmed Mets
home runs and wins.

Live site: [metsapple.com](https://metsapple.com/)

## Run it locally

From the repository root:

```bash
pnpm dev:virtual
```

Open <http://localhost:4174>.

## What it does

- Shows the score, inning, count, runners, and current Mets batter or pitcher
- Lists upcoming games and handles doubleheaders
- Names delays, reviews, suspensions, postponements, and cancellations
- Takes over the stadium board for home runs and Mets wins
- Offers optional Mets Radio and celebration sound
- Supports mobile layouts, reduced motion, screen readers, and keyboard use

Focus view removes the surrounding page on desktop. On browsers with Document
Picture-in-Picture support, Mini Apple moves the same live view into a small
always-on-top window. Phones use the regular responsive page.

## How live games work

The browser checks the Mets schedule, follows the active MLB feed, and sends
normalized updates through the shared C++ game-state and decision code. That
code decides whether an event is new. The React app decides how to present it.

Production requests go through a small same-origin Cloudflare relay. Local Vite
development exposes the same `/api/mlb` route through a proxy. The relay has no
database and contains no game rules. The browser can fall back to MLB directly
if the relay is unavailable.

On first load, earlier plays normally establish state without triggering a
celebration. There is one exception: a Mets home run or win completed in the
previous five minutes can replay once per page session. This gives late
visitors the full sequence without turning old games into new events.

Virtual Apple has no connection to physical hardware.

## Sound

Radio and celebration sound are separate controls. Radio uses the official
Mets stream published by Audacy. A deployment can point to another authorized,
browser-playable stream:

```bash
VITE_METS_AUDIO_STREAM_URL=https://audio-provider.example/authorized-stream
```

Browsers require a user action before playing audio, so celebration sound starts
off.

## Local demo controls

Demo controls are available only in a Vite development build on a loopback
address:

- <http://localhost:4174/?demo=1>
- <http://localhost:4174/?debug=1>

A demo fixture replaces the live presentation until **Live data** is selected.
Production builds do not expose this bar, even when the URL contains the flag.

## Deploying

metsapple.com is a direct-upload Cloudflare Pages project (`virtual-mets-apple`),
so pushing to GitHub alone changes nothing on the site. The "Public checks"
workflow publishes it: on every push to `main` that touches the site (this
app, `packages/`, `public/`, or the workspace files) it runs the lint,
typecheck, tests, and build, then uploads that same build with wrangler. Two
repository settings make that possible:

- `CLOUDFLARE_API_TOKEN`, an Actions secret holding a Cloudflare API token
  with **Cloudflare Pages: Edit** on the account (My Profile, API Tokens,
  Create Token, "Edit Cloudflare Workers" template or a custom token).
- `CLOUDFLARE_ACCOUNT_ID`, an Actions variable with the account id shown by
  `wrangler whoami`.

Without them the deploy job prints a warning and skips, and the checks still
pass. "Run workflow" on the Actions page with **deploy_site** ticked publishes
even when nothing under the site changed. After every publish the job fetches
`/`, `/setup/`, and the MLB relay and fails if the relay does not answer JSON.

To publish by hand, build and then run wrangler **from this directory**, so
the Pages Function under `functions/` ships with the site:

```sh
pnpm --filter @apple/virtual-apple build
cd apps/virtual-apple && wrangler pages deploy dist --project-name virtual-mets-apple --branch main
```

Every deployment stays in the Pages project, so a bad one can be rolled back
from the Cloudflare dashboard.

## Code map

| Path | Contents |
| --- | --- |
| `src/useLiveMetsGame.ts` | Live feed and shared-core lifecycle |
| `src/LiveGamedayWidget.tsx` | Game status and scoreboard presentation |
| `src/SharedAppleStage.tsx` | 3D Apple and field scene |
| `src/useCelebrationSound.ts` | Home run and win audio |
| `src/demoMode.ts` | Local-only fixture controls |
| `functions/api/mlb/` | Cloudflare MLB relay |
