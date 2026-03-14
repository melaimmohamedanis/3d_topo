import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Center, Html, Grid } from '@react-three/drei';
import * as THREE from 'three';

// --- SHADER CODE ---
const terrainShader = {
  uniforms: {
    uTexture: { value: null },
    uSideColor: { value: new THREE.Color('#b5a7a7') },
  },
  vertexShader: `
    varying vec2 vUv; varying vec3 vNormal; varying float vType; attribute float type;
    void main() { 
      vUv = uv; vType = type; 
      vNormal = normalize(normalMatrix * normal); 
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); 
    }
  `,
  fragmentShader: `
    uniform sampler2D uTexture; uniform vec3 uSideColor; varying vec2 vUv; varying vec3 vNormal; varying float vType;
    void main() {
      float light = max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0) * 0.4 + 0.6;
      vec3 color = (vType < 0.5) ? texture2D(uTexture, vUv).rgb : uSideColor;
      gl_FragColor = vec4(color * light, 1.0);
    }
  `
};

// --- COMPONENT: TerrainBlock (Updated for Aspect Ratio) ---
const TerrainBlock: React.FC<any> = ({ heights, resolution, width, depth, texture, exaggeration = 0.002, showBBox }) => {
  const res = resolution; 
  const stride = res + 1; 
  const halfW = width / 2;
  const halfD = depth / 2;
  const stepX = width / res;
  const stepZ = depth / res;
  const meshRef = React.useRef<THREE.Mesh>(null!);

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const vertices: number[] = []; const uvs: number[] = []; const indices: number[] = []; const types: number[] = [];
    const minH = Math.min(...heights) * exaggeration; const floor = minH - 1.5;

    // 1. TOP SURFACE
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        vertices.push(-halfW + j * stepX, heights[i * stride + j] * exaggeration, -halfD + i * stepZ);
        uvs.push(j / res, 1 - i / res); types.push(0);
      }
    }
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const a = i * stride + j, b = a + 1, c = (i + 1) * stride + j, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // 2. SIDES
    const addFace = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3) => {
      const startIdx = vertices.length / 3;
      vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1); types.push(1, 1, 1, 1);
      indices.push(startIdx, startIdx + 2, startIdx + 1, startIdx + 1, startIdx + 2, startIdx + 3);
    };

    // North & South
    for (let j = 0; j < res; j++) {
      const x1 = -halfW + j * stepX, x2 = -halfW + (j + 1) * stepX;
      addFace(new THREE.Vector3(x1, heights[j] * exaggeration, -halfD), new THREE.Vector3(x2, heights[j + 1] * exaggeration, -halfD), new THREE.Vector3(x1, floor, -halfD), new THREE.Vector3(x2, floor, -halfD));
      addFace(new THREE.Vector3(x2, heights[res * stride + j + 1] * exaggeration, halfD), new THREE.Vector3(x1, heights[res * stride + j] * exaggeration, halfD), new THREE.Vector3(x2, floor, halfD), new THREE.Vector3(x1, floor, halfD));
    }
    // West & East
    for (let i = 0; i < res; i++) {
      const z1 = -halfD + i * stepZ, z2 = -halfD + (i + 1) * stepZ;
      addFace(new THREE.Vector3(-halfW, heights[(i + 1) * stride] * exaggeration, z2), new THREE.Vector3(-halfW, heights[i * stride] * exaggeration, z1), new THREE.Vector3(-halfW, floor, z2), new THREE.Vector3(-halfW, floor, z1));
      addFace(new THREE.Vector3(halfW, heights[i * stride + res] * exaggeration, z1), new THREE.Vector3(halfW, heights[(i + 1) * stride + res] * exaggeration, z2), new THREE.Vector3(halfW, floor, z1), new THREE.Vector3(halfW, floor, z2));
    }
    // Bottom
    addFace(new THREE.Vector3(-halfW, floor, halfD), new THREE.Vector3(halfW, floor, halfD), new THREE.Vector3(-halfW, floor, -halfD), new THREE.Vector3(halfW, floor, -halfD));

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('type', new THREE.Float32BufferAttribute(types, 1));
    geom.setIndex(indices); geom.computeVertexNormals();
    return geom;
  }, [heights, res, width, depth, exaggeration, stride]);

  return (
    <>
      <mesh ref={meshRef} geometry={geometry}>
        <shaderMaterial args={[terrainShader]} uniforms-uTexture-value={texture} side={THREE.DoubleSide} />
      </mesh>
      {showBBox && <boxHelper args={[meshRef.current, 0xff0000]} />}
    </>
  );
};

// --- DATA WRAPPER ---
const TerrainContainer: React.FC<{ bbox: any, showBBox: boolean }> = ({ bbox, showBBox }) => {
  const [data, setData] = useState<any>(null);

  // 1. Calculate the geographic aspect ratio
  const latSpan = Math.abs(bbox.maxLat - bbox.minLat);
  const lngSpan = Math.abs(bbox.maxLng - bbox.minLng);
  
  // Set physical dimensions in the scene based on coordinate span
  const baseSize = 10;
  const width = lngSpan >= latSpan ? baseSize : baseSize * (lngSpan / latSpan);
  const depth = latSpan > lngSpan ? baseSize : baseSize * (latSpan / lngSpan);

  const nasaUrl = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=BlueMarble_NextGeneration&STYLE=&FORMAT=image/jpeg&SRS=EPSG:4326&WIDTH=1024&HEIGHT=1024&BBOX=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`; 
  const satelliteTexture = useLoader(THREE.TextureLoader, nasaUrl);
  satelliteTexture.colorSpace = THREE.SRGBColorSpace;

  useEffect(() => {
    setData(null);
    const url = `http://localhost:3001/api/terrain?minLat=${bbox.minLat}&maxLat=${bbox.maxLat}&minLng=${bbox.minLng}&maxLng=${bbox.maxLng}`;
    fetch(url).then(r => r.json()).then(setData).catch(console.error);
  }, [bbox]);

  if (!data) return <Html center><div style={{ background: 'white', padding: '10px', borderRadius: '4px' }}>Loading Terrain Data...</div></Html>;

  return (
    <TerrainBlock 
      heights={data.heights} 
      resolution={data.resolution} 
      width={width} 
      depth={depth} 
      texture={satelliteTexture} 
      showBBox={showBBox} 
    />
  );
};

// --- THE SINGLE EXPORT DEFAULT ---
export default function TopoApp() {
  const [inputs, setInputs] = useState({ minLat: 45.8, maxLat: 46.0, minLng: 6.8, maxLng: 7.0 });
  const [activeBbox, setActiveBbox] = useState({ minLat: 45.8, maxLat: 46.0, minLng: 6.8, maxLng: 7.0 });
  const [showBBox, setShowBBox] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f0f0f0', position: 'relative' }}>
      
      {/* UI PANEL */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontFamily: 'sans-serif' }}>
        <h4 style={{ margin: '0 0 10px 0' }}>Region Controls</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          <label style={{fontSize: '11px'}}>Min Lat<input type="number" step="0.01" value={inputs.minLat} onChange={e => setInputs({...inputs, minLat: parseFloat(e.target.value)})} style={{width: '100%', display: 'block'}}/></label>
          <label style={{fontSize: '11px'}}>Max Lat<input type="number" step="0.01" value={inputs.maxLat} onChange={e => setInputs({...inputs, maxLat: parseFloat(e.target.value)})} style={{width: '100%', display: 'block'}}/></label>
          <label style={{fontSize: '11px'}}>Min Lng<input type="number" step="0.01" value={inputs.minLng} onChange={e => setInputs({...inputs, minLng: parseFloat(e.target.value)})} style={{width: '100%', display: 'block'}}/></label>
          <label style={{fontSize: '11px'}}>Max Lng<input type="number" step="0.01" value={inputs.maxLng} onChange={e => setInputs({...inputs, maxLng: parseFloat(e.target.value)})} style={{width: '100%', display: 'block'}}/></label>
        </div>
        <button onClick={() => setActiveBbox(inputs)} style={{ width: '100%', padding: '8px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginBottom: '10px' }}>
          FETCH TOPOGRAPHY
        </button>
        
        <div style={{ display: 'flex', gap: '5px' }}>
          <button onClick={() => setShowBBox(!showBBox)} style={{ flex: 1, padding: '5px', cursor: 'pointer', fontSize: '11px' }}>{showBBox ? 'Hide Bounds' : 'Show Bounds'}</button>
          <button onClick={() => setShowGrid(!showGrid)} style={{ flex: 1, padding: '5px', cursor: 'pointer', fontSize: '11px' }}>{showGrid ? 'Hide Grid' : 'Show Grid'}</button>
        </div>
      </div>

      <Canvas>
        <Suspense fallback={<Html center><div>Loading Textures...</div></Html>}>
          <PerspectiveCamera makeDefault position={[12, 12, 12]} />
          {showGrid && <Grid infiniteGrid fadeDistance={50} cellColor="#999" sectionColor="#666" position={[0, -2, 0]} />}
          <Center>
            <TerrainContainer bbox={activeBbox} showBBox={showBBox} />
          </Center>
          <OrbitControls makeDefault />
        </Suspense>
      </Canvas>
    </div>
  );
}