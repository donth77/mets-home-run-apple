# Physical build files

This directory holds the versioned information needed to reproduce a physical Home Run Apple.

- [`bom.csv`](bom.csv) is the parts list. `HW-A0` is incomplete and is not a purchase list yet.
- [`BUILD_RECORD_TEMPLATE.md`](BUILD_RECORD_TEMPLATE.md) is copied once for each assembled unit.

CAD, print projects, wiring drawings, assembly instructions, and images will be
added after the physical dimensions and hardware choices are verified on the
real build.

The finished hardware is intended to operate autonomously. Its Nano ESP32 will
serve a local Apple Manager page for Wi-Fi setup, audio tracks, settings, status,
and updates; neither a hosted dashboard nor a continuously running Apple Lab
computer is part of the required build.
