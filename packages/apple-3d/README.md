# Apple 3D

Shared React Three Fiber scene package for both browser apps.

- `AppleStage mode="lab"` renders the model in a neutral, orbitable diagnostic bay.
- `AppleStage mode="outfield"` renders a lightweight Citi-inspired center-field scene.
- `AppleAssembly` keeps the base fixed and animates only `AppleRoot` across the commanded 0–50 mm range.
- The bundled Mets SVG is applied to `AppleDecalTarget` at runtime and is never baked into the GLB.

The package renders commands supplied by the shared core or deterministic fixtures. It does not detect game events.
