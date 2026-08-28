# Virtual Mets Apple

Virtual Mets Apple is a free, unofficial fan-made website for following New York Mets games. Its main view recreates the Citi Field center-field Home Run Apple in 3D and pairs it with live scoreboards and game status.

## What the site does

- Shows the current Mets score, inning, outs, count, runners, and batter or pitcher when that information is available.
- Raises the virtual Apple for confirmed Mets home runs and Mets wins.
- Shows dedicated home run and win animations on the stadium scoreboard.
- Handles reviews, challenges, rain delays, doubleheaders, final games, feed interruptions, and the time between games.
- Lists upcoming Mets games when the season is active and no game is in progress.
- Offers optional Mets Radio playback, celebration sounds, a reduced-motion presentation, keyboard controls, and screen-reader game-status announcements.
- Offers Focus and Mini Apple views on supported desktop browsers.

## Live data

The browser reads public MLB Stats API schedule and live-game data. A shared C++ rules engine, compiled to WebAssembly, decides when a new home run or Mets win should start an Apple sequence. The initial game history is used only to establish current state, so loading the page after a home run does not replay an old celebration.

Live data can be delayed or temporarily unavailable. MLB Gameday is the authoritative place to confirm the current game state.

## About the project

Virtual Mets Apple is part of the open-source [Mets Home Run Apple project](https://github.com/donth77/mets-home-run-apple), which also includes Apple Lab and work toward a standalone physical Wi-Fi Apple. The public website cannot connect to or command physical hardware.

This project is not affiliated with, endorsed by, or sponsored by the New York Mets, Major League Baseball, Citi Field, or Audacy.
