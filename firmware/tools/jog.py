#!/usr/bin/env python3
"""One-shot driver for the actuator jog, L298N meter, and motion commissioning
firmware.

Each run opens the Nano's USB serial port, queries status, and for a jog sends
`a` (arm) followed by `u` (extend), `d` (retract), or `h` (one simulated home
run on the commissioning build). It logs every serial line with a timestamp,
waits for the firmware's AUTO_STOP or run receipt or the optional --hold
deadline, and always finishes by sending `x` (stop and disarm).

Why not `pio device monitor`: a monitor started from a script or an agent tool
call never exits, keeps the port open, and splits incoming bytes between
readers. This tool holds the port only for the seconds a command takes.

Bench rules this tool assumes:
- One serial client on the port at a time. The tool refuses to run when
  another process holds the port (override with --force).
- One arm authorizes one jog. The firmware rejects a second jog until the next
  arm, and this tool never sends more than one jog per run.
- Keep the 12 V supply unplugged while flashing. GPIOs float during DFU.

Requires pyserial. PlatformIO's own Python already has it.
"""

from __future__ import annotations

import argparse
import glob
import json
import shutil
import subprocess
import sys
import time

try:
    import serial
except ImportError:  # pragma: no cover - guidance for a bare interpreter
    sys.exit("pyserial is required: python3 -m pip install pyserial")

BAUD = 115_200
PROTOCOL_PREFIXES = ("APPLE_JOG:", "APPLE_MOTION:")
PORT_GLOBS = ("/dev/cu.usbmodem*", "/dev/ttyACM*")
COMMANDS = {"status": None, "extend": b"u", "retract": b"d", "homerun": b"h", "send": None}
ARMED_MARKERS = ("ACTUATOR_JOG=ARMED", "MOTION_COMMISSIONING=ARMED")
DONE_MARKERS = ("ACTUATOR_JOG=AUTO_STOP", '"status":"COMPLETED"')
FAIL_MARKERS = ("ACTUATOR_JOG=REJECTED", "MOTION_COMMISSIONING=REJECTED", '"status":"FAULTED"', '"status":"STOPPED"')


def find_port(explicit: str | None) -> str:
    if explicit:
        return explicit
    ports = [p for pattern in PORT_GLOBS for p in glob.glob(pattern)]
    if len(ports) == 1:
        return ports[0]
    if not ports:
        sys.exit("No Nano serial port found. Pass --port.")
    sys.exit(f"Several serial ports found, pass --port: {', '.join(ports)}")


def port_holders(port: str) -> list[str]:
    """Best-effort list of PIDs holding the port (macOS and Linux with lsof)."""
    if not shutil.which("lsof"):
        return []
    result = subprocess.run(["lsof", "-t", port], capture_output=True, text=True, check=False)
    return [pid for pid in result.stdout.split() if pid]


class Session:
    def __init__(self, port: str) -> None:
        self.serial = serial.Serial(port, BAUD, timeout=0.1)
        self.started = time.monotonic()
        self.profile: str | None = None
        self.window_ms: int | None = None
        self.armed: bool | None = None
        time.sleep(0.4)
        self.serial.reset_input_buffer()

    def close(self) -> None:
        self.serial.close()

    def stamp(self) -> str:
        return f"{time.monotonic() - self.started:7.3f}s"

    def send(self, command: bytes) -> None:
        print(self.stamp(), ">>", command.decode(), flush=True)
        self.serial.write(command + b"\n")

    def pump(self, seconds: float, stop_on: tuple[str, ...] = ()) -> str | None:
        """Print lines for `seconds`; return the first marker seen, if any."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            raw = self.serial.readline()
            if not raw:
                continue
            line = raw.decode(errors="replace").rstrip()
            print(self.stamp(), line, flush=True)
            self.note(line)
            for marker in stop_on:
                if marker in line:
                    return marker
        return None

    def note(self, line: str) -> None:
        prefix = next((p for p in PROTOCOL_PREFIXES if line.startswith(p)), None)
        if prefix is None:
            return
        try:
            message = json.loads(line[len(prefix) :])
        except json.JSONDecodeError:
            return
        if message.get("type") == "hello":
            self.profile = message.get("profile")
        for key in ("maxJogMs", "deadlineMs"):
            if key in message:
                self.window_ms = int(message[key])
        if "armed" in message:
            self.armed = bool(message["armed"])


def send_key(port: str, key: str, deadline: float) -> int:
    """Send one raw key to any bench build and print what comes back. No arm,
    no trailing stop: for the builds whose keys are not motion commands."""
    session = Session(port)
    try:
        session.send(key.encode())
        session.pump(deadline)
        return 0
    finally:
        session.close()


def run(port: str, command: str, hold: float | None, deadline: float) -> int:
    session = Session(port)
    outcome = 1
    try:
        session.send(b"?")
        session.pump(0.8)
        if session.window_ms is None:
            print("No APPLE_JOG or APPLE_MOTION status received. Is a bench build flashed?", file=sys.stderr)
            return 1
        print(
            f"           profile {session.profile or 'unknown (jog builds only name it at boot)'}, "
            f"window {session.window_ms} ms, armed={session.armed}",
            flush=True,
        )
        direction = COMMANDS[command]
        if direction is None:
            return 0
        if (command == "homerun") != (session.profile == "motion_commissioning"):
            print(f"'{command}' does not apply to the {session.profile} build.", file=sys.stderr)
            return 1

        session.send(b"a")
        marker = session.pump(0.8, stop_on=ARMED_MARKERS)
        if marker is None:
            print("Arm was not acknowledged.", file=sys.stderr)
            return 1

        session.send(direction)
        wait = hold if hold is not None else deadline
        marker = session.pump(wait, stop_on=DONE_MARKERS + FAIL_MARKERS)
        if marker in DONE_MARKERS:
            outcome = 0
        elif marker is None and hold is not None:
            outcome = 0  # early stop requested below
        elif marker is None:
            print("No completion receipt before the deadline.", file=sys.stderr)
        return outcome
    finally:
        session.send(b"x")
        session.pump(0.8)
        session.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=sorted(COMMANDS), help="status, extend, retract, homerun, or send")
    parser.add_argument("key", nargs="?", help="with send: the single key to send, e.g. m, k, t, p, s, a, ?")
    parser.add_argument("--port", help="serial device (default: the only /dev/cu.usbmodem* or /dev/ttyACM*)")
    parser.add_argument(
        "--hold",
        type=float,
        help="seconds to run before sending x, to stop a long meter-build jog early",
    )
    parser.add_argument(
        "--deadline",
        type=float,
        help="seconds to wait for the completion receipt (default 15 for jogs, 75 for a home run)",
    )
    parser.add_argument("--force", action="store_true", help="run even if another process holds the port")
    args = parser.parse_args()

    port = find_port(args.port)
    holders = port_holders(port)
    if holders and not args.force:
        sys.exit(
            f"{port} is held by PID {', '.join(holders)} (a serial monitor?). "
            "Close it first, or pass --force."
        )
    if args.command == "send":
        if not args.key or len(args.key) != 1:
            parser.error("send needs exactly one key, for example: send m")
        return send_key(port, args.key, args.deadline if args.deadline is not None else 3.0)
    deadline = args.deadline if args.deadline is not None else (75.0 if args.command == "homerun" else 15.0)
    return run(port, args.command, args.hold, deadline)


if __name__ == "__main__":
    sys.exit(main())
