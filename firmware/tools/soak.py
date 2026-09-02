#!/usr/bin/env python3
"""Repeat the engine-driven celebration on the motion commissioning build and
record one CSV row per cycle: run status, drive and dwell timings, peak motor
current when the build reports it, and any fault.

The soak stops at the first cycle that does not complete, and always finishes
by sending `x` (stop, disarm, reset). Keep the actuator unloaded, free, and
attended for the whole run; the firmware still arms one run at a time.

Example: python3 tools/soak.py --cycles 25 --cooldown 10
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
import time
from pathlib import Path

import serial

from jog import BAUD, find_port, port_holders

PREFIX = "APPLE_MOTION:"
RUN_DEADLINE_S = 75.0


def parse(line: str) -> dict | None:
    if not line.startswith(PREFIX):
        return None
    try:
        message = json.loads(line[len(PREFIX) :])
    except json.JSONDecodeError:
        return None
    return message if isinstance(message, dict) else None


class Cycle:
    def __init__(self, index: int) -> None:
        self.index = index
        self.started_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        self.status = "NO_RECEIPT"
        self.marks: dict[str, float] = {}
        self.peak_ma: int | None = None
        self.arrivals_by_current = 0
        self.fault = ""
        self.rejected = ""

    def note(self, message: dict, t: float) -> None:
        kind = message.get("type")
        if kind == "run":
            self.status = str(message.get("status"))
        elif kind == "state":
            ma = message.get("currentMa")
            if isinstance(ma, (int, float)):
                self.peak_ma = int(ma) if self.peak_ma is None else max(self.peak_ma, int(ma))
        elif kind == "trace":
            code, detail = str(message.get("code")), str(message.get("detail"))
            if code == "DRIVE_ON":
                self.marks.setdefault(f"{detail}_on", t)
            elif code == "DRIVE_OFF":
                if "EXTEND_on" in self.marks and "EXTEND_off" not in self.marks:
                    self.marks["EXTEND_off"] = t
                elif "RETRACT_on" in self.marks and "RETRACT_off" not in self.marks:
                    self.marks["RETRACT_off"] = t
            elif code == "POSITION_RAISED":
                self.marks.setdefault("raised", t)
            elif code == "POSITION_HOME":
                self.marks.setdefault("home", t)
            elif code == "ARRIVAL_BY_CURRENT":
                self.arrivals_by_current += 1
            elif code == "FAULT_LATCHED":
                self.fault = detail
            elif code == "COMMAND_REJECTED":
                self.rejected = detail

    def ms(self, start: str, end: str) -> int | None:
        if start in self.marks and end in self.marks:
            return round((self.marks[end] - self.marks[start]) * 1000)
        return None

    def row(self, t0: float) -> dict:
        return {
            "cycle": self.index,
            "started_at_utc": self.started_at,
            "status": self.status,
            "extend_drive_ms": self.ms("EXTEND_on", "EXTEND_off"),
            "raised_ms": self.ms("raised", "RETRACT_on"),
            "retract_drive_ms": self.ms("RETRACT_on", "RETRACT_off"),
            "total_ms": self.ms("EXTEND_on", "home"),
            "peak_current_ma": self.peak_ma,
            "arrivals_by_current": self.arrivals_by_current,
            "fault": self.fault,
            "rejected": self.rejected,
        }


FIELDS = [
    "cycle",
    "started_at_utc",
    "status",
    "extend_drive_ms",
    "raised_ms",
    "retract_drive_ms",
    "total_ms",
    "peak_current_ma",
    "arrivals_by_current",
    "fault",
    "rejected",
]


def pump(s: serial.Serial, seconds: float, cycle: Cycle | None, stop_on: tuple[str, ...] = (), echo: bool = False) -> str | None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        raw = s.readline()
        if not raw:
            continue
        line = raw.decode(errors="replace").rstrip()
        if echo:
            print(f"{time.strftime('%H:%M:%S')} {line}", flush=True)
        message = parse(line)
        if message and cycle is not None:
            cycle.note(message, time.monotonic())
        for marker in stop_on:
            if marker in line:
                return marker
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cycles", type=int, default=25)
    parser.add_argument("--cooldown", type=float, default=10.0, help="seconds between cycles")
    parser.add_argument("--port")
    parser.add_argument("--out", type=Path, help="CSV path (default soak-<timestamp>.csv in the working directory)")
    parser.add_argument("--echo", action="store_true", help="print every serial line")
    parser.add_argument("--force", action="store_true", help="run even if another process holds the port")
    args = parser.parse_args()

    port = find_port(args.port)
    holders = port_holders(port)
    if holders and not args.force:
        sys.exit(f"{port} is held by PID {', '.join(holders)}. Close it first, or pass --force.")
    out = args.out or Path(f"soak-{dt.datetime.now():%Y%m%d-%H%M%S}.csv")

    t0 = time.monotonic()
    completed = 0
    with serial.Serial(port, BAUD, timeout=0.1) as s, out.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        time.sleep(0.4)
        s.reset_input_buffer()
        s.write(b"?\n")
        marker = pump(s, 1.0, None, stop_on=('"profile":"motion_commissioning"',), echo=args.echo)
        if marker is None:
            print("The board did not identify as the motion commissioning build.", file=sys.stderr)
            return 1

        try:
            for index in range(1, args.cycles + 1):
                cycle = Cycle(index)
                s.write(b"a\n")
                if pump(s, 1.0, cycle, stop_on=("MOTION_COMMISSIONING=ARMED",), echo=args.echo) is None:
                    cycle.rejected = "ARM_NOT_ACKNOWLEDGED"
                    writer.writerow(cycle.row(t0)); handle.flush()
                    print(f"cycle {index}: arm not acknowledged, stopping", flush=True)
                    break
                s.write(b"h\n")
                pump(s, RUN_DEADLINE_S, cycle, stop_on=('"status":"COMPLETED"', '"status":"FAULTED"', '"status":"STOPPED"'), echo=args.echo)
                row = cycle.row(t0)
                writer.writerow(row); handle.flush()
                print(
                    f"cycle {index}: {row['status']}  extend {row['extend_drive_ms']} ms  raised {row['raised_ms']} ms  "
                    f"retract {row['retract_drive_ms']} ms  total {row['total_ms']} ms  peak {row['peak_current_ma']} mA"
                    + (f"  fault {row['fault']}" if row["fault"] else ""),
                    flush=True,
                )
                if row["status"] != "COMPLETED":
                    print("Stopping the soak at the first incomplete cycle.", flush=True)
                    break
                completed += 1
                if index < args.cycles:
                    pump(s, args.cooldown, None, echo=args.echo)
        except KeyboardInterrupt:
            print("\nInterrupted; stopping the bridge.", flush=True)
        finally:
            s.write(b"x\n")
            pump(s, 0.8, None, echo=args.echo)

    print(f"{completed} of {args.cycles} cycles completed. CSV: {out}", flush=True)
    return 0 if completed == args.cycles else 1


if __name__ == "__main__":
    sys.exit(main())
