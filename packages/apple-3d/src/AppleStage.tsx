import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Html, OrbitControls, Sparkles, useGLTF, useTexture } from "@react-three/drei";
import {
  Box3,
  Color,
  Group,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Vector3,
} from "three";
import { APPLE_MODEL_URL, CITI_BASE_MODEL_URL, METS_DECAL_URL } from "./assets";

export interface AppleAssemblyProps {
  positionMm: number;
  wireframe?: boolean;
  reducedMotion?: boolean;
  showDimensions?: boolean;
  sceneScale?: number;
}

export interface AppleStageProps extends AppleAssemblyProps {
  mode: "lab" | "outfield";
  celebration?: boolean;
  className?: string;
}

function preparedModel(source: Group, targetWidth: number, wireframe: boolean): Group {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const copies = materials.map((material) => {
      const copy = material.clone();
      if (copy instanceof MeshStandardMaterial) copy.wireframe = wireframe;
      return copy;
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

function ModelAsset({ url, targetWidth, wireframe = false }: { url: string; targetWidth: number; wireframe?: boolean }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => preparedModel(scene, targetWidth, wireframe), [scene, targetWidth, wireframe]);
  return <primitive object={object} />;
}

export function AppleAssembly({
  positionMm,
  wireframe = false,
  reducedMotion = false,
  showDimensions = false,
  sceneScale = 1,
}: AppleAssemblyProps) {
  const movingApple = useRef<Group>(null);
  const logoTexture = useTexture(METS_DECAL_URL);
  const targetPositionMm = MathUtils.clamp(positionMm, 0, 50);
  const appleHomeY = 0.42;

  useEffect(() => {
    logoTexture.colorSpace = SRGBColorSpace;
    logoTexture.needsUpdate = true;
  }, [logoTexture]);

  useFrame((_state, delta) => {
    if (!movingApple.current) return;
    const targetY = appleHomeY + targetPositionMm / 100;
    movingApple.current.position.y = reducedMotion
      ? targetY
      : MathUtils.damp(movingApple.current.position.y, targetY, 5.8, delta);
  });

  return (
    <group name="AppleAssembly" scale={sceneScale}>
      <group name="BaseRoot">
        <ModelAsset url={CITI_BASE_MODEL_URL} targetWidth={3.6} wireframe={wireframe} />
      </group>

      <mesh name="ActuatorRod" position={[0, 0.6 + targetPositionMm / 200, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.075, 0.9 + targetPositionMm / 100, 20]} />
        <meshStandardMaterial color="#aeb7bf" metalness={0.8} roughness={0.24} wireframe={wireframe} />
      </mesh>

      <group name="AppleRoot" ref={movingApple} position={[0, appleHomeY, 0]}>
        <ModelAsset url={APPLE_MODEL_URL} targetWidth={2.62} wireframe={wireframe} />
        <mesh name="AppleDecalTarget" position={[0, 1.05, 1.315]}>
          <circleGeometry args={[0.54, 64]} />
          <meshBasicMaterial map={logoTexture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      </group>

      {showDimensions && (
        <Html position={[2.2, 1.25, 0]} center className="apple-dimension-label" distanceFactor={7}>
          <span>50 mm stroke</span>
          <strong>{targetPositionMm} mm</strong>
        </Html>
      )}
    </group>
  );
}

function CameraTarget({ mode }: { mode: AppleStageProps["mode"] }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.lookAt(mode === "lab" ? new Vector3(0, 1.25, 0) : new Vector3(0, 2.4, -4.9));
  }, [camera, mode]);
  return null;
}

function LabEnvironment() {
  return (
    <>
      <color attach="background" args={["#0b111a"]} />
      <fog attach="fog" args={["#0b111a", 12, 25]} />
      <hemisphereLight args={["#b9d8ff", "#111823", 1.25]} />
      <directionalLight castShadow position={[5, 8, 6]} intensity={2.2} color="#e6f1ff" shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-4, 3, 2]} intensity={34} distance={10} color="#ff6b2c" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#111923" roughness={0.92} metalness={0.08} />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        args={[20, 20]}
        cellColor="#30445b"
        sectionColor="#326a9c"
        cellSize={0.25}
        sectionSize={1}
        fadeDistance={15}
        infiniteGrid
      />
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[4.8, 0.2, 4.8]} />
        <meshStandardMaterial color="#182432" roughness={0.7} metalness={0.3} />
      </mesh>
    </>
  );
}

function OutfieldSeats() {
  const mesh = useRef<InstancedMesh>(null);
  const rows = 9;
  const columns = 13;

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const helper = new Object3D();
    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        helper.position.set(5.6 + column * 0.34, 1.9 + row * 0.28, -5.8 - row * 0.22);
        helper.rotation.x = -0.16;
        helper.updateMatrix();
        mesh.current.setMatrixAt(index, helper.matrix);
        index += 1;
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, rows * columns]} castShadow receiveShadow>
      <boxGeometry args={[0.25, 0.12, 0.28]} />
      <meshStandardMaterial color="#21364e" roughness={0.82} />
    </instancedMesh>
  );
}

function GrassStripes() {
  return (
    <group>
      {Array.from({ length: 16 }, (_, index) => (
        <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} position={[-14.0625 + index * 1.875, -0.05, 3.5]} receiveShadow>
          <planeGeometry args={[1.88, 18]} />
          <meshStandardMaterial color={index % 2 ? "#2e7d43" : "#367f48"} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function OutfieldEnvironment({ celebration }: { celebration: boolean }) {
  return (
    <>
      <color attach="background" args={[celebration ? "#102d54" : "#10243c"]} />
      <fog attach="fog" args={["#10243c", 20, 42]} />
      <hemisphereLight args={["#afceef", "#173223", celebration ? 2.1 : 1.45]} />
      <directionalLight castShadow position={[-7, 12, 8]} intensity={celebration ? 3.2 : 2.3} color="#f4f8ff" shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-3, 5.5, -3]} intensity={celebration ? 72 : 10} distance={15} color="#ff6727" />
      <pointLight position={[3, 5.2, -3]} intensity={celebration ? 58 : 8} distance={14} color="#4c9dff" />

      <GrassStripes />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -3.75]} receiveShadow>
        <planeGeometry args={[30, 2.6]} />
        <meshStandardMaterial color="#9b4e34" roughness={1} />
      </mesh>

      <mesh position={[0, 0.95, -4.72]} castShadow receiveShadow>
        <boxGeometry args={[30, 1.9, 0.34]} />
        <meshStandardMaterial color={celebration ? "#174f91" : "#174275"} roughness={0.58} />
      </mesh>
      <mesh position={[0, 1.93, -4.62]}>
        <boxGeometry args={[30, 0.14, 0.5]} />
        <meshStandardMaterial color="#f05a24" emissive={celebration ? "#b83a0c" : "#3b1006"} emissiveIntensity={celebration ? 1.4 : 0.2} />
      </mesh>
      <Html position={[0, 0.95, -4.52]} center transform distanceFactor={8} className="outfield-distance-marker">
        408
      </Html>

      <mesh position={[0, 4.3, -7.05]} castShadow receiveShadow>
        <boxGeometry args={[10.8, 5.1, 1.1]} />
        <meshStandardMaterial color="#111c29" roughness={0.88} />
      </mesh>
      <mesh position={[-3.8, 4.45, -6.42]}>
        <boxGeometry args={[2.55, 1.18, 0.08]} />
        <meshStandardMaterial color="#172839" roughness={0.76} />
      </mesh>
      <mesh position={[3.85, 4.45, -6.42]}>
        <boxGeometry args={[2.55, 1.18, 0.08]} />
        <meshStandardMaterial color="#172839" roughness={0.76} />
      </mesh>
      <OutfieldSeats />

      {celebration && (
        <Sparkles count={90} scale={[8, 5, 4]} position={[0, 3.7, -3.2]} size={4} speed={0.45} color="#ff8b43" noise={1.1} />
      )}
    </>
  );
}

function LoadingApple() {
  return (
    <mesh position={[0, 1.3, 0]}>
      <sphereGeometry args={[1.1, 24, 20]} />
      <meshStandardMaterial color="#c9242d" roughness={0.42} />
    </mesh>
  );
}

export function AppleStage({
  mode,
  positionMm,
  wireframe = false,
  reducedMotion = false,
  showDimensions = false,
  sceneScale = 1,
  celebration = false,
  className = "",
}: AppleStageProps) {
  const outfield = mode === "outfield";

  return (
    <div
      className={`apple-stage apple-stage--${mode} ${className}`.trim()}
      role="img"
      aria-label={outfield ? "Virtual Home Run Apple behind the center-field wall" : "Dimensioned Home Run Apple motion test bay"}
    >
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={outfield ? { position: [0, 4.9, 12.5], fov: 40, near: 0.1, far: 70 } : { position: [5.5, 4.1, 6.9], fov: 39, near: 0.1, far: 40 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <CameraTarget mode={mode} />
        {outfield ? <OutfieldEnvironment celebration={celebration} /> : <LabEnvironment />}
        <Suspense fallback={<LoadingApple />}>
          <group position={outfield ? [0, 1.4, -5.42] : [0, 0.22, 0]}>
            <AppleAssembly
              positionMm={positionMm}
              wireframe={wireframe}
              reducedMotion={reducedMotion}
              showDimensions={showDimensions}
              sceneScale={outfield ? sceneScale * 0.92 : sceneScale}
            />
          </group>
        </Suspense>
        {!outfield && <OrbitControls makeDefault minDistance={4.3} maxDistance={11} minPolarAngle={0.35} maxPolarAngle={1.48} target={[0, 1.25, 0]} />}
      </Canvas>
      <span className="apple-stage__fallback">Interactive 3D Apple preview</span>
    </div>
  );
}

useGLTF.preload(APPLE_MODEL_URL);
useGLTF.preload(CITI_BASE_MODEL_URL);
