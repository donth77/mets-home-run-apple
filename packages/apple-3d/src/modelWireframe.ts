import { Mesh, MeshStandardMaterial, type Object3D } from "three";

/**
 * Updates only the prepared model materials. Keeping the Object3D and Mesh
 * identities stable prevents child portals, such as the Apple decal, from
 * being detached when diagnostic wireframe mode changes.
 */
export function setModelWireframe(root: Object3D, wireframe: boolean) {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || material.wireframe === wireframe) continue;
      material.wireframe = wireframe;
      material.needsUpdate = true;
    }
  });
}
