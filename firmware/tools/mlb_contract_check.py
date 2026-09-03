#!/usr/bin/env python3
"""Check the live MLB Stats API against the code that consumes it.

The API is unofficial and changes without notice. This script fetches the
current Mets schedule and the most recent completed Mets game, then:

1. verifies the TLS chain still ends at the root certificate the firmware
   pins (DigiCert Global Root G2);
2. verifies MLB's game-status table still carries the delay, suspended,
   postponed, and cancelled codes the shared classifier keys on;
3. verifies the `fields=` query still trims the live feed;
4. runs the native feed adapter (the same C++ the Nano executes) over both the
   full and the field-limited capture and requires identical frames;
5. replays the 2026-07-18 rain delay by timecode and requires the Game
   Advisory that names the rain, since the status block alone says "Delayed";
6. optionally runs the browser adapter's live contract test used by Apple Lab
   and Virtual Apple.

Exit status is non-zero on any failure so a scheduled GitHub Actions run
reports it. Run locally with:

    python3 firmware/tools/mlb_contract_check.py \
        --native .cache/native/test/native/apple_mlb_feed_tests --browser
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.request

ORIGIN = "https://statsapi.mlb.com"
METS = 121
PINNED_ROOT_NAME = "DigiCert Global Root G2"
MAX_FIELDS_BYTES = 400_000
TIMEOUT = 60

LIVE_FEED_FIELDS = (
    "gamePk,metaData,timeStamp,wait,gameData,status,abstractGameState,detailedState,statusCode,"
    "reason,teams,away,home,id,abbreviation,teamName,name,datetime,dateTime,venue,liveData,plays,"
    "allPlays,currentPlay,about,atBatIndex,halfInning,inning,isComplete,result,eventType,rbi,"
    "description,matchup,batter,pitcher,fullName,playEvents,playId,details,reviewDetails,"
    "inProgress,isOverturned,count,balls,strikes,linescore,currentInning,inningState,inningHalf,"
    "outs,innings,num,runs,hits,errors,offense,defense,first,second,third,boxscore,players,stats,"
    "batting,pitching,atBats,homeRuns,numberOfPitches"
)


class ContractFailure(Exception):
    pass


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "HomeRunApple contract check"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        if response.status != 200:
            raise ContractFailure(f"{url} returned HTTP {response.status}")
        return response.read()


def check_certificate_chain() -> None:
    """The device pins DigiCert Global Root G2; a new root needs a firmware update.

    Servers rarely send the root itself, so the check reads the issuer of the
    last certificate MLB serves (the intermediate), which must be that root.
    """
    result = subprocess.run(
        ["openssl", "s_client", "-connect", "statsapi.mlb.com:443", "-servername", "statsapi.mlb.com", "-showcerts"],
        input=b"", capture_output=True, timeout=TIMEOUT,
    )
    blocks = re.findall(rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", result.stdout, re.S)
    if not blocks:
        raise ContractFailure("openssl returned no certificates for statsapi.mlb.com")
    issuer = subprocess.run(["openssl", "x509", "-noout", "-issuer"], input=blocks[-1], capture_output=True, timeout=TIMEOUT)
    issuer_text = issuer.stdout.decode("utf-8", "replace").strip()
    if PINNED_ROOT_NAME not in issuer_text:
        raise ContractFailure(f"certificate chain no longer ends at {PINNED_ROOT_NAME}: {issuer_text}")
    print(f"certificate chain: {len(blocks)} certificates served, issued under {PINNED_ROOT_NAME}")


def recent_final_game() -> dict:
    # Ten days covers any in-season week. In the offseason there is nothing
    # recent, so widen to the last completed game of the season: the API tends
    # to change over the winter, and that game still exercises every parser.
    today = dt.datetime.now(dt.timezone.utc).date()
    games: list[dict] = []
    for lookback in (10, 220):
        start = (today - dt.timedelta(days=lookback)).isoformat()
        end = (today + dt.timedelta(days=1)).isoformat()
        url = (
            f"{ORIGIN}/api/v1/schedule?sportId=1&teamId={METS}&startDate={start}&endDate={end}&hydrate=team"
            "&fields=dates,date,games,gamePk,gameNumber,gameDate,status,abstractGameState,detailedState,teams,away,home,team,id,abbreviation,name,venue"
        )
        payload = json.loads(fetch(url))
        games = [game for date in payload.get("dates", []) for game in date.get("games", [])]
        if games:
            break
    if not games:
        raise ContractFailure("schedule returned no Mets games in the last seven months")
    for game in games:
        for key in ("gamePk", "gameDate", "status", "teams"):
            if key not in game:
                raise ContractFailure(f"schedule game is missing {key}: {json.dumps(game)[:200]}")
        if "abstractGameState" not in game["status"]:
            raise ContractFailure("schedule status lost abstractGameState")
        for side in ("away", "home"):
            team = game["teams"].get(side, {}).get("team", {})
            if not isinstance(team.get("id"), int) or not team.get("abbreviation"):
                raise ContractFailure(f"schedule {side} team lost id or abbreviation")
    print(f"schedule: {len(games)} Mets games between {start} and {end}")
    finals = [game for game in games if game["status"].get("abstractGameState") == "Final"]
    if not finals:
        raise ContractFailure("no completed Mets game in the window to exercise the live feed")
    return max(finals, key=lambda game: game["gameDate"])


def check_live_feed(game: dict, native: pathlib.Path | None, workdir: pathlib.Path) -> None:
    game_pk = game["gamePk"]
    full = fetch(f"{ORIGIN}/api/v1.1/game/{game_pk}/feed/live")
    fields = fetch(f"{ORIGIN}/api/v1.1/game/{game_pk}/feed/live?fields={LIVE_FEED_FIELDS}")
    print(f"live feed {game_pk}: full {len(full)} bytes, fields {len(fields)} bytes")
    if len(fields) > MAX_FIELDS_BYTES:
        raise ContractFailure(f"the fields query no longer trims the feed ({len(fields)} bytes)")
    if len(fields) >= len(full):
        raise ContractFailure("the fields response is not smaller than the full feed")
    feed = json.loads(fields)
    for path in (
        ("gamePk",),
        ("metaData", "timeStamp"),
        ("gameData", "status", "abstractGameState"),
        ("gameData", "teams", "away", "id"),
        ("gameData", "teams", "home", "id"),
        ("liveData", "plays", "allPlays"),
        ("liveData", "linescore", "teams", "away", "runs"),
    ):
        node = feed
        for key in path:
            if not isinstance(node, dict) or key not in node:
                raise ContractFailure(f"live feed lost {'.'.join(path)}")
            node = node[key]
    if not re.fullmatch(r"\d{8}_\d{6}", feed["metaData"]["timeStamp"]):
        raise ContractFailure(f"metaData.timeStamp format changed: {feed['metaData']['timeStamp']!r}")
    plays = feed["liveData"]["plays"]["allPlays"]
    if not plays:
        raise ContractFailure("completed game has no plays")
    sample = plays[-1]
    for key in ("about", "result", "matchup", "playEvents"):
        if key not in sample:
            raise ContractFailure(f"play lost {key}")
    if "eventType" not in sample["result"] or "atBatIndex" not in sample["about"]:
        raise ContractFailure("play lost result.eventType or about.atBatIndex")
    print(f"live feed: {len(plays)} plays, cursor {feed['metaData']['timeStamp']}")
    # MLB has always answered 10 here; the firmware clamps to 10..60 s. A new
    # value is worth knowing about even though it is not a failure.
    wait = feed["metaData"].get("wait")
    if wait != 10:
        print(f"NOTE: metaData.wait is {wait!r}, not the usual 10; the firmware clamps polls to 10..60 s")

    if native is None:
        return
    full_path = workdir / "full.json"
    fields_path = workdir / "fields.json"
    full_path.write_bytes(full)
    fields_path.write_bytes(fields)
    result = subprocess.run([str(native), str(full_path), str(fields_path)], capture_output=True, text=True, timeout=300)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise ContractFailure("the native feed adapter rejected the live capture or the fields capture differs")


def check_browser_adapter(root: pathlib.Path) -> None:
    result = subprocess.run(
        ["pnpm", "--filter", "@apple/mlb-live-feed", "exec", "vitest", "run", "--config", "../../vitest.config.ts", "src/contract.live.test.ts"],
        cwd=root, env={**__import__("os").environ, "MLB_CONTRACT_LIVE": "1"}, timeout=600,
    )
    if result.returncode != 0:
        raise ContractFailure("the browser feed adapter failed against the live API")


# Status codes the shared classifier keys on (firmware/lib/game_state/src/status.cpp):
# I = in progress, P = pre-game; R rain, I inclement weather, L lightning, G wet grounds.
WEATHER_DELAY_CODES = {
    "IR": "Delayed: Rain",
    "II": "Delayed: Inclement Weather",
    "IL": "Delayed: Lightning",
    "IG": "Delayed: Wet Grounds",
    "PR": "Delayed Start: Rain",
    "PI": "Delayed Start: Inclement Weather",
    "PL": "Delayed Start: Lightning",
    "PG": "Delayed Start: Wet Grounds",
}
# Mets at Phillies, 2026-07-18, the moment a 45-minute rain delay began. MLB's
# status said only "Delayed" (IO); the reason rode on a Game Advisory play
# event. The feed's timecode query replays history, so this snapshot is fixed.
DELAY_GAME_PK = 823441
DELAY_TIMECODE = "20260718_212943"
DELAY_ADVISORY = "Status Change - Delayed: Rain"


def check_game_statuses() -> None:
    rows = json.loads(fetch(f"{ORIGIN}/api/v1/gameStatus"))
    by_code = {row.get("statusCode"): row for row in rows if isinstance(row, dict)}
    expected = dict(WEATHER_DELAY_CODES)
    expected.update({"IO": "Delayed", "PO": "Delayed Start", "TR": "Suspended: Rain", "DR": "Postponed: Rain",
                     "CR": "Cancelled: Rain", "FR": "Completed Early: Rain", "F": "Final", "I": "In Progress"})
    for code, detailed in expected.items():
        row = by_code.get(code)
        if row is None:
            raise ContractFailure(f"gameStatus lost code {code} ({detailed})")
        if row.get("detailedState") != detailed:
            raise ContractFailure(f"gameStatus {code} now reads {row.get('detailedState')!r}, expected {detailed!r}")
    # Postponed and cancelled games are abstractly Final; the classifier tests
    # the interruption words first because of this.
    for code in ("DR", "CR"):
        if by_code[code].get("abstractGameState") != "Final":
            raise ContractFailure(f"gameStatus {code} abstractGameState changed to {by_code[code].get('abstractGameState')!r}")
    print(f"game statuses: {len(rows)} rows; the delay, suspended, postponed, and cancelled codes are intact")


def check_delay_advisory() -> None:
    feed = json.loads(fetch(f"{ORIGIN}/api/v1.1/game/{DELAY_GAME_PK}/feed/live?timecode={DELAY_TIMECODE}&fields={LIVE_FEED_FIELDS}"))
    status = feed["gameData"]["status"]
    if status.get("detailedState") != "Delayed" or status.get("statusCode") != "IO":
        raise ContractFailure(f"the 2026-07-18 delay snapshot now reads {status!r}")
    events = feed["liveData"]["plays"]["currentPlay"].get("playEvents", [])
    advisories = [event.get("details", {}).get("description") for event in events
                  if event.get("details", {}).get("eventType") == "game_advisory"]
    if advisories[-1:] != [DELAY_ADVISORY]:
        raise ContractFailure(f"the delay's Game Advisory changed: {advisories!r}")
    print("delay advisory: the 2026-07-18 feed still names the rain on a game_advisory play event")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--native", type=pathlib.Path, help="path to the built apple_mlb_feed_tests binary")
    parser.add_argument("--browser", action="store_true", help="also run the browser adapter's live contract test")
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    try:
        check_certificate_chain()
        check_game_statuses()
        game = recent_final_game()
        with tempfile.TemporaryDirectory() as tmp:
            check_live_feed(game, args.native, pathlib.Path(tmp))
        check_delay_advisory()
        if args.browser:
            check_browser_adapter(root)
    except ContractFailure as failure:
        print(f"MLB API CONTRACT FAILED: {failure}", file=sys.stderr)
        return 1
    print("MLB API contract check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
