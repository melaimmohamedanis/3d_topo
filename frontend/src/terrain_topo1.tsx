import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Center } from '@react-three/drei';
import * as THREE from 'three';

// --- SHADER CODE ---
const terrainShader = {
  uniforms: {
    uTexture: { value: null },
    uSideColor: { value: new THREE.Color('#b5a7a7') },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying float vType; 
    attribute float type;

    void main() {
      vUv = uv;
      vType = type;
      // Normal in view space for "Headlamp" lighting
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D uTexture;
    uniform vec3 uSideColor;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying float vType;

    void main() {
      // Light comes from the camera (Z-forward in view space)
      float light = max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0) * 0.4 + 0.6;
      
      vec3 color;
      if (vType < 0.5) {
        color = texture2D(uTexture, vUv).rgb;
      } else {
        color = uSideColor;
      }
      
      gl_FragColor = vec4(color * light, 1.0);
    }
  `
};

// --- COMPONENT: TerrainBlock ---
const TerrainBlock: React.FC<any> = ({ heights, resolution, size, texture, exaggeration = 0.002 }) => {
  const res = resolution;
  const stride = res + 1;
  const halfSize = size / 2;
  const step = size / res;

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const types: number[] = [];

    const minH = Math.min(...heights) * exaggeration;
    const floor = minH - 1.5;

    // 1. TOP SURFACE (Type 0)
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        vertices.push(-halfSize + j * step, heights[i * stride + j] * exaggeration, -halfSize + i * step);
        uvs.push(j / res, 1 - i / res);
        types.push(0);
      }
    }
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const a = i * stride + j, b = a + 1, c = (i + 1) * stride + j, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // 2. SIDE WALLS & BOTTOM (Type 1) - We add new vertices to prevent normal smoothing
    const addFace = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3) => {
      const startIdx = vertices.length / 3;
      vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1); // Generic UVs for sides
      types.push(1, 1, 1, 1);
      indices.push(startIdx, startIdx + 2, startIdx + 1, startIdx + 1, startIdx + 2, startIdx + 3);
    };

    // North & South
    for (let j = 0; j < res; j++) {
      const x1 = -halfSize + j * step, x2 = -halfSize + (j + 1) * step;
      // North
      addFace(
        new THREE.Vector3(x1, heights[j] * exaggeration, -halfSize),
        new THREE.Vector3(x2, heights[j + 1] * exaggeration, -halfSize),
        new THREE.Vector3(x1, floor, -halfSize),
        new THREE.Vector3(x2, floor, -halfSize)
      );
      // South
      addFace(
        new THREE.Vector3(x2, heights[res * stride + j + 1] * exaggeration, halfSize),
        new THREE.Vector3(x1, heights[res * stride + j] * exaggeration, halfSize),
        new THREE.Vector3(x2, floor, halfSize),
        new THREE.Vector3(x1, floor, halfSize)
      );
    }

    // West & East
    for (let i = 0; i < res; i++) {
      const z1 = -halfSize + i * step, z2 = -halfSize + (i + 1) * step;
      // West
      addFace(
        new THREE.Vector3(-halfSize, heights[(i + 1) * stride] * exaggeration, z2),
        new THREE.Vector3(-halfSize, heights[i * stride] * exaggeration, z1),
        new THREE.Vector3(-halfSize, floor, z2),
        new THREE.Vector3(-halfSize, floor, z1)
      );
      // East
      addFace(
        new THREE.Vector3(halfSize, heights[i * stride + res] * exaggeration, z1),
        new THREE.Vector3(halfSize, heights[(i + 1) * stride + res] * exaggeration, z2),
        new THREE.Vector3(halfSize, floor, z1),
        new THREE.Vector3(halfSize, floor, z2)
      );
    }

    // Bottom Cap
    addFace(
      new THREE.Vector3(-halfSize, floor, halfSize),
      new THREE.Vector3(halfSize, floor, halfSize),
      new THREE.Vector3(-halfSize, floor, -halfSize),
      new THREE.Vector3(halfSize, floor, -halfSize)
    );

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('type', new THREE.Float32BufferAttribute(types, 1));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }, [heights, res, size, exaggeration, stride]);

  return (
    <mesh geometry={geometry}>
      <shaderMaterial 
        args={[terrainShader]} 
        uniforms-uTexture-value={texture}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

// --- MAIN APP ---
const TerrainContainer: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const nasaUrl = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=BlueMarble_NextGeneration&STYLE=&FORMAT=image/jpeg&SRS=EPSG:4326&WIDTH=1024&HEIGHT=1024&BBOX=6.8,45.8,7.0,46.0"; 
  const satelliteTexture = useLoader(THREE.TextureLoader, nasaUrl);
  satelliteTexture.colorSpace = THREE.SRGBColorSpace;

  useEffect(() => {
    fetch('http://localhost:3001/api/terrain').then(r => r.json()).then(setData);
  }, []);

  return data ? <TerrainBlock heights={data.heights} resolution={data.resolution} size={10} texture={satelliteTexture} /> : null;
};

export default function TopoApp() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#ffffff' }}>
      <Canvas>
        <Suspense fallback={null}>
          <PerspectiveCamera makeDefault position={[12, 12, 12]} />
          <Center><TerrainContainer /></Center>
          <OrbitControls makeDefault />
        </Suspense>
      </Canvas>
    </div>
  );
}