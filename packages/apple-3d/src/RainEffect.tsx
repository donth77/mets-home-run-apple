import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  type InstancedMesh,
  LinearFilter,
  Object3D,
  PlaneGeometry,
  RGBAFormat,
  RingGeometry,
} from "three";
import { advanceRainField, createRainField, RAIN_DROP_COUNT, RAIN_RIPPLE_COUNT, type RainField } from "./rainField";
import type { SceneRenderQuality } from "./sceneRendering";

const RIPPLE_INSTANCES_PER_IMPACT = 2;

function createDropTexture() {
  const width = 8;
  const height = 64;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const vertical = Math.sin((y / (height - 1)) * Math.PI) ** 0.6;
    for (let x = 0; x < width; x += 1) {
      const horizontal = Math.max(0, 1 - Math.abs(x / (width - 1) - 0.5) * 2) ** 1.7;
      const offset = (y * width + x) * 4;
      data[offset] = 220;
      data[offset + 1] = 239;
      data[offset + 2] = 249;
      data[offset + 3] = Math.round(255 * vertical * horizontal);
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function syncDropInstances(field: RainField, mesh: InstancedMesh, transform: Object3D) {
  for (let index = 0; index < field.speeds.length; index += 1) {
    const positionIndex = index * 6;
    const headX = field.positions[positionIndex];
    const headY = field.positions[positionIndex + 1];
    const headZ = field.positions[positionIndex + 2];
    const tailX = field.positions[positionIndex + 3];
    const tailY = field.positions[positionIndex + 4];
    const tailZ = field.positions[positionIndex + 5];
    const vectorX = headX - tailX;
    const vectorY = headY - tailY;
    const length = Math.hypot(vectorX, vectorY);

    transform.position.set((headX + tailX) / 2, (headY + tailY) / 2, (headZ + tailZ) / 2);
    transform.rotation.set(0, 0, Math.atan2(-vectorX, vectorY));
    transform.scale.set(field.widths[index], length, 1);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function hideRippleInstance(mesh: InstancedMesh, index: number, transform: Object3D, color: Color) {
  transform.position.set(0, -20, 0);
  transform.rotation.set(0, 0, 0);
  transform.scale.setScalar(0.0001);
  transform.updateMatrix();
  mesh.setMatrixAt(index, transform.matrix);
  color.setRGB(0, 0, 0);
  mesh.setColorAt(index, color);
}

function syncRippleInstances(field: RainField, mesh: InstancedMesh, transform: Object3D, color: Color) {
  for (let index = 0; index < field.rippleAges.length; index += 1) {
    const primaryIndex = index * RIPPLE_INSTANCES_PER_IMPACT;
    const secondaryIndex = primaryIndex + 1;
    const age = field.rippleAges[index];
    const lifetime = field.rippleLifetimes[index];

    if (!Number.isFinite(age) || lifetime <= 0 || age >= lifetime) {
      hideRippleInstance(mesh, primaryIndex, transform, color);
      hideRippleInstance(mesh, secondaryIndex, transform, color);
      continue;
    }

    const positionIndex = index * 3;
    const progress = age / lifetime;
    const easedProgress = 1 - (1 - progress) ** 2;
    const strength = Math.sin(progress * Math.PI) ** 0.7 * (1 - progress * 0.35);
    const radius = 0.035 + field.rippleRadii[index] * easedProgress;

    transform.position.set(
      field.ripplePositions[positionIndex],
      field.ripplePositions[positionIndex + 1],
      field.ripplePositions[positionIndex + 2],
    );
    transform.rotation.set(0, 0, 0);
    transform.scale.setScalar(radius);
    transform.updateMatrix();
    mesh.setMatrixAt(primaryIndex, transform.matrix);
    color.setRGB(0.42 * strength, 0.65 * strength, 0.76 * strength);
    mesh.setColorAt(primaryIndex, color);

    const secondaryProgress = (progress - 0.26) / 0.74;
    if (secondaryProgress <= 0 || secondaryProgress >= 1) {
      hideRippleInstance(mesh, secondaryIndex, transform, color);
      continue;
    }

    const secondaryStrength = Math.sin(secondaryProgress * Math.PI) ** 0.8 * strength * 0.58;
    const secondaryRadius = 0.025 + field.rippleRadii[index] * secondaryProgress * 0.72;
    transform.scale.setScalar(secondaryRadius);
    transform.updateMatrix();
    mesh.setMatrixAt(secondaryIndex, transform.matrix);
    color.setRGB(0.42 * secondaryStrength, 0.65 * secondaryStrength, 0.76 * secondaryStrength);
    mesh.setColorAt(secondaryIndex, color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function RainEffect({ quality, reducedMotion }: { quality: SceneRenderQuality; reducedMotion: boolean }) {
  const dropCount = quality === "conservative" ? Math.floor(RAIN_DROP_COUNT / 2) : RAIN_DROP_COUNT;
  const rippleCount = quality === "conservative" ? Math.floor(RAIN_RIPPLE_COUNT / 2) : RAIN_RIPPLE_COUNT;
  const field = useMemo(() => createRainField(dropCount, rippleCount), [dropCount, rippleCount]);
  const dropMesh = useRef<InstancedMesh>(null);
  const rippleMesh = useRef<InstancedMesh>(null);
  const transform = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);
  const dropTexture = useMemo(createDropTexture, []);
  const dropGeometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const rippleGeometry = useMemo(() => {
    const geometry = new RingGeometry(0.84, 1, 28);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }, []);

  useLayoutEffect(() => {
    const drops = dropMesh.current;
    const ripples = rippleMesh.current;
    if (!drops || !ripples) return;

    drops.instanceMatrix.setUsage(DynamicDrawUsage);
    ripples.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let index = 0; index < field.brightness.length; index += 1) {
      const brightness = field.brightness[index];
      color.setRGB(brightness, brightness, brightness);
      drops.setColorAt(index, color);
    }
    if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
    syncDropInstances(field, drops, transform);
    syncRippleInstances(field, ripples, transform, color);
  }, [color, field, transform]);

  useLayoutEffect(
    () => () => {
      dropTexture.dispose();
      dropGeometry.dispose();
      rippleGeometry.dispose();
    },
    [dropGeometry, dropTexture, rippleGeometry],
  );

  useFrame((_, delta) => {
    const drops = dropMesh.current;
    const ripples = rippleMesh.current;
    if (!drops || !ripples || reducedMotion) return;

    advanceRainField(field, delta);
    syncDropInstances(field, drops, transform);
    syncRippleInstances(field, ripples, transform, color);
  });

  return (
    <group name="RainWithGroundImpacts">
      <instancedMesh ref={dropMesh} args={[dropGeometry, undefined, dropCount]} frustumCulled={false} renderOrder={5}>
        <meshBasicMaterial
          alphaTest={0.025}
          color="#dceff8"
          depthTest
          depthWrite={false}
          map={dropTexture}
          opacity={0.4}
          toneMapped={false}
          transparent
        />
      </instancedMesh>
      <instancedMesh
        ref={rippleMesh}
        args={[rippleGeometry, undefined, rippleCount * RIPPLE_INSTANCES_PER_IMPACT]}
        frustumCulled={false}
        renderOrder={6}
      >
        <meshBasicMaterial
          blending={AdditiveBlending}
          color="#d7edf5"
          depthTest
          depthWrite={false}
          opacity={0.52}
          side={DoubleSide}
          toneMapped={false}
          transparent
        />
      </instancedMesh>
    </group>
  );
}
