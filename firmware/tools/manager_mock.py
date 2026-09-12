#!/usr/bin/env python3
"""Serve the Apple Manager page against a fake Apple, for working on the page
without a board.

    python3 tools/manager_mock.py            # connected, following a live game
    python3 tools/manager_mock.py --setup    # first boot: setup network open, no Wi-Fi yet
    python3 tools/manager_mock.py --port 8765

Then open http://127.0.0.1:8765/. The mock answers the same routes as the
firmware (/api/status, /api/networks, /api/timezones, POST /api/wifi,
/api/wifi/forget, /api/settings, /api/update, /api/update/check,
/api/update/install, /api/restart) and reads the time zone table straight from
lib/manager/src/time_zones.cpp so the page sees the real list. A join succeeds
after a few status polls; settings are kept in memory.
"""
import argparse
import http.server
import json
import pathlib
import re
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
PAGE_DIR = HERE.parent / "lib" / "manager" / "page"
ZONES_CPP = HERE.parent / "lib" / "manager" / "src" / "time_zones.cpp"


def load_zones():
    text = ZONES_CPP.read_text()
    zones = []
    for m in re.finditer(r'\{"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*((?:"[^"]*"\s*)+)\}', text):
        aliases = " ".join(re.findall(r'"([^"]*)"', m.group(4)))
        zones.append({"id": m.group(1), "label": m.group(2), "aliases": aliases})
    return zones


ZONES = load_zones()


def zone_label(tz):
    for z in ZONES:
        if z["id"] == tz:
            return z["label"]
    return ""


def zone_id(name):
    for z in ZONES:
        if z["id"] == name or name in z["aliases"].split():
            return z["id"]
    return None


def make_handler(state):
    def release_status():
        rel = state["release"]
        # A check answers on the next poll; a download restarts after three.
        if rel["state"] == "CHECKING":
            rel["state"] = "AVAILABLE" if rel["found"] else "UP_TO_DATE"
            rel["checkedAt"] = 1788392040
        elif rel["state"] == "DOWNLOADING":
            rel["ticks"] += 1
            if rel["ticks"] >= 3:
                state["version"] = rel["version"]
                rel.update(state="IDLE", version="", found=False, ticks=0)
                state["polls"] = -3
        return {"state": rel["state"], "version": rel["version"] if rel["state"] in ("AVAILABLE", "DOWNLOADING") else "",
                "prerelease": rel["prerelease"], "size": 1515957 if rel["state"] == "AVAILABLE" else 0,
                "checkedAt": rel["checkedAt"], "nextCheckIn": 86000, "error": rel["error"], "windowOpen": False}

    def status():
        state["polls"] += 1
        connected = state["joined"] and state["polls"] > 2
        if state["polls"] <= 0:
            raise ConnectionError("restarting")
        settings = state["settings"]
        return {
            "type": "status",
            "mode": "LIVE" if connected else "SETUP",
            "firmwareVersion": state["version"],
            "hostname": "home-run-apple",
            "motion": "L298N" if settings["motor"] else "RECORDING",
            "wifi": {
                "configured": state["joined"],
                "state": "CONNECTED" if connected else ("CONNECTING" if state["joined"] else "NO_CREDENTIALS"),
                "ssid": "MyHome" if state["joined"] else "",
                "rssi": -55,
                "ip": "192.168.1.42" if connected else "",
                "setupNetwork": not connected or state["setup_network"],
                "setupClients": 1,
            },
            "clock": connected,
            "game": {"gamePk": 822931, "gameNumber": 1, "away": "NYM", "home": "TB",
                     "scheduled": "2026-09-02T22:40:00Z", "state": "In Progress"} if connected else None,
            "snapshot": {"phase": "LIVE", "label": "LIVE", "awayRuns": 6, "homeRuns": 4, "inning": 7,
                         "half": "TOP", "outs": 2, "awayId": 121, "homeId": 139} if connected else None,
            "poll": {"ok": 3 if connected else 0, "failed": 0, "lastMs": 1800, "lastBytes": 34000,
                     "nextInMs": 42000, "lastError": ""},
            "schedule": {"ok": 5 if connected else 0, "failed": 1, "lastMs": 900, "lastError": "",
                         "checkedAgoMs": 240000, "nextInMs": 360000, "refreshMs": 600000, "games": 8},
            "settings": dict(settings, timeZoneLabel=zone_label(settings["timeZone"]),
                             setupKey="" if settings["requireCode"] else "00000000"),
            "audio": state["audio"],
            "update": release_status(),
            "lastCelebration": {"kind": "HR", "subject": "Juan Soto", "at": 1788392040, "moved": True, "track": "Takeover"},
            "sequence": "IDLE", "fault": False, "positionMm": 0,
        }

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(PAGE_DIR), **kw)

        def log_message(self, *a):
            pass

        def send_json(self, obj, code=200):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/api/status"):
                try:
                    return self.send_json(status())
                except ConnectionError:
                    self.send_response(503)
                    self.end_headers()
                    return None
            if self.path.startswith("/api/audio/file"):
                import math, struct
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                target = q.get("file", [""])[0]
                if not any(t["file"] == target for t in state["audio"]["tracks"]):
                    return self.send_json({"ok": False, "error": "NO_TRACK"}, 404)
                rate, secs = 22050, 2
                pcm = b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(rate * secs))
                head = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm))
                body = head + pcm
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return None
            if self.path.startswith("/api/timezones"):
                return self.send_json(ZONES)
            if self.path.startswith("/api/networks"):
                return self.send_json({"scanning": False, "networks": [
                    {"ssid": "MyHome", "rssi": -50, "secure": True},
                    {"ssid": "Neighbor", "rssi": -80, "secure": True},
                    {"ssid": "Cafe", "rssi": -70, "secure": False}]})
            if self.path == "/":
                self.path = "/index.html"
            return super().do_GET()

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            settings = state["settings"]
            if settings["requireCode"] and self.headers.get("X-Apple-Code", "") != "00000000":
                return self.send_json({"ok": False, "error": "CODE"}, 401)
            if self.path == "/api/audio/upload":
                audio = state["audio"]
                if len(audio["tracks"]) >= audio["maxTracks"]:
                    return self.send_json({"ok": False, "error": "LIBRARY_FULL"}, 400)
                # Check the WAV the page built really is what the Apple accepts.
                start = body.find(b"RIFF")
                if start < 0 or body[start + 8:start + 12] != b"WAVE":
                    return self.send_json({"ok": False, "error": "NOT_WAV"}, 400)
                head = body[start:start + 44]
                rate = int.from_bytes(head[24:28], "little")
                channels = int.from_bytes(head[22:24], "little")
                bits = int.from_bytes(head[34:36], "little")
                if channels != 1:
                    return self.send_json({"ok": False, "error": "NOT_MONO"}, 400)
                if bits != 16:
                    return self.send_json({"ok": False, "error": "NOT_16_BIT"}, 400)
                if rate != 22050:
                    return self.send_json({"ok": False, "error": "WRONG_RATE"}, 400)
                name = "/uploaded-%d.wav" % (len(audio["tracks"]) + 1)
                m = re.search(rb'filename="([^"]+)"', body[:400])
                if m:
                    name = "/" + m.group(1).decode(errors="replace")
                audio["tracks"].append({"file": name, "title": name.lstrip("/"),
                                        "bytes": len(body), "hr": True, "win": False})
                return self.send_json({"ok": True})
            if self.path == "/api/update":
                # Any multipart body counts as a signed image here; the real
                # Apple checks the signature. The "new" version shows up after
                # a short fake restart.
                if b"HRAPPLE1" not in body[-4096:]:
                    return self.send_json({"ok": False, "error": "NOT_SIGNED"}, 400)
                state["version"] = "0.2.1-mock"
                state["polls"] = -3
                return self.send_json({"ok": True})
            args = urllib.parse.parse_qs(body.decode(errors="replace"))
            if self.path == "/api/wifi":
                state["joined"] = True
                state["polls"] = 0
                tz = zone_id(args.get("tz", [""])[0])
                if tz and not settings["timeZoneChosen"]:
                    settings["timeZone"] = tz
                    settings["timeZoneChosen"] = True
                return self.send_json({"ok": True})
            if self.path == "/api/restart":
                state["polls"] = -6
                return self.send_json({"ok": True})
            if self.path == "/api/update/check":
                rel = state["release"]
                rel.update(state="CHECKING", error="", found=True, version="0.3.0-mock", prerelease=settings["beta"])
                return self.send_json({"ok": True})
            if self.path == "/api/update/install":
                rel = state["release"]
                if rel["state"] != "AVAILABLE":
                    return self.send_json({"ok": False, "error": "NO_UPDATE"}, 409)
                rel.update(state="DOWNLOADING", ticks=0)
                return self.send_json({"ok": True})
            if self.path == "/api/audio/set":
                audio = state["audio"]
                action = args.get("action", [""])[0]
                target = args.get("file", [""])[0]
                track = next((t for t in audio["tracks"] if t["file"] == target), None)
                if action == "stop":
                    audio["playing"] = ""
                    return self.send_json({"ok": True})
                if action in ("queue", "unqueue", "clear"):
                    win = args.get("win", [""])[0] in ("on", "1", "true")
                    name = "" if win else args.get("text", [""])[0]
                    who = 0 if win else int(args.get("id", ["0"])[0] or 0)
                    queue = audio.setdefault("next", [])
                    same = lambda n: n["win"] == win and (win or n["name"] == name)
                    if action == "clear":
                        audio["next"] = [n for n in queue if not same(n)]
                    elif track is None:
                        return self.send_json({"ok": False, "error": "NO_TRACK"}, 400)
                    elif action == "unqueue":
                        for i, n in enumerate(queue):
                            if same(n) and n["file"] == target:
                                del queue[i]
                                break
                        else:
                            return self.send_json({"ok": False, "error": "NO_TRACK"}, 400)
                    else:
                        if sum(1 for n in queue if same(n)) >= 5:
                            return self.send_json({"ok": False, "error": "QUEUE_FULL"}, 400)
                        queue.append({"win": win, "id": who, "name": name, "file": target})
                    return self.send_json({"ok": True})
                if action in ("test", "delete", "rename", "pool") and track is None:
                    return self.send_json({"ok": False, "error": "NO_TRACK"}, 400)
                if action == "test":
                    audio["playing"] = target
                elif action == "delete":
                    audio["tracks"].remove(track)
                    audio["players"] = [p for p in audio["players"] if p["file"] != target]
                    audio["next"] = [n for n in audio.get("next", []) if n["file"] != target]
                elif action == "rename":
                    track["title"] = args.get("text", [""])[0]
                elif action == "pool":
                    for key in ("hr", "win"):
                        if key in args:
                            track[key] = args[key][0] in ("on", "1", "true")
                elif action == "assign":
                    name = args.get("text", [""])[0]
                    who = int(args.get("id", ["0"])[0])
                    if track is None:
                        return self.send_json({"ok": False, "error": "NO_TRACK"}, 400)
                    if not any(p["name"] == name and p["file"] == target for p in audio["players"]):
                        audio["players"].append({"id": who, "name": name, "file": target})
                elif action == "unassign":
                    name = args.get("text", [""])[0]
                    before = len(audio["players"])
                    audio["players"] = [p for p in audio["players"] if not (p["name"] == name and (not target or p["file"] == target))]
                    if len(audio["players"]) == before:
                        return self.send_json({"ok": False, "error": "NO_PLAYER"}, 400)
                    if not target:
                        audio["next"] = [n for n in audio.get("next", []) if n["win"] or n["name"] != name]
                else:
                    return self.send_json({"ok": False, "error": "BAD_ACTION"}, 400)
                return self.send_json({"ok": True})
            if self.path == "/api/wifi/forget":
                state["joined"] = False
                return self.send_json({"ok": True})
            if self.path == "/api/settings":
                if "tz" in args:
                    tz = zone_id(args["tz"][0])
                    if not tz:
                        return self.send_json({"ok": False, "error": "TIME_ZONE"}, 400)
                    settings["timeZone"] = tz
                    settings["timeZoneChosen"] = True
                if "raised" in args:
                    settings["raisedSeconds"] = int(args["raised"][0])
                if "bright" in args:
                    settings["brightness"] = int(args["bright"][0])
                if "volume" in args:
                    settings["volume"] = int(args["volume"][0])
                if "token" in args:
                    settings["tokenSet"] = bool(args["token"][0])
                for key, name in (("motor", "motor"), ("follow", "follow"), ("sleep", "sleepDisplay"), ("lock", "requireCode"),
                                  ("auto", "autoUpdate"), ("beta", "beta"), ("winfull", "winFullTrack")):
                    if key in args:
                        settings[name] = args[key][0] in ("on", "auto", "1", "true")
                return self.send_json({"ok": True})
            return self.send_json({"ok": False}, 404)

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--setup", action="store_true", help="start with no Wi-Fi saved, setup network open")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    state = {
        "joined": not args.setup,
        "polls": 10,
        "version": "0.2.0",
        "setup_network": args.setup,
        "settings": {"raisedSeconds": 30, "motor": True, "follow": True, "sleepDisplay": False,
                     "requireCode": False, "timeZone": "America/New_York", "timeZoneChosen": False,
                     "brightness": 100, "volume": 80, "winFullTrack": True, "autoUpdate": True, "beta": False, "tokenSet": False},
        "audio": {"card": True, "playing": "", "batter": "Francisco Lindor", "maxTracks": 20, "next": [],
                  "tracks": [
                      {"file": "/hr1.wav", "title": "hr1.wav", "bytes": 1_600_000, "added": 1_788_200_000, "hr": True, "win": False},
                      {"file": "/hr2.wav", "title": "Takeover", "bytes": 1_900_000, "added": 1_788_250_000, "hr": True, "win": False},
                      {"file": "/win1.wav", "title": "win1.wav", "bytes": 2_100_000, "added": 1_788_300_000, "hr": False, "win": True},
                      {"file": "/extra-01.wav", "title": "Extra track 01", "bytes": 537000, "added": 1788403600, "hr": False, "win": False},
                      {"file": "/extra-02.wav", "title": "Extra track 02", "bytes": 574000, "added": 1788407200, "hr": False, "win": False},
                      {"file": "/extra-03.wav", "title": "Extra track 03", "bytes": 611000, "added": 1788410800, "hr": False, "win": False},
                      {"file": "/extra-04.wav", "title": "Extra track 04", "bytes": 648000, "added": 1788414400, "hr": False, "win": False},
                      {"file": "/extra-05.wav", "title": "Extra track 05", "bytes": 685000, "added": 1788418000, "hr": False, "win": False},
                      {"file": "/extra-06.wav", "title": "Extra track 06", "bytes": 722000, "added": 1788421600, "hr": False, "win": False},
                      {"file": "/extra-07.wav", "title": "Extra track 07", "bytes": 759000, "added": 1788425200, "hr": False, "win": False},
                      {"file": "/extra-08.wav", "title": "Extra track 08", "bytes": 796000, "added": 1788428800, "hr": False, "win": False},
                      {"file": "/extra-09.wav", "title": "Extra track 09", "bytes": 833000, "added": 1788432400, "hr": False, "win": False},
                      {"file": "/extra-10.wav", "title": "Extra track 10", "bytes": 870000, "added": 1788436000, "hr": False, "win": False}],
                  "players": [{"id": 596019, "name": "Francisco Lindor", "file": "/hr2.wav"},
                              {"id": 596019, "name": "Francisco Lindor", "file": "/hr1.wav"},
                              {"id": 1, "name": "Old Timer", "file": "/win1.wav"}]},
        "release": {"state": "IDLE", "version": "", "prerelease": False, "checkedAt": 0, "error": "", "found": False, "ticks": 0},
    }
    print(f"Apple Manager mock on http://127.0.0.1:{args.port}/  ({len(ZONES)} time zones, "
          f"{'setup' if args.setup else 'connected'} state, password 00000000 when the lock is on)")
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(state)).serve_forever()


if __name__ == "__main__":
    main()
