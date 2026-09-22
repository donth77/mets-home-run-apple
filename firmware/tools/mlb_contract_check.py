#!/usr/bin/env python3
"""Check the live MLB Stats API against the code that consumes it.

The API is unofficial and changes without notice. This script fetches the
current Mets schedule and the most recent completed Mets game, then:

1. verifies the TLS chains still end at the roots the firmware pins: DigiCert
   Global Root G2 for MLB, and the GitHub roots in update_roots.hpp that the
   Apple's own firmware-release checks depend on, over TLS 1.2, the newest
   version the Nano's mbedTLS speaks;
2. verifies MLB's game-status table still carries the delay, suspended,
   postponed, and cancelled codes the shared classifier keys on;
3. fetches this week's schedule exactly as the Nano does (HTTP/1.0, its
   headers and `fields=` list, TLS 1.2), parses it with the Nano's C++ schedule
   parser and filter, and requires every game to read as MLB sent it and a
   game to follow whenever one is still to come;
4. verifies the `fields=` query still trims the live feed;
5. runs the native feed adapter (the same C++ the Nano executes) over both the
   full capture and the field-limited one fetched the Nano's way, requires
   identical frames, and requires the adapter's final score and home runs to
   match MLB's own linescore and box score;
6. replays the 2026-07-18 rain delay by timecode and requires the Game
   Advisory that names the rain, since the status block alone says "Delayed";
7. optionally runs the browser adapter's live contract test used by Apple Lab
   and Virtual Apple.

The `fields=` lists and the User-Agent come from the firmware sources, so this
check always asks for what the Nano asks for.

Exit status is non-zero on any failure so a scheduled GitHub Actions run
reports it. Run locally with:

    python3 firmware/tools/mlb_contract_check.py \
        --native .cache/native/test/native/apple_mlb_feed_tests --browser
"""

from __future__ import annotations

import argparse
import datetime as dt
import http.client
import json
import pathlib
import re
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
import zoneinfo

ORIGIN = "https://statsapi.mlb.com"
MLB_HOST = "statsapi.mlb.com"
METS = 121
PINNED_ROOT_NAME = "DigiCert Global Root G2"
MAX_FIELDS_BYTES = 400_000
TIMEOUT = 60
FIRMWARE = pathlib.Path(__file__).resolve().parents[1]
# The Apple's default zone; the Nano asks for the schedule from yesterday to a
# week ahead in local dates (refresh_schedule in src/apple_live/game/following.cpp).
DEVICE_ZONE = zoneinfo.ZoneInfo("America/New_York")


def firmware_string(relative: str, pattern: str) -> str:
    """A string constant read from the firmware source, so this check always
    sends what the Nano sends. Adjacent C++ string literals are joined."""
    match = re.search(pattern, (FIRMWARE / relative).read_text(), re.S)
    if not match:
        raise SystemExit(f"MLB API CONTRACT FAILED: could not read {pattern!r} from firmware/{relative}")
    return "".join(re.findall(r'"([^"]*)"', match.group(1)))


LIVE_FEED_FIELDS = firmware_string("lib/mlb_feed/src/feed.cpp", r'kLiveFeedFields\[\] =((?:\s*"[^"]*")+);')
SCHEDULE_FIELDS = firmware_string("lib/mlb_feed/src/schedule.cpp", r'kScheduleFields\[\] =((?:\s*"[^"]*")+);')
DEVICE_USER_AGENT = firmware_string("src/apple_live/net/https.cpp", r'setUserAgent\(("[^"]*")\)')


class ContractFailure(Exception):
    pass


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "HomeRunApple contract check"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        if response.status != 200:
            raise ContractFailure(f"{url} returned HTTP {response.status}")
        return response.read()


class _Http10Connection(http.client.HTTPSConnection):
    _http_vsn = 10
    _http_vsn_str = "HTTP/1.0"


def fetch_like_device(path: str) -> bytes:
    """GET from MLB the way the Nano's HTTPClient does: HTTP/1.0 (useHTTP10),
    the same headers, and TLS no newer than 1.2. The Nano reads the body as it
    arrives, so a chunked reply would be as fatal as a refused handshake."""
    context = ssl.create_default_context()
    context.maximum_version = ssl.TLSVersion.TLSv1_2
    connection = _Http10Connection(MLB_HOST, 443, timeout=TIMEOUT, context=context)
    try:
        connection.request("GET", path, headers={
            "Host": MLB_HOST,
            "User-Agent": DEVICE_USER_AGENT,
            "Connection": "close",
            "Accept": "application/json",
        })
        response = connection.getresponse()
        body = response.read()
    except (OSError, http.client.HTTPException) as error:
        raise ContractFailure(f"the Nano's request for {path[:60]} failed: {error}") from error
    finally:
        connection.close()
    if response.status != 200:
        raise ContractFailure(f"MLB answered the Nano's request for {path[:60]} with HTTP {response.status}")
    if "chunked" in (response.getheader("Transfer-Encoding") or "").lower():
        raise ContractFailure("MLB answered an HTTP/1.0 request with a chunked body, which the Nano cannot read")
    return body


def served_chain(host: str) -> list[bytes]:
    """The certificates a host serves over TLS 1.2, the newest the Nano speaks."""
    result = subprocess.run(
        ["openssl", "s_client", "-tls1_2", "-connect", f"{host}:443", "-servername", host, "-showcerts"],
        input=b"", capture_output=True, timeout=TIMEOUT,
    )
    blocks = re.findall(rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", result.stdout, re.S)
    if not blocks:
        raise ContractFailure(f"no TLS 1.2 handshake with {host}; the Nano's mbedTLS cannot use TLS 1.3")
    return blocks


def check_certificate_chain() -> None:
    """The device pins DigiCert Global Root G2; a new root needs a firmware update.

    Servers rarely send the root itself, so the check reads the issuer of the
    last certificate MLB serves (the intermediate), which must be that root.
    """
    blocks = served_chain(MLB_HOST)
    issuer = subprocess.run(["openssl", "x509", "-noout", "-issuer"], input=blocks[-1], capture_output=True, timeout=TIMEOUT)
    issuer_text = issuer.stdout.decode("utf-8", "replace").strip()
    if PINNED_ROOT_NAME not in issuer_text:
        raise ContractFailure(f"certificate chain no longer ends at {PINNED_ROOT_NAME}: {issuer_text}")
    print(f"certificate chain: {len(blocks)} certificates served over TLS 1.2, issued under {PINNED_ROOT_NAME}")


UPDATE_ROOTS_HEADER = pathlib.Path(__file__).resolve().parents[1] / "include" / "apple" / "firmware" / "update_roots.hpp"
GITHUB_HOSTS = ("api.github.com", "release-assets.githubusercontent.com")


def check_github_roots() -> None:
    """The Apple fetches its own firmware releases over TLS pinned to the roots in
    update_roots.hpp. Each host's served chain must still lead to one of them."""
    names = re.findall(r"^\s*// ([^:\n]+): ", UPDATE_ROOTS_HEADER.read_text(), re.M)
    names = [n for n in names if "Root" in n or "Authority" in n]
    if not names:
        raise ContractFailure(f"no root names found in {UPDATE_ROOTS_HEADER.name}")
    for host in GITHUB_HOSTS:
        blocks = served_chain(host)
        issuer = subprocess.run(["openssl", "x509", "-noout", "-issuer"], input=blocks[-1], capture_output=True, timeout=TIMEOUT)
        issuer_text = issuer.stdout.decode("utf-8", "replace").strip()
        if not any(name in issuer_text for name in names):
            raise ContractFailure(f"{host} chain no longer ends at a pinned root ({', '.join(names)}): {issuer_text}")
    print(f"github roots: {', '.join(GITHUB_HOSTS)} still chain to the pinned roots over TLS 1.2")


def interrupted(detailed_state: str) -> bool:
    """The words ScheduleGame::followable() treats as a game that will not be played now."""
    return any(word in detailed_state.lower() for word in ("postponed", "cancelled", "canceled", "suspended"))


def node_at(document: dict, path: tuple[str, ...], what: str):
    node = document
    for key in path:
        if not isinstance(node, dict) or key not in node:
            raise ContractFailure(f"{what} lost {'.'.join(path)}")
        node = node[key]
    return node


def parse_utc(value: str) -> int | None:
    try:
        return int(dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def check_schedule_through_device(native: pathlib.Path, workdir: pathlib.Path) -> None:
    """The Nano's first request after joining Wi-Fi, and every hour after: this
    week's schedule, parsed by its C++ with its filter. Every game must read the
    way MLB sent it, and a game still to come must be one the Nano follows."""
    today = dt.datetime.now(DEVICE_ZONE).date()
    start = (today - dt.timedelta(days=1)).isoformat()
    end = (today + dt.timedelta(days=7)).isoformat()
    body = fetch_like_device(
        f"/api/v1/schedule?sportId=1&teamId={METS}&startDate={start}&endDate={end}"
        f"&hydrate=team&fields={SCHEDULE_FIELDS}"
    )
    payload = json.loads(body)
    path = workdir / "schedule.json"
    path.write_bytes(body)
    now = int(time.time())
    result = subprocess.run([str(native), "--schedule", str(path), str(now)], capture_output=True, text=True, timeout=120)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise ContractFailure("the Nano's schedule parser rejected this week's schedule")
    printed = dict(line.split(" ", 1) for line in result.stdout.splitlines() if " " in line)
    if "SCHEDULE" not in printed or "CHOSEN" not in printed:
        raise ContractFailure(f"the native schedule check printed nothing usable: {result.stdout[:200]!r}")
    parsed = json.loads(printed["SCHEDULE"])
    chosen = printed["CHOSEN"].strip()

    # What MLB sent, read directly, under the parser's own rule for which
    # entries are games (a positive gamePk, game 1 or 2, and teams).
    sent = []
    for date in payload.get("dates", []):
        for game in date.get("games", []):
            if not isinstance(game, dict) or not isinstance(game.get("teams"), dict):
                continue
            if not isinstance(game.get("gamePk"), int) or game["gamePk"] <= 0 or game.get("gameNumber", 1) not in (1, 2):
                continue
            status = game.get("status", {})
            teams = game["teams"]
            sent.append({
                "gamePk": game["gamePk"],
                "gameNumber": game.get("gameNumber"),
                "officialDate": date.get("date"),
                "gameDate": game.get("gameDate"),
                "abstractGameState": status.get("abstractGameState"),
                "detailedState": status.get("detailedState"),
                "away": {key: teams.get("away", {}).get("team", {}).get(key) for key in ("id", "abbreviation")},
                "home": {key: teams.get("home", {}).get("team", {}).get(key) for key in ("id", "abbreviation")},
            })
    if len(parsed) != len(sent):
        raise ContractFailure(f"MLB sent {len(sent)} games for {start}..{end}; the Nano's parser read {len(parsed)}")
    for expected, read in zip(sent, parsed):
        for key, value in expected.items():
            if read.get(key) != value:
                raise ContractFailure(
                    f"game {expected['gamePk']}: MLB sent {key}={value!r}, the Nano's parser read {read.get(key)!r}")

    # The choice rules are unit-tested; this only requires that a followable
    # game still to come is not lost, and that the choice is a real game.
    upcoming = [game["gamePk"] for game in parsed if game["followable"] and game["abstractGameState"].lower() != "final"
                and (game["abstractGameState"].lower() == "live" or (parse_utc(game["gameDate"]) or 0) > now)]
    if chosen == "none":
        if upcoming:
            raise ContractFailure(f"games {upcoming} are still to come, but the Nano would follow none of them")
    elif int(chosen) not in {game["gamePk"] for game in parsed}:
        raise ContractFailure(f"the Nano would follow game {chosen}, which is not on the schedule")
    print(f"device schedule: {len(parsed)} games {start}..{end} read as sent; the Nano would follow {chosen}")


def check_adapter_reading(summary: dict, full_feed: dict) -> None:
    """The captures parsing identically proves nothing if both miss the home
    runs, say because MLB renamed the event type the adapter keys on. So the
    adapter's reading must agree with MLB's own linescore and box score."""
    if summary.get("phase") != "FINAL":
        raise ContractFailure(f"the adapter reads the completed game as {summary.get('phase')!r}, not FINAL")
    found = {}
    for side in ("away", "home"):
        team = summary[side]
        expected_id = node_at(full_feed, ("gameData", "teams", side, "id"), "full feed")
        runs = node_at(full_feed, ("liveData", "linescore", "teams", side, "runs"), "full feed")
        home_runs = node_at(full_feed, ("liveData", "boxscore", "teams", side, "teamStats", "batting", "homeRuns"), "full feed")
        if team["id"] != expected_id:
            raise ContractFailure(f"the adapter reads the {side} team as {team['id']}; MLB says {expected_id}")
        if team["runs"] != runs:
            raise ContractFailure(f"the adapter reads the {side} score as {team['runs']}; MLB's linescore says {runs}")
        found[side] = team["homeRuns"] + team["grandSlams"]
        if found[side] != home_runs:
            raise ContractFailure(
                f"the adapter found {found[side]} home runs by the {side} team; MLB's box score counts {home_runs}. "
                "A home run the adapter misses is one the Apple never celebrates.")
    print(f"adapter reading: {summary['away']['abbreviation']} {summary['away']['runs']}, "
          f"{summary['home']['abbreviation']} {summary['home']['runs']}, final; "
          f"{found['away']} and {found['home']} home runs, as MLB's box score counts them")


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
            f"&fields={SCHEDULE_FIELDS}"
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
    # Postponed and cancelled games are abstractly Final too, but have no plays.
    finals = [game for game in games if game["status"].get("abstractGameState") == "Final"
              and not interrupted(game["status"].get("detailedState", ""))]
    if not finals:
        raise ContractFailure("no completed Mets game in the window to exercise the live feed")
    return max(finals, key=lambda game: game["gameDate"])


def check_live_feed(game: dict, native: pathlib.Path | None, workdir: pathlib.Path) -> None:
    game_pk = game["gamePk"]
    full = fetch(f"{ORIGIN}/api/v1.1/game/{game_pk}/feed/live")
    fields = fetch_like_device(f"/api/v1.1/game/{game_pk}/feed/live?fields={LIVE_FEED_FIELDS}")
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
    summary = next((line.split(" ", 1)[1] for line in result.stdout.splitlines() if line.startswith("SUMMARY ")), None)
    if summary is None:
        raise ContractFailure("the native feed adapter printed no SUMMARY line")
    check_adapter_reading(json.loads(summary), json.loads(full))


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
        check_github_roots()
        check_game_statuses()
        game = recent_final_game()
        with tempfile.TemporaryDirectory() as tmp:
            if args.native is not None:
                check_schedule_through_device(args.native, pathlib.Path(tmp))
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
