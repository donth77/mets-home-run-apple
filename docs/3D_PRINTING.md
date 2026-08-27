# 3D-printed Apple and base

Status: design draft. The repository does not contain production-ready printable parts yet.

## Goal

A builder should be able to make the Apple and base from the released files without buying a giveaway Apple on eBay or using any other donor shell. The giveaway unit can be measured as a reference while the design is developed, but it will not be a required BOM item.

The donor-free release will combine printable cosmetic parts with standard, orderable motion and structural hardware. It must include every cutout, mounting interface, finish step, and assembly instruction needed to build the unit from scratch.

## Recommended construction

Print the Apple in red as one color. The leaf and stem remain part of the Apple geometry and are painted after printing. This is simpler than separate parts or a multicolor print for two small decorative areas.

There is no universal rule that each color must be a separate print. A common FDM workflow is to print one material and paint small decorative details. Separate parts are more useful when a feature needs a different material, print orientation, replacement path, or mechanical movement. None of those applies to the leaf or stem here.

| Part | Construction | Color and finish |
|---|---|---|
| Apple shell, leaf, and stem | One hollow shape, split only where needed to fit the chosen printer | Red filament; mask and paint the leaf green and stem brown |
| Mets logo | Sticker applied directly to the finished Apple shell | Opaque, full-color vinyl with a protective laminate |
| Base cover | Removable printed panels around the mechanism | Black or other final-color filament |
| Actuator support | Separate structural plate and brackets | Metal or another design proven to carry the load |
| Apple lift link | Standard metal rod, tube, standoff, or actuator extension if possible | Hidden inside the Apple and base |

Red filament gives the whole Apple its base color and keeps a scratch from exposing a completely different material color. A display-quality build can use the same print with filled seams, primer where needed, documented green and brown paints, and a compatible clear finish.

The printed base should be treated as a cover until testing proves otherwise. The actuator, travel stops, and Apple load should attach to a separate internal structure rather than depending on a large cosmetic print.

## Source the lift rod when possible

The actuator may need a link between its moving rod and the hub inside the Apple. Treat that link as part of the motion system, not as a cosmetic print.

First check whether the selected actuator can connect directly to the Apple hub. If it cannot, prefer a standard metal rod, threaded standoff, tube, clevis, or manufacturer-supplied extension with a documented load rating. Record its exact length, diameter, material, thread, end fittings, and source in the BOM.

A custom printed hub or short adapter may connect the standard link to the Apple and spread the load across the shell. Do not use a long FDM-printed rod in the released moving assembly unless testing proves its straightness, stiffness, layer strength, fastener retention, and behavior under the full load. The CAD assembly must show how the link is prevented from loosening, rotating unexpectedly, or contacting the base through the entire stroke.

## Use a sticker for the logo

A sticker is the most repeatable way to reproduce the small lines and multiple colors in the Mets logo. Multicolor filament printing would add print time and equipment requirements while producing a rougher result.

Apply the sticker directly to the front of the Apple:

1. Keep the logo area smooth and free of shell seams, fasteners, and sharp changes in curvature.
2. Specify the finished sticker diameter and its center point relative to the Apple centerline.
3. Make a reusable paper or low-tack placement template so every builder can align it at the same height and angle.
4. Apply an opaque, white-backed sticker only after the red paint or other finish has fully cured.
5. Use conformable vinyl and a protective laminate so the sticker can follow the compound curve without losing color accuracy.

Test the sticker on a small printed panel with the same curvature and finish before applying it to a completed Apple. Logo reproduction and distribution must be reviewed separately from the mechanical-file license. Do not assume the logo or the current visual assets can be redistributed for manufacturing.

## What the existing 3D models can provide

The browser scene currently uses:

- `packages/apple-3d/assets/models/citi-apple.glb`
- `packages/apple-3d/assets/models/citi-base.glb`

Those files are useful references for silhouette and appearance. They were generated as visual meshes, are resized at runtime in scene units, and have a public-release license that is still pending. They do not establish real dimensions, uniform wall thickness, mounting points, clearances, or a safe path for actuator loads.

Do not make the printable release by cutting holes directly into those GLB files. Instead, use them as visual references while rebuilding the parts around measured dimensions. Any reuse or derivative work also requires the source license to be resolved first.

The physical giveaway Apple will be another reference, not a manufacturing dependency. After comparing the CAD prototype with it, remove the giveaway parts from the test assembly and complete the final validation using only released prints and standard BOM parts.

## CAD approach

Use two kinds of source model because the Apple and its hardware have different needs:

- Use Blender for the organic Apple surface, including the leaf and stem. Keep the non-destructive modifier stack in the checked-in `.blend` source. Blender's modifiers can add shell thickness and controlled openings, but the exported result still needs measurement and mesh checks.
- Use FreeCAD for the base, internal hub, mounting plate, brackets, fastener holes, cable paths, and other dimensioned interfaces. Keep the editable `.FCStd` source and export a neutral STEP copy.

The exact software can change after a prototype, but every released part must keep an editable source file. A mesh export alone is not the design source.

Store dimensions in millimeters and give every assembly a shared origin:

- the center of the actuator rod is `X = 0`, `Y = 0`;
- the top of the structural base plate is `Z = 0`;
- the front of the Apple defines the direction of the logo;
- the home and fully raised positions use the same coordinate system.

The CAD source should expose these named measurements instead of burying them in mesh edits:

- Apple width, height, and shell thickness;
- bottom opening and actuator clearance;
- Apple hub and load-spreader dimensions;
- lift-link length, diameter, end fittings, and clearance;
- leaf and stem shape and paint boundaries;
- logo sticker diameter and placement center;
- base width, depth, height, and rear clearance;
- actuator mounting pattern and full travel envelope;
- end-stop, controller, display, ventilation, and cable openings;
- fastener diameter, insert size, and fit clearance.

## Design the Apple for assembly

Start with a front and rear shell if both pieces fit the target printer. If they do not, divide the shell into four or more sections. Keep seams away from the logo and place service fasteners on the rear or underside.

Each seam should include:

- positive alignment such as pins, tabs, or a tongue and groove;
- an internal flange that prevents light leaks and keeps the outside surfaces level;
- mechanical fasteners where the shell must reopen;
- enough material around inserts that tightening a screw does not split the wall.

Do not hang the Apple from one point in the cosmetic shell. Add an internal hub or load spreader that connects the actuator or lift link to several reinforced areas. Give the integrated leaf and stem clear modeled borders so they can be masked and painted consistently.

The bottom opening must clear the actuator rod and every nearby part throughout the full commanded travel. The assembly model must also include the wall or backdrop behind the base so the rear curve cannot clip into it.

## Design the base for service

The base cover can be a simple print, but the complete base also needs to make the device safe and repairable. It should include:

- a rigid internal mounting plate for the actuator;
- removable access to the controller, motor driver, fuses, connectors, and end stops;
- strain relief for every cable leaving the base;
- ventilation based on measured component temperatures;
- feet and a stable footprint that resist tipping through the full Apple travel;
- guards around pinch points;
- no exposed mains wiring inside a printed enclosure.

Use an externally certified low-voltage power supply unless a qualified electrical design establishes another approach.

## Material and finish trials

Do not lock the release to a material before printing and testing the real geometry.

- PLA is suitable for quick shape and fit checks. Do not approve it for the final moving assembly based on appearance alone.
- PETG is the first candidate for an indoor functional prototype because it is tough, widely available, and comparatively manageable for large parts.
- ASA is a candidate when sunlight, outdoor exposure, or higher temperature resistance is an actual requirement. Large ASA parts usually require controlled enclosure temperature and appropriate ventilation.

The material vendor's profile is the starting point, not the final project profile. Print a small seam, insert, pin, and Apple-curvature coupon before a full shell. Use it to select fit clearances, insert-hole size, surface preparation, primer, paint, adhesive, and sticker compatibility.

For the display-quality finish:

1. Dry-fit the complete assembly before cosmetic work.
2. Fill only seams that do not need to reopen.
3. Sand and apply a plastic-compatible filler primer.
4. Mask the modeled leaf and stem borders, then apply the recorded green and brown paint products. Apply a red finish to the rest of the Apple only when the raw filament does not provide the desired result.
5. Let the finish cure fully before installing inserts or the logo sticker.
6. Test any clear coat on a coupon before applying it to a finished part.

Record product names and color codes in the release notes. A description such as `red spray paint` is not reproducible.

## From measurements to a released print

### 1. Measure the real assembly

Once the reference Apple and base are available, photograph them with a scale reference and measure the overall shape, openings, mounting points, wall thickness, hardware, and travel clearances. A scan or photogrammetry model can help reproduce the organic surface, but caliper measurements control every mechanical interface.

Create a measurement sheet and mark each value as measured, derived, or estimated. Estimated values cannot control a released mounting feature.

### 2. Select the hardware revision

Freeze the actuator, structural mounting plate, fasteners, inserts, printer build volume, and intended environment before finalizing cutouts. A change to one of these items may require a new printed-part revision.

### 3. Build and review the assembly model

Model the full home and raised positions. Check the actuator envelope, shell opening, rear wall clearance, wiring bend radius, service access, fastener access, and center of mass before printing full-size parts.

### 4. Print fit coupons

Print only the critical interfaces first. Record the printer, nozzle, material manufacturer and batch, material profile, orientation, and measured results. Update the source dimensions rather than scaling a complete part in the slicer.

### 5. Print a fit prototype

Print the shell at final size, assemble it without the actuator powered, and confirm seams, color separation, logo placement, access, and clearances. This prototype is not approved for motion.

### 6. Run guarded motion tests

Test the actuator and limits without the Apple, then with a non-cosmetic test load. Attach the finished Apple only after those tests pass. During loaded testing, inspect the hub, base plate, shell, inserts, and seams for movement, cracking, heat, and permanent deformation.

### 7. Freeze the release

A printable release includes:

- editable `.blend` and `.FCStd` source files;
- STEP exports for dimensioned solid parts;
- 3MF files with millimeter units for each printable part;
- optional STL files only for compatibility;
- a 3MF slicer project for each approved printer, nozzle, and material combination;
- an exploded assembly view and fastener list;
- print orientation, support, and post-processing instructions;
- measured inspection points and allowed tolerances;
- photos of a passing physical build;
- source, license, revision, and checksum information.

3MF is the primary print exchange format because it records units and can carry manufacturing information that STL omits. The editable CAD file remains the source of truth.

### 8. Prove the donor-free build

Assemble a complete unit without using the reference giveaway Apple or base. A second builder should then repeat the build without needing access to the reference item. Record any undocumented trimming, drilling, shimming, or fitting as a design failure and correct the released files or instructions.

## Approval checklist

A part may be labeled `prototype` when it prints and fits. It may be labeled `approved` only when:

- its source and distribution rights are documented;
- its critical dimensions pass inspection on the named printer and material profile;
- mating parts assemble without drilling, forced scaling, or undocumented shims;
- the complete moving envelope has clearance at home and fully raised;
- all fasteners remain accessible and all service covers reopen;
- cosmetic finish and sticker steps have repeatable product details;
- any load-bearing role passes the hardware revision's guarded test;
- no giveaway or donor component is installed in the approved build;
- another builder can reproduce it from a clean checkout and the written instructions without access to the reference unit.

Until all of those checks pass, the model must not be presented as a replacement part.

## Information still needed

The first printable prototype is blocked on these physical facts:

- measured reference Apple and base dimensions;
- the Apple and base construction, thickness, and attachment points;
- the selected actuator's dimensions, mounting pattern, voltage, current, and load;
- the location and size of the display and controls;
- the target printer build volume and nozzle;
- whether the final device is indoor-only or must tolerate sun and weather;
- permission to reuse or derive the current visual models.

After those are known, the base and internal hardware can be modeled first. The red Apple shell, including its leaf and stem, can then be fitted around that verified mechanical assembly, with a smooth front area reserved for the sticker.

## Technical references

- [Blender modifiers](https://docs.blender.org/manual/en/latest/modeling/modifiers/introduction.html) support a non-destructive modeling workflow for the organic shell.
- [FreeCAD](https://www.freecad.org/features.php) uses real-world units and parametric dimensions for mechanical parts.
- The [3MF specification](https://3mf.io/spec/) defines a manufacturing format with explicit units and extensible metadata.
- Prusa's official guides describe [PETG](https://help.prusa3d.com/article/petg_2059) as a practical material for mechanical parts and [ASA](https://help.prusa3d.com/article/asa_1809) as an outdoor-oriented material that requires more demanding print conditions.
- [NIST's additive-manufacturing guidance](https://www.nist.gov/news-events/news/2022/06/updated-standard-provides-fundamental-3d-printing-design-guidance) explains why print-specific dimensions and requirements need to be communicated with the design.
