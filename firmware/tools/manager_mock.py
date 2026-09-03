#!/usr/bin/env python3
"""Serve the Apple Manager page against a fake Apple, for working on the page
without a board.

    python3 tools/manager_mock.py            # connected, following a live game
    python3 tools/manager_mock.py --setup    # first boot: setup network open, no Wi-Fi yet
    python3 tools/manager_mock.py --port 8765

Then open http://127.0.0.1:8765/. The mock answers the same routes as the
firmware (/api/status, /api/networks, /api/timezones, POST /api/wifi,
/api/wifi/forget, /api/settings, /api/update, /api/restart) and reads the time zone table straight from
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
            "settings": dict(settings, timeZoneLabel=zone_label(settings["timeZone"]),
                             setupKey="" if settings["requireCode"] else "00000000"),
            "lastCelebration": {"kind": "HR", "subject": "Juan Soto", "at": 1788392040, "moved": True},
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
                for key, name in (("motor", "motor"), ("follow", "follow"), ("sleep", "sleepDisplay"), ("lock", "requireCode")):
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
                     "brightness": 100},
    }
    print(f"Apple Manager mock on http://127.0.0.1:{args.port}/  ({len(ZONES)} time zones, "
          f"{'setup' if args.setup else 'connected'} state, password 00000000 when the lock is on)")
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(state)).serve_forever()


if __name__ == "__main__":
    main()
