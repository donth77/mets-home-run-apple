import { useEffect, useMemo } from "react";
import type { Texture } from "three";
import { canvasTexture, createOutfieldTextures } from "./outfieldTextures";
import { RainEffect } from "./RainEffect";
import { StadiumVideoBoard } from "./StadiumVideoBoard";
import type { SceneRenderQuality } from "./sceneRendering";
import type { StadiumScoreboardData } from "./types";

const LIGHT_PANEL_POSITIONS = Array.from({ length: 8 }, (_, index) => ({
  key: `light-${index % 4}-${Math.floor(index / 4)}`,
  x: -0.83 + (index % 4) * 0.55,
  y: 9.62 - Math.floor(index / 4) * 0.55,
}));

const RAILING_POST_X_POSITIONS = Array.from({ length: 34 }, (_, index) => -10.75 + index * 0.65);

function LightTower({ x }: { x: number }) {
  return (
    <group position={[x, 0, -10.6]}>
      <mesh position={[0, 4.8, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.17, 9.5, 12]} />
        <meshStandardMaterial color="#626d72" metalness={0.55} roughness={0.52} />
      </mesh>
      <mesh position={[0, 9.35, 0.08]} rotation={[0.08, 0, 0]}>
        <boxGeometry args={[2.35, 1.25, 0.22]} />
        <meshStandardMaterial color="#343d43" metalness={0.5} roughness={0.5} />
      </mesh>
      {LIGHT_PANEL_POSITIONS.map(({ key, x, y }) => (
        <mesh key={key} position={[x, y, 0.21]}>
          <boxGeometry args={[0.38, 0.3, 0.08]} />
          <meshStandardMaterial color="#fffbe1" emissive="#fff3bd" emissiveIntensity={1.8} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function DistanceMarker() {
  const texture = useMemo(
    () =>
      canvasTexture(512, 256, [1, 1], (context, width, height) => {
        context.clearRect(0, 0, width, height);
        context.font = "900 176px Arial, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#f46c2d";
        context.fillText("408", width / 2, height / 2);
      }),
    [],
  );

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={[0, 1.24, -4.525]}>
      <planeGeometry args={[2.25, 1.05]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
    </mesh>
  );
}

function CenterFieldWall({ texture }: { texture: Texture }) {
  return (
    <mesh name="CenterFieldWall" position={[0, 1.24, -4.78]} castShadow receiveShadow>
      <boxGeometry args={[34, 2.48, 0.4]} />
      <meshStandardMaterial map={texture} color="#ffffff" roughness={0.76} />
    </mesh>
  );
}

const fallbackScoreboardData: StadiumScoreboardData = {
  away: { id: 144, abbreviation: "ATL", name: "Atlanta", runs: 2 },
  home: { id: 121, abbreviation: "NYM", name: "Mets", runs: 2 },
  atCitiField: true,
  phase: "LIVE",
  inning: 7,
  half: "BOTTOM",
  outs: 1,
  label: "LIVE",
  lastEvent: "Mets at bat",
};

export function OutfieldEnvironment({
  quality,
  reducedMotion,
  scoreboardData = fallbackScoreboardData,
  weather,
}: {
  quality: SceneRenderQuality;
  reducedMotion: boolean;
  scoreboardData?: StadiumScoreboardData;
  weather: "CLEAR" | "RAIN";
}) {
  const textures = useMemo(() => createOutfieldTextures(quality), [quality]);
  const raining = weather === "RAIN";
  const fullQuality = quality === "full";

  useEffect(
    () => () => {
      Object.values(textures).forEach((texture) => {
        texture.dispose();
      });
    },
    [textures],
  );

  return (
    <>
      <color attach="background" args={[raining ? "#a8c7d8" : "#bad8eb"]} />
      <fog attach="fog" args={[raining ? "#abc4d2" : "#b4cedf", raining ? 27 : 30, raining ? 61 : 66]} />
      <hemisphereLight
        args={[raining ? "#d9e8ee" : "#ecf7ff", raining ? "#385149" : "#41654a", raining ? 1.95 : 2.25]}
      />
      <directionalLight
        castShadow={fullQuality}
        position={[-8, 14, 9]}
        intensity={raining ? 2.55 : 3.25}
        color={raining ? "#e8f2f6" : "#fffaf0"}
        shadow-mapSize={fullQuality ? [2048, 2048] : [1024, 1024]}
        shadow-bias={-0.00025}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={20}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={70}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 10]} receiveShadow>
        <planeGeometry args={[72, 56, 1, 1]} />
        <meshStandardMaterial
          map={textures.grass}
          bumpMap={textures.grass}
          bumpScale={0.006}
          color={raining ? "#e5eceb" : "#ffffff"}
          metalness={raining ? 0.025 : 0}
          roughness={raining ? 0.74 : 0.94}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, -3.43]} receiveShadow>
        <planeGeometry args={[72, 3.1]} />
        <meshStandardMaterial
          map={textures.track}
          bumpMap={textures.track}
          bumpScale={0.026}
          color={raining ? "#e4e9ea" : "#ffffff"}
          metalness={raining ? 0.035 : 0}
          roughness={raining ? 0.76 : 1}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, -1.84]} receiveShadow>
        <planeGeometry args={[72, 0.1]} />
        <meshStandardMaterial color="#d5c9a9" roughness={1} />
      </mesh>

      <CenterFieldWall texture={textures.wall} />
      <mesh position={[0, 2.52, -4.73]}>
        <boxGeometry args={[34.2, 0.14, 0.5]} />
        <meshStandardMaterial color="#ef5e27" roughness={0.64} />
      </mesh>
      <mesh position={[0, 0.13, -4.55]}>
        <boxGeometry args={[34, 0.16, 0.06]} />
        <meshStandardMaterial color="#0a294b" roughness={0.92} />
      </mesh>
      <DistanceMarker />

      <mesh position={[0, 2.39, -6.28]} receiveShadow>
        <boxGeometry args={[24, 0.18, 3]} />
        <meshStandardMaterial color="#363d3a" roughness={0.97} />
      </mesh>

      <mesh position={[0, 3.1, -8.7]} castShadow receiveShadow>
        <boxGeometry args={[22, 1.46, 0.3]} />
        <meshStandardMaterial map={textures.louvers} color="#d9dedb" roughness={0.88} />
      </mesh>
      <mesh position={[0, 3.88, -8.66]} castShadow>
        <boxGeometry args={[22.4, 0.14, 0.5]} />
        <meshStandardMaterial color="#4b5250" roughness={0.82} />
      </mesh>

      <mesh position={[0, 8, -9.55]} castShadow receiveShadow>
        <boxGeometry args={[42, 20, 1]} />
        <meshStandardMaterial map={textures.concrete} color="#c7ccca" roughness={0.98} />
      </mesh>
      {[3.9, 10.7, 14.8].map((height) => (
        <mesh key={height} position={[0, height, -8.98]} castShadow>
          <boxGeometry args={[42, 0.18, 0.42]} />
          <meshStandardMaterial color="#3e4544" roughness={0.84} />
        </mesh>
      ))}

      <mesh position={[0, 7, -8.65]} castShadow receiveShadow>
        <boxGeometry args={[13.2, 7.3, 1.05]} />
        <meshStandardMaterial color="#252d2e" roughness={0.9} />
      </mesh>
      <StadiumVideoBoard data={scoreboardData} quality={quality} reducedMotion={reducedMotion} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 8.55, 6.65, -8.78]} castShadow receiveShadow>
            <boxGeometry args={[4.35, 8, 1.18]} />
            <meshStandardMaterial map={textures.concrete} color="#d9ddda" roughness={0.98} />
          </mesh>
          <mesh position={[side * 8.55, 6.25, -8.17]}>
            <boxGeometry args={[3.55, 2.62, 0.08]} />
            <meshStandardMaterial map={textures.louvers} color="#cbd0cd" metalness={0.16} roughness={0.62} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 10.78, -8.35]} castShadow>
        <boxGeometry args={[22.2, 0.25, 1.45]} />
        <meshStandardMaterial color="#4e5655" metalness={0.18} roughness={0.8} />
      </mesh>
      <mesh position={[0, 11.34, -8.22]}>
        <boxGeometry args={[22, 0.08, 0.08]} />
        <meshStandardMaterial color="#77817f" metalness={0.58} roughness={0.38} />
      </mesh>
      {RAILING_POST_X_POSITIONS.map((x) => (
        <mesh key={x} position={[x, 11.07, -8.22]}>
          <boxGeometry args={[0.045, 0.52, 0.045]} />
          <meshStandardMaterial color="#737d7b" metalness={0.56} roughness={0.42} />
        </mesh>
      ))}

      <LightTower x={-12.3} />
      <LightTower x={12.3} />
      {raining && <RainEffect quality={quality} reducedMotion={reducedMotion} />}
    </>
  );
}
