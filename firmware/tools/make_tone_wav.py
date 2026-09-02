#!/usr/bin/env python3
"""Generate the bench audio fixture: a mono 16-bit PCM WAV sine tone.

Defaults match the bench guide (22.05 kHz, 2 s, 440 Hz at 30 % amplitude).
Prints the CRC-32 that the Nano audio test reports for the same file, so the
copy on the microSD card can be verified end to end.

Example: python3 tools/make_tone_wav.py /Volumes/APPLE/tone.wav
"""

from __future__ import annotations

import argparse
import math
import struct
import wave
import zlib
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out", type=Path, nargs="?", default=Path("tone.wav"))
    parser.add_argument("--rate", type=int, default=22_050, choices=(22_050, 44_100))
    parser.add_argument("--seconds", type=float, default=2.0)
    parser.add_argument("--hz", type=float, default=440.0)
    parser.add_argument("--amplitude", type=float, default=0.3, help="0 to 1 of full scale")
    args = parser.parse_args()

    frames = int(args.rate * args.seconds)
    peak = int(32767 * max(0.0, min(1.0, args.amplitude)))
    # Short fades stop the speaker from clicking at start and end.
    fade = min(frames // 10, args.rate // 50)
    samples = bytearray()
    for n in range(frames):
        envelope = 1.0
        if n < fade:
            envelope = n / fade
        elif n >= frames - fade:
            envelope = (frames - n) / fade
        samples += struct.pack("<h", int(peak * envelope * math.sin(2 * math.pi * args.hz * n / args.rate)))

    with wave.open(str(args.out), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(args.rate)
        handle.writeframes(bytes(samples))

    data = args.out.read_bytes()
    print(f"{args.out}: {len(data)} bytes, {args.rate} Hz mono 16-bit, {args.seconds:g} s at {args.hz:g} Hz")
    print(f"crc32 {zlib.crc32(data) & 0xFFFFFFFF:08x}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
