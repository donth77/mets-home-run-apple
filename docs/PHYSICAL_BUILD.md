# Physical build guide

Status: draft. The physical hardware has not been assembled or approved yet.

This guide defines what must be recorded so another person can build the same Home Run Apple without relying on the original builder's memory.

## Before calling a build reproducible

A hardware revision is reproducible only when:

- every required row in `hardware/bom.csv` names an exact manufacturer part number or a tested substitute;
- wiring, fasteners, connectors, and consumables are included, not treated as obvious;
- the assembly order and calibration values have been tested on a real unit;
- a clean firmware build can be installed using the documented source revision;
- the safety and acceptance checks pass;
- the released build does not require a giveaway or secondhand donor Apple;
- a second builder has completed the build from the repository instructions.

The current `HW-A0` list is a planning BOM. Rows marked `unselected` or `candidate` make the gaps visible and must not be treated as purchase recommendations.

## Parts list

The versioned parts list is [`hardware/bom.csv`](../hardware/bom.csv). Each row records:

- where the part is used and how many are needed;
- the exact manufacturer and part number;
- the requirements that a substitute must meet;
- an approved supplier or source document;
- whether the part is unselected, a candidate, or approved;
- how the selected part was verified.

An approved substitute needs its own test result. Similar dimensions or an online description are not enough for motion, power, or safety parts.

The BOM should also include the printed Apple parts once they exist. See [3D-printed Apple and base](3D_PRINTING.md) for their source, color, finish, sticker, printing, and approval process.

## Build order

### 1. Freeze the revision

Choose one BOM revision, one wiring revision, one printable-parts revision, and one firmware source revision. Do not silently replace parts during assembly. Record an unavoidable substitution before continuing.

### 2. Inspect incoming parts

Confirm part numbers and quantities. Check the power supply output, actuator and lift-link dimensions, mounting pattern, end-stop operation, display size, connector keying, and printed-part dimensions against the revision.

### 3. Assemble the structure

Mount the actuator to the internal structural plate with power disconnected. Install travel stops, guards, strain relief, controller mounts, and the base cover. Verify that wiring cannot enter the moving path.

Do not attach the finished Apple yet.

### 4. Wire and inspect

Build the harness from the released wiring drawing. Check polarity, protective earth when applicable, fuse rating, connector orientation, insulation, continuity, and shorts before applying power.

Prefer an externally certified low-voltage power supply. Mains wiring must not be improvised inside a printed enclosure.

### 5. Flash and identify the unit

Build firmware from the recorded source revision, save its checksum, and provision a unique device ID and credentials using the approved device setup process. Do not put setup secrets, Wi-Fi credentials, or private keys in the build record.

### 6. Test without a load

Keep the actuator disconnected from the Apple. Verify both travel limits, direction, timeout behavior, home detection, fault handling, and safe recovery after power loss. Use guards and a local way to remove power.

### 7. Calibrate

Measure the real home position, usable travel, motion time, current draw, and clearances. Store the approved values in the unit record. Software assumptions such as the current 50 mm simulated stroke are not a substitute for physical measurement.

### 8. Attach and test the Apple

With power removed, install the released lift link and attach a test load before the finished shell. After the test load passes, install the Apple and inspect its hub, linkage, fasteners, bottom opening, base, rear-wall clearance, wiring, and full travel envelope.

Run the guarded loaded test defined for the hardware revision. Stop if a limit, timeout, obstruction, unusual sound, heat rise, crack, loose insert, or permanent deformation appears.

### 9. Run acceptance checks

The released acceptance sheet must cover at least:

- power-on, Wi-Fi setup, restart, and local recovery;
- display and game-state updates;
- correct home-run and win sequences;
- ignored duplicate, stale, opponent, and review-pending events;
- both end stops and every movement timeout;
- normal lowering, interrupted movement, and power recovery;
- temperatures and current draw in the closed base;
- stability and pinch-point guards through full travel;
- factory reset without exposing another owner's credentials.

The hardware revision must supply numeric limits and cycle counts before release. Do not invent them during an individual build.

### 10. Complete the build record

Copy [`hardware/BUILD_RECORD_TEMPLATE.md`](../hardware/BUILD_RECORD_TEMPLATE.md) for the unit. Record results, measurements, deviations, photos, firmware checksum, and the person who approved it. A failed or skipped required check means the unit is not approved.

## Revisions and changes

Use `HW-A0`, `HW-A1`, and later identifiers for the complete hardware design. Give printed parts their own revision and record it in the BOM.

Create a new hardware revision when a change can affect fit, wiring, power, thermal behavior, motion, service access, or safety. A supplier change may remain within a revision only when the alternate part is already listed and verified.

Keep obsolete revisions available with a clear status so an existing unit can still be serviced. Never replace a released file without changing its revision or checksum.

## Current blockers

The first approved build still needs:

- the physical Apple and base for measurement;
- an exact actuator, lift linkage, driver, display, power supply, limits, and connectors;
- a wiring drawing and internal structural design;
- reference measurements and donor-free printable-part prototypes;
- verified calibration and acceptance limits;
- a second build performed from the documentation.
