import { Grid } from "@react-three/drei";

export function LabEnvironment() {
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
