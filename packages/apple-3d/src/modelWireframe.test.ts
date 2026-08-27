import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { setModelWireframe } from "./modelWireframe";

describe("setModelWireframe", () => {
  it("toggles prepared materials without replacing the model or its decal target", () => {
    const root = new Group();
    const appleMaterial = new MeshStandardMaterial({ wireframe: false });
    const apple = new Mesh(new BoxGeometry(1, 1, 1), appleMaterial);
    const decal = new Mesh(new BoxGeometry(0.2, 0.2, 0.01), new MeshBasicMaterial());
    apple.add(decal);
    root.add(apple);

    setModelWireframe(root, true);
    expect(apple.material).toBe(appleMaterial);
    expect(apple.children[0]).toBe(decal);
    expect(appleMaterial.wireframe).toBe(true);

    setModelWireframe(root, false);
    expect(apple.material).toBe(appleMaterial);
    expect(apple.children[0]).toBe(decal);
    expect(appleMaterial.wireframe).toBe(false);
  });

  it("leaves non-standard decal materials untouched", () => {
    const root = new Group();
    const decalMaterial = new MeshBasicMaterial({ wireframe: false });
    root.add(new Mesh(new BoxGeometry(1, 1, 1), decalMaterial));

    setModelWireframe(root, true);

    expect(decalMaterial.wireframe).toBe(false);
  });
});
