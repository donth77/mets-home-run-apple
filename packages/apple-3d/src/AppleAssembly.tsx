import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal, useFrame } from "@react-three/fiber";
import { Decal, Html, useGLTF, useTexture } from "@react-three/drei";
import { Box3, type Group, Mesh, SRGBColorSpace, type Texture, Vector3 } from "three";
import { APPLE_MODEL_URL, CITI_BASE_MODEL_URL, METS_DECAL_URL } from "./assets";
import { ACTUATOR_STROKE_MM, clampActuatorPosition } from "./actuatorPhysics";
import { setModelWireframe } from "./modelWireframe";
import type { AppleAssemblyProps } from "./types";

function preparedModel(source: Group, targetWidth: number): Group {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const copies = materials.map((material) => {
      return material.clone();
    });
    child.material = Array.isArray(child.material) ? copies : copies[0];
  });

  const sourceBox = new Box3().setFromObject(clone);
  const sourceSize = sourceBox.getSize(new Vector3());
  const scale = targetWidth / Math.max(sourceSize.x, 0.0001);
  clone.scale.setScalar(scale);
  clone.updateMatrixWorld(true);

  const scaledBox = new Box3().setFromObject(clone);
  const center = scaledBox.getCenter(new Vector3());
  clone.position.x -= center.x;
  clone.position.z -= center.z;
  clone.position.y -= scaledBox.min.y;
  clone.updateMatrixWorld(true);
  return clone;
}

function ModelAsset({
  url,
  targetWidth,
  wireframe = false,
}: {
  url: string;
  targetWidth: number;
  wireframe?: boolean;
}) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => preparedModel(scene, targetWidth), [scene, targetWidth]);
  useLayoutEffect(() => setModelWireframe(object, wireframe), [object, wireframe]);
  return <primitive object={object} />;
}

function AppleModelWithDecal({ wireframe, texture }: { wireframe: boolean; texture: Texture }) {
  const { scene } = useGLTF(APPLE_MODEL_URL);
  const prepared = useMemo(() => {
    const object = preparedModel(scene, 2.62);
    const candidate = object.getObjectByProperty("isMesh", true);
    const target = candidate instanceof Mesh ? candidate : null;
    object.updateMatrixWorld(true);
    const projectedCenter = target ? target.worldToLocal(new Vector3(0, 1.05, 1.26)) : new Vector3();
    return { object, projectedCenter, target };
  }, [scene]);
  useLayoutEffect(() => setModelWireframe(prepared.object, wireframe), [prepared.object, wireframe]);

  return (
    <>
      <primitive object={prepared.object} />
      {prepared.target &&
        createPortal(<StableAppleDecal position={prepared.projectedCenter} texture={texture} />, prepared.target)}
    </>
  );
}

function StableAppleDecal({ position, texture }: { position: Vector3; texture: Texture }) {
  const decal = useRef<Mesh>(null);
  const adjustedGeometry = useRef<Mesh["geometry"] | null>(null);

  useFrame(() => {
    const geometry = decal.current?.geometry;
    if (!geometry || adjustedGeometry.current === geometry) return;
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    if (positions && normals) {
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        positions.setXYZ(
          vertex,
          positions.getX(vertex) + normals.getX(vertex) * 0.006,
          positions.getY(vertex) + normals.getY(vertex) * 0.006,
          positions.getZ(vertex) + normals.getZ(vertex) * 0.006,
        );
      }
      positions.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    adjustedGeometry.current = geometry;
  });

  return (
    <Decal
      ref={decal}
      name="AppleDecalTarget"
      position={position}
      rotation={Math.PI}
      scale={0.86}
      map={texture}
      depthTest
      frustumCulled={false}
      polygonOffsetFactor={-8}
      renderOrder={4}
    >
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.02}
        depthTest
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-8}
        toneMapped={false}
      />
    </Decal>
  );
}

export function AppleAssembly({
  positionMm,
  wireframe = false,
  showDimensions = false,
  sceneScale = 1,
}: AppleAssemblyProps) {
  const logoTexture = useTexture(METS_DECAL_URL) as Texture;
  const actualPositionMm = clampActuatorPosition(positionMm);
  const appleHomeY = -0.62;
  const travelSceneUnits = (actualPositionMm / ACTUATOR_STROKE_MM) * 1.28;
  const rodHeight = 0.72 + travelSceneUnits;

  useEffect(() => {
    logoTexture.colorSpace = SRGBColorSpace;
    logoTexture.needsUpdate = true;
  }, [logoTexture]);

  return (
    <group name="AppleAssembly" scale={sceneScale}>
      <group name="BaseRoot">
        <ModelAsset url={CITI_BASE_MODEL_URL} targetWidth={3.6} wireframe={wireframe} />
      </group>

      <mesh name="ActuatorRod" position={[0, rodHeight * 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.075, rodHeight, 20]} />
        <meshStandardMaterial color="#aeb7bf" metalness={0.8} roughness={0.24} wireframe={wireframe} />
      </mesh>

      <group name="AppleRoot" position={[0, appleHomeY + travelSceneUnits, 0]}>
        <AppleModelWithDecal wireframe={wireframe} texture={logoTexture} />
      </group>

      {showDimensions && (
        <Html position={[2.2, 1.25, 0]} center className="apple-dimension-label" distanceFactor={7}>
          <span>50 mm stroke</span>
          <strong>{actualPositionMm.toFixed(1)} mm</strong>
        </Html>
      )}
    </group>
  );
}
