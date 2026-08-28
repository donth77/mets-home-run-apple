# Virtual Apple

Virtual Apple is a public, browser-based game companion: live Mets information, a Citi-inspired center-field scene, and an Apple that rises for home runs and wins.

Live site: [metsapple.com](https://metsapple.com/).

To run it locally:

```bash
pnpm dev:virtual
```

Open [http://localhost:4174](http://localhost:4174).

## Live game flow

The site checks the Mets schedule when it loads. Between games, it can show the next three matchups. During a live game—including delays, challenges, and reviews—it follows MLB feed updates through `@apple/mlb-live-feed` and sends normalized evidence to the compiled C++ core.

The initial game history seeds the core without celebrating old plays. Only a newly accepted home run or win starts the apple animation. Virtual Apple has no route to a physical device.

## Scoreboards and celebrations

- The compact scorebug shows the Mets batter and line while New York bats, or the Mets pitcher and pitch count while New York fields.
- The stadium line score keeps runs, hits, and errors fixed while its nine-inning window advances in extra innings.
- Rains in the Citi Field scene during a Mets home-game rain delay. 
- Home runs take over the stadium board with **HOME RUN** and the hitter's name.
- Mets wins get a separate final-score takeover and confetti after the Apple is fully raised.
- The Apple uses the same 30-second raised hold targeted by the physical firmware.

Active games also include a compact link to MLB Gameday.

## Desktop views

**Focus view** keeps the field and compact scorebug in the current tab, hiding the rest of the UI.

On browsers with Document Picture-in-Picture support, **Mini Apple** moves that same live presentation into a small always-on-top window. It includes the compact scorebug, a short game-status area, scene-sound control, and a Return button. 

## Mobile layout

Phones use the regular page instead of Focus or Mini Apple. The radio stacks beneath the header, the scene-sound button remains easy to reach, and the scorebug sits in the bottom-right of the field without overlapping the large stadium board. Game status, upcoming games, and local demo controls flow beneath the scene when they apply.

## Local demo controls

The **Demo** bar is available only from a Vite development build on a loopback address with an explicit flag:

- [http://localhost:4174/?demo=1](http://localhost:4174/?demo=1)
- [http://localhost:4174/?debug=1](http://localhost:4174/?debug=1)

A fixture temporarily replaces the live presentation. Choose **Live data** to return. Production builds and non-loopback hosts cannot expose the bar, even with the parameter.

## Radio and scene sound

The radio card plays the official Mets Radio stream published by Audacy. The radio icon and **Listen live** button control the same player. It also links to the Audacy station page if direct playback is unavailable.

A deployment can supply another authorized browser-playable feed:

```bash
VITE_METS_AUDIO_STREAM_URL=https://audio-provider.example/authorized-stream
```

No audio proxy or application server is required.

Radio playback and celebration sound are separate controls. The speaker button enables home-run and win clips; it does not mute the radio. A radio stream that is already playing continues when Focus view or Mini Apple hides the radio card.

Celebration sound is opt-in. A home run chooses one of four supplied clips; a win chooses one of two longer recordings. Each accepted event sounds once. Stopping sound, changing a local fixture, or returning to live data stops the current clip and releases any presentation-only hold. See [`THIRD_PARTY_AUDIO.md`](./THIRD_PARTY_AUDIO.md) for checksums and provenance.
