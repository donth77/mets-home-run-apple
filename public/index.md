# Virtual Mets Apple

Virtual Mets Apple is a free, unofficial site for following Mets games. The
main view pairs live game information with a 3D version of the Citi Field Home
Run Apple.

## What it shows

- Score, inning, outs, count, runners, and the current batter or pitcher
- Upcoming games and doubleheaders
- Reviews, delays, postponements, finals, and feed interruptions
- A raised Apple and stadium-board takeover for confirmed Mets home runs and
  wins
- Optional Mets Radio, celebration sounds, reduced motion, keyboard controls,
  and screen-reader updates
- Optional home run and Mets win notifications from the installed app
- Focus and Mini Apple views on supported desktop browsers

## Live data

The site reads public MLB schedule and live-game data. Shared C++ code, compiled
for the browser, builds the scoreboard state and decides whether a home run or
win is new.

When someone opens the site late, most earlier plays are treated as history. A
Mets home run or win from the previous five minutes may play once so visitors
can see the full sequence. Older events do not replay.

MLB data can be late or temporarily unavailable. Check MLB Gameday when you
need the official game state.

## About the project

Virtual Mets Apple is part of the open-source
[Mets Home Run Apple](https://github.com/donth77/mets-home-run-apple) project.
The same repository contains the Home Run Apple firmware and the Apple Lab
builder tool. The public site cannot find or control physical hardware.

This project is not affiliated with, endorsed by, or sponsored by the New York
Mets, Major League Baseball, Citi Field, or Audacy.
