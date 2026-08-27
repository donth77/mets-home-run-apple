# 3D Assets and Artwork

The public-facing apple needs a recognizable modern stadium-prop silhouette; a generic round fruit is not an acceptable final asset. The round Mets SVG is bundled once as a replaceable decal while the model remains texture-independent.

## Asset contract

Every visual implementation—neutral primitive, procedural model or imported GLB—must expose these anchors:

- `AppleRoot`
- `AppleDecalTarget`
- `ActuatorRod`
- `BaseRoot`

The manifest records meters, Y-up, +Z-front, dimensions, home/stroke values, author, source, license, modifications and attribution. Unknown measurements are `null`, never zero.

## Development stages

1. Use dimensioned primitives for motion, collision and renderer tests.
2. Load the logo-free custom GLB through the shared adapter. The current Meshy intake models are checked in as optimized GLBs at 8,535 Apple triangles and 4,240 base triangles.
3. Apply `packages/apple-3d/assets/mets-logo.svg` to `AppleDecalTarget` as a separate texture/badge layer. This is implemented by the runtime assembly wrapper.
4. Calibrate dimensions against the delivered donor.
5. Review silhouette overlays, topology, materials and performance before promoting the final asset.

The current GLBs use 1K embedded WebP textures, meshopt geometry compression and quantized attributes. No geometry simplification was applied during intake. Their hashes and source-archive hashes are recorded in `packages/apple-3d/assets/asset-manifest.json`.

Alternate personal artwork belongs in `user-assets/`, which is ignored. The UI may offer a local file picker and keep the texture in browser-local storage. It must not upload personal decals to a project service.
