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
- Sends optional home run and Mets win alerts from the installed app
- Supports mobile layouts, reduced motion, screen readers, and keyboard use

Focus view removes the surrounding page on desktop. On browsers with Document
Picture-in-Picture support, Mini Apple moves the same live view into a small
always-on-top window. Phones use the regular responsive page.

## How live games work

The browser checks the Mets schedule, follows the active MLB feed, and sends
normalized updates through the shared C++ game-state and decision code. That
code decides whether an event is new. The React app decides how to present it.

Virtual Apple has no connection to physical hardware.

## Notifications

Notifications start off. After installing Virtual Apple, a user can enable home
run and Mets win alerts independently. No account is required.

## Sound

Radio and celebration sound are separate controls. Radio uses the official
Mets stream published by Audacy. A deployment can point to another authorized,
browser-playable stream:

Browsers require a user action before playing audio, so celebration sound starts
off.

## Local demo controls

Demo controls are available only in a Vite development build on a loopback
address:

- <http://localhost:4174/?demo=1>
- <http://localhost:4174/?debug=1>

A demo fixture replaces the live presentation until **Live data** is selected.
Production builds do not expose this bar, even when the URL contains the flag.

## Code map

| Path | Contents |
| --- | --- |
| `src/useLiveMetsGame.ts` | Live feed and shared-core lifecycle |
| `src/LiveGamedayWidget.tsx` | Game status and scoreboard presentation |
| `src/SharedAppleStage.tsx` | 3D Apple and field scene |
| `src/useCelebrationSound.ts` | Home run and win audio |
| `src/NotificationSettings.tsx` | Installed-app notification controls |
| `src/demoMode.ts` | Local-only fixture controls |
| `functions/api/mlb/` | Cloudflare MLB relay |
| `edge/notifications/` | Scheduled watcher and Web Push delivery |
