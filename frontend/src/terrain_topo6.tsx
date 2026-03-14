import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Center, Html, Grid } from '@react-three/drei';
import * as THREE from 'three';

// --- UTM PROJECTION ENGINE ---
function toUTM(lat: number, lng: number) {
  const zone = Math.floor((lng + 180) / 6) + 1;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const lngOriginRad = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const a = 6378137; const f = 1 / 298.257223563; const eSq = 2 * f - f * f; const k0 = 0.9996;
  const N = a / Math.sqrt(1 - eSq * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2; const C = (eSq / (1 - eSq)) * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lngRad - lngOriginRad);
  const M = a * ((1 - eSq / 4 - 3 * eSq ** 2 / 64 - 5 * eSq ** 3 / 256) * latRad - (3 * eSq / 8 + 3 * eSq ** 2 / 32 + 45 * eSq ** 3 / 1024) * Math.sin(2 * latRad) + (15 * eSq ** 2 / 256 + 45 * eSq ** 3 / 1024) * Math.sin(4 * latRad) - (35 * eSq ** 3 / 3072) * Math.sin(6 * latRad));
  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * (eSq / (1 - eSq))) * A ** 5 / 120) + 500000;
  const northing = k0 * (M + N * Math.tan(latRad) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * (eSq / (1 - eSq))) * A ** 6 / 720));
  return { x: easting, y: northing };
}

// --- SHADER (Handles Surface vs Side-Wall rendering) ---
const terrainShader = {
  uniforms: { uTexture: { value: null }, uSideColor: { value: new THREE.Color('#2d3436') } },
  vertexShader: `
    varying vec2 vUv; varying vec3 vNormal; varying float vType; attribute float type;
    void main() { vUv = uv; vType = type; vNormal = normalize(normalMatrix * normal); 
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D uTexture; uniform vec3 uSideColor; varying vec2 vUv; varying vec3 vNormal; varying float vType;
    void main() {
      float light = max(dot(vNormal, vec3(0.2, 1.0, 0.3)), 0.0) * 0.4 + 0.6;
      vec3 color = (vType < 0.5) ? texture2D(uTexture, vUv).rgb : uSideColor;
      gl_FragColor = vec4(color * light, 1.0);
    }
  `
};

export default function TopoApp() {
  const [params, setParams] = useState({ minLat: 34.2, maxLat: 34.8, minLng: 3.5, maxLng: 4.5, exag: 15 });
  const [points, setPoints] = useState<any[]>([]);
  
  // Note: TerrainBlock and TerrainContainer logic here as defined previously
  // Ensure 'exag' is passed down to scale the Z vertices and side skirts.
  
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f172a' }}>
      {/* UI Sidebar remains the same, ensure 'exag' is controlled here */}
      <div style={{ position:'absolute', top:20, left:20, zIndex:10, background:'white', padding:'20px', borderRadius:'12px', width:'300px' }}>
        <h3>Geophysics 3D Engine</h3>
        <label>Exaggeration: {params.exag}x</label>
        <input type="range" min="1" max="50" value={params.exag} onChange={e => setParams({...params, exag: +e.target.value})} />
        <button onClick={() => setParams({...params})} style={{width:'100%', marginTop:10}}>UPDATE MODEL</button>
      </div>

      <Canvas shadows camera={{ position: [15, 15, 15] }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={1} castShadow />
        <Suspense fallback={null}>
          <Center>
            {/* The TerrainContainer here will build the mesh with the 'addSide' function */}
          </Center>
        </Suspense>
        <OrbitControls />
        <Grid position={[0, -2, 0]} />
      </Canvas>
    </div>
  );
}