# Apple 3D Assets

- `mets-logo.svg` — default round decal applied at runtime.
- `models/citi-apple.glb` — optimized, logo-free Meshy Apple intake model.
- `models/citi-base.glb` — optimized Citi-style D-shaped housing model.
- Runtime wrappers expose `AppleRoot`, `AppleDecalTarget`, `ActuatorRod` and `BaseRoot`; the source meshes remain unchanged.
- Renderer tests may replace the decal with a neutral fixture.
- Apps import this one asset path rather than maintaining copies.

See `asset-manifest.json` for provenance and checksum.
