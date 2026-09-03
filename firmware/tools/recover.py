#!/usr/bin/env python3
"""Recover a Nano ESP32 whose application crashes before it can be reflashed.

PlatformIO flashes this board through DFU handled *inside the running sketch*,
so an app that crashes at boot locks out the normal upload. This tool gets the
chip into its ROM download mode and writes a known-good application image into
both OTA slots with esptool, leaving the Arduino bootloader, the partition
table, and stored settings untouched.

It first hammers the "1200 baud touch" on the board's serial port, which the
sketch honours in the moments it is alive; if that does not work, connect the
B1 pin (GPIO0) to GND and press RST, then run the tool again.

    python3 tools/recover.py .pio/build/nano_esp32_apple/firmware.bin
"""

from __future__ import annotations

import argparse
import glob
import pathlib
import subprocess
import sys
import time

HOME = pathlib.Path.home()
ESPTOOL = HOME / ".platformio/packages/tool-esptoolpy/esptool.py"
APP_SLOTS = ("0x10000", "0x310000")  # app0 and app1 in app3M_fat9M_fact512k_16MB.csv


def ports() -> list[str]:
    return sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/ttyACM*"))


def chip_answers(port: str) -> bool:
    result = subprocess.run(
        [sys.executable, str(ESPTOOL), "--chip", "esp32s3", "--port", port, "--before", "no_reset",
         "--after", "no_reset", "chip_id"],
        capture_output=True, text=True, timeout=60,
    )
    return "Chip is ESP32-S3" in result.stdout


def touch_until_rom_mode(seconds: float) -> str | None:
    try:
        import serial  # pyserial, present in PlatformIO's Python
    except ImportError:
        sys.exit("pyserial is missing; run this with PlatformIO's Python (see README)")
    started = time.time()
    while time.time() - started < seconds:
        for port in ports():
            try:
                link = serial.Serial(port, 1200, timeout=0.2)
                link.dtr = False
                link.rts = False
                time.sleep(0.15)
                link.close()
            except Exception:
                continue
        time.sleep(0.3)
        for port in ports():
            try:
                if chip_answers(port):
                    return port
            except subprocess.TimeoutExpired:
                pass
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("firmware", type=pathlib.Path, help="application image, e.g. .pio/build/nano_esp32_apple/firmware.bin")
    parser.add_argument("--port", help="skip the touch loop and use this download-mode port")
    parser.add_argument("--seconds", type=float, default=120, help="how long to keep trying the touch")
    args = parser.parse_args()
    if not args.firmware.is_file():
        sys.exit(f"no such image: {args.firmware}")
    if not ESPTOOL.is_file():
        sys.exit(f"esptool not found at {ESPTOOL}")

    port = args.port
    if port is None:
        print("Trying to reach the chip's ROM download mode; this can take a minute...")
        port = touch_until_rom_mode(args.seconds)
    if port is None:
        print("The chip did not enter download mode. Connect B1 (GPIO0) to GND, press RST, release B1, and run again.")
        return 1
    print(f"Chip answering on {port}; writing {args.firmware} into app slots {', '.join(APP_SLOTS)}")
    command = [sys.executable, str(ESPTOOL), "--chip", "esp32s3", "--port", port, "--baud", "460800",
               "--before", "no_reset", "--after", "hard_reset", "write_flash",
               "--flash_mode", "keep", "--flash_freq", "keep", "--flash_size", "keep"]
    for slot in APP_SLOTS:
        command += [slot, str(args.firmware)]
    result = subprocess.run(command)
    if result.returncode != 0:
        return result.returncode
    print("Done. The board resets into the new image; the serial port comes back in a few seconds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
