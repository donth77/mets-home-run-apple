# Virtual Apple

Public-facing game-day experience sharing the Apple assembly, scoreboard and fixture contracts with Apple Lab. Unlike the Lab, its default scene is a lightweight Citi-inspired center-field environment.

```bash
pnpm dev:virtual
```

Virtual Apple checks the read-only MLB schedule on load. When no game is active it renders the between-games state and displays up to three future Mets games. During a live, delayed, review, or challenge state it bootstraps the authoritative feed, follows cursor-based diff patches, normalizes the result through `@apple/mlb-live-feed`, and sends every evidence envelope through the compiled C++ WebAssembly core. Historical bootstrap plays cannot start a celebration. New accepted home-run and win commands drive only the browser animation; no device transport exists in this app.

Schedule times use the browser's timezone; same-day games read `Today` or `Tonight`, next-day games read `Tomorrow`, and later games retain their weekday. An empty response leaves the schedule panel hidden. Live mode reads MLB's official `offseasonStartDate` and the following season's `springStartDate`, checks the New York calendar date once a minute, and refreshes that metadata daily. This enters offseason mode after MLB's season boundary and returns to the between-games/live flow automatically when spring baseball begins, even when the page remains open. Network failures preserve any previously loaded season dates, fail quietly into the between-games presentation when no dates are available, and retry automatically. Administrative controls, raw traces and hardware state remain exclusive to Apple Lab and the physical device's local dashboard.

The fixture bar is labelled **Demo** and is hidden by default. To expose it, use `http://localhost:4174/?demo=1` (or `?debug=1`) under the Vite development server. Choosing a fixture temporarily overrides the live presentation; **Live data** returns to the current schedule/feed state. The bar requires a development build, an explicit query flag and a loopback hostname, so a production deployment or LAN/external hostname cannot expose it even when the parameter is present.

## Mets Radio companion

The radio card plays the official free Mets Radio MP3 feed published by Audacy after a visitor presses `Listen live`. Browsers do not permit the page to autoplay audio. The card also links directly to the official Audacy station page as a fallback.

A deployment can override the default feed without changing application code:

```bash
VITE_METS_AUDIO_STREAM_URL=https://audio-provider.example/authorized-stream
```

The URL is consumed directly by the browser; Virtual Apple does not need an audio proxy or application server. Audacy's geographic availability and browser playback policies still apply.

## Scene sounds

For each Mets home run, Virtual Apple randomly chooses one of the four supplied recordings, `hr1.mp3` through `hr4.mp3`, and keeps that selection for the celebration. Playback is cut off when the home-run scene returns to live, even when the source recording is longer. For each Mets win it independently chooses one of the supplied full-length recordings, `win.mp3` or `win2.mp3`, and keeps that selection for the event. A visitor must turn on **Scene sound** before audio can play. The setting begins off on every page load because browsers require a user gesture before starting audio. Each accepted event key sounds only once, and replaying a development fixture re-arms its cue after the fixture returns to its opening frame. File provenance and checksums for the home-run audio are recorded in `THIRD_PARTY_AUDIO.md`.

An MLB status explicitly identified as rain activates slightly dimmed overcast lighting, depth-positioned rainfall with ground-impact ripples, the `RAIN DELAY` widget label, and procedural looping rain ambience. Other delayed states use the simpler `DELAY` widget and do not activate weather effects. The rain audio is generated in the browser and fades out when the rain-delay state clears, so it requires no additional recording or license attribution.

Selecting the Home Run, Review, Rain Delay, or Mets Win development demo automatically turns scene sound on from that same button press, so the fixture includes its audio without a separate setup step. Live games continue to respect the visitor's explicit sound setting.

The Mets-win takeover and raised Apple remain in place until the selected recording emits its playback-ended event. Confetti begins only after the Apple reaches its fully raised position. Turning celebration sound off, selecting another development fixture, or returning to live data cancels the song and releases that hold immediately; the Apple then lowers at its normal simulated speed. The browser presentation can therefore outlast the underlying 30-second Apple motion sequence without changing the shared firmware safety timing.

The `Mets win` fixture exercises a dedicated `canvas-confetti` victory layer. Home-run fixtures instead take over the center-field video board with a HOME RUN / hitter-name animation and select one fan-facing message from a reusable phrase pool for each playback. The selected phrase remains stable throughout the animation. Both use the project's 30-second raised hold, which is also the target for the physical firmware sequence.

The `Offseason` fixture removes the broadcast scorebug and replaces the center-field line score with a quiet offseason message. During an active game, the scorebug stays Mets-centric: it shows the Mets batter and his game line while the Mets bat, then the Mets pitcher and pitch count while the Mets field. The stadium board complements it with the opposing pitcher and pitch count while the Mets bat, or the opposing batter and game line while the Mets pitch. The Home Run and Mets Win takeovers hide those matchup fields.

When a game ends, the broadcast scorebug replaces the live count, bases, and outs with `FINAL`. The Mets Win stadium takeover also carries a `FINAL` marker, then returns to a final line score without current-pitcher or current-batter fields.

The stadium line score keeps nine inning columns. It displays innings 1–9 through regulation, then advances the window to 2–10, 3–11, and onward while the R/H/E columns remain fixed.

Active game states also show a compact action card linking directly to that game's MLB Gameday page. It identifies the matchup and Gameday's pitch-by-pitch, box-score, and Statcast coverage without repeating the score or inning. The card sits in the lower-right on wider screens and immediately above the development demo controls on mobile.

## Accessibility and deployment

The visible moment card remains a keyboard skip target, while a separate visually hidden status region announces meaningful score, inning, outs, delay/review, celebration, final, between-game, and offseason changes. Pitch descriptions remain visible but do not enter that live region. The automated accessibility suite scans the default state and every local demo presentation; real-browser zoom, contrast, keyboard, reduced-motion, and screen-reader checks remain part of release review. See [`docs/ACCESSIBILITY.md`](../../docs/ACCESSIBILITY.md).

Virtual Apple is a static build and does not require an application server. Production source maps are disabled. Deployments should set the response headers and external-origin allowlist described in [`docs/SECURITY.md`](../../docs/SECURITY.md), or route the MLB reads through the repository's bounded edge cache.
