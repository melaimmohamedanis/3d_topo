import React, { useEffect, useState, useMemo, Suspense, useRef } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Center, Html, Grid } from '@react-three/drei';
import * as THREE from 'three';

// --- CONFIGURATION ---
const PROVIDERS = {
  BLUE_MARBLE: { name: "Blue Marble", layer: "BlueMarble_NextGeneration" },
  MODIS_TERRA: { name: "MODIS Terra", layer: "MODIS_Terra_CorrectedReflectance_TrueColor" },
  MODIS_AQUA: { name: "MODIS Aqua", layer: "MODIS_Aqua_CorrectedReflectance_TrueColor" },
  VIIRS_SNPP: { name: "VIIRS SNPP", layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor" },
};

const terrainShader = {
  uniforms: { 
    uTexture: { value: null }, 
    uSideColor: { value: new THREE.Color('#4a4a4a') } 
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

// --- SUB-COMPONENT: Marker ---
const Marker = ({ position, label }: { position: [number, number, number], label: string }) => (
  <group position={position}>
    <mesh position={[0, 0.1, 0]}>
      <sphereGeometry args={[0.08, 16, 16]} />
      <meshBasicMaterial color="#ff4757" />
    </mesh>
    <Html distanceFactor={8} position={[0, 0.2, 0]}>
      <div style={{ 
        color: 'white', background: 'rgba(0,0,0,0.7)', padding: '2px 6px', 
        borderRadius: '4px', fontSize: '10px', whiteSpace: 'nowrap', pointerEvents: 'none' 
      }}>
        {label}
      </div>
    </Html>
  </group>
);

// --- COMPONENT: TerrainBlock (Geometry & Skirts) ---
const TerrainBlock: React.FC<any> = ({ heights, resolution, width, depth, texture, exaggeration, latSpan, onMeshClick }) => {
  const res = resolution; const stride = res + 1;
  const halfW = width / 2; const halfD = depth / 2;
  const stepX = width / res; const stepZ = depth / res;
  const verticalScale = (depth / (latSpan * 111000)) * exaggeration;

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const vertices: number[] = [], uvs: number[] = [], indices: number[] = [], types: number[] = [];
    const minH = Math.min(...heights) * verticalScale;
    const floor = minH - (depth * 0.1);

    // 1. Top Surface
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        vertices.push(-halfW + j * stepX, heights[i * stride + j] * verticalScale, -halfD + i * stepZ);
        uvs.push(j / res, 1 - i / res); types.push(0);
      }
    }
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const a = i * stride + j, b = a + 1, c = (i + 1) * stride + j, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // 2. Skirts (Side Walls)
    const addFace = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3) => {
      const startIdx = vertices.length / 3;
      vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1); types.push(1, 1, 1, 1);
      indices.push(startIdx, startIdx + 2, startIdx + 1, startIdx + 1, startIdx + 2, startIdx + 3);
    };

    for (let j = 0; j < res; j++) {
      const h1 = heights[j] * verticalScale, h2 = heights[j + 1] * verticalScale;
      const h3 = heights[res * stride + j] * verticalScale, h4 = heights[res * stride + j + 1] * verticalScale;
      addFace(new THREE.Vector3(-halfW+j*stepX, h1, -halfD), new THREE.Vector3(-halfW+(j+1)*stepX, h2, -halfD), new THREE.Vector3(-halfW+j*stepX, floor, -halfD), new THREE.Vector3(-halfW+(j+1)*stepX, floor, -halfD));
      addFace(new THREE.Vector3(-halfW+(j+1)*stepX, h4, halfD), new THREE.Vector3(-halfW+j*stepX, h3, halfD), new THREE.Vector3(-halfW+(j+1)*stepX, floor, halfD), new THREE.Vector3(-halfW+j*stepX, floor, halfD));
    }
    for (let i = 0; i < res; i++) {
      const hL1 = heights[i * stride] * verticalScale, hL2 = heights[(i + 1) * stride] * verticalScale;
      const hR1 = heights[i * stride + res] * verticalScale, hR2 = heights[(i + 1) * stride + res] * verticalScale;
      addFace(new THREE.Vector3(-halfW, hL2, -halfD+(i+1)*stepZ), new THREE.Vector3(-halfW, hL1, -halfD+i*stepZ), new THREE.Vector3(-halfW, floor, -halfD+(i+1)*stepZ), new THREE.Vector3(-halfW, floor, -halfD+i*stepZ));
      addFace(new THREE.Vector3(halfW, hR1, -halfD+i*stepZ), new THREE.Vector3(halfW, hR2, -halfD+(i+1)*stepZ), new THREE.Vector3(halfW, floor, -halfD+i*stepZ), new THREE.Vector3(halfW, floor, -halfD+(i+1)*stepZ));
    }
    addFace(new THREE.Vector3(-halfW, floor, halfD), new THREE.Vector3(halfW, floor, halfD), new THREE.Vector3(-halfW, floor, -halfD), new THREE.Vector3(halfW, floor, -halfD));

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('type', new THREE.Float32BufferAttribute(types, 1));
    geom.setIndex(indices); geom.computeVertexNormals();
    return geom;
  }, [heights, res, width, depth, verticalScale]);

  return (
    <mesh onClick={(e) => { e.stopPropagation(); onMeshClick(e.point); }}>
      <primitive object={geometry} attach="geometry" />
      <shaderMaterial args={[terrainShader]} uniforms-uTexture-value={texture} side={THREE.DoubleSide} />
    </mesh>
  );
};

// --- COMPONENT: Data Fetcher Wrapper ---
const TerrainContainer: React.FC<any> = ({ bbox, providerKey, exaggeration, onPointAdded, points }) => {
  const [data, setData] = useState<any>(null);
  const latSpan = Math.abs(bbox.maxLat - bbox.minLat);
  const lngSpan = Math.abs(bbox.maxLng - bbox.minLng);
  const width = 10; 
  const depth = 10 * (latSpan / lngSpan);
  const verticalScale = (depth / (latSpan * 111000)) * exaggeration;

  const layer = PROVIDERS[providerKey as keyof typeof PROVIDERS].layer;
  const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLE=&FORMAT=image/jpeg&SRS=EPSG:4326&WIDTH=1024&HEIGHT=1024&BBOX=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  const texture = useLoader(THREE.TextureLoader, url);

  useEffect(() => {
    setData(null);
    fetch(`http://localhost:3001/api/terrain?minLat=${bbox.minLat}&maxLat=${bbox.maxLat}&minLng=${bbox.minLng}&maxLng=${bbox.maxLng}`)
      .then(r => r.json()).then(setData).catch(console.error);
  }, [bbox]);

  const handleMeshClick = (p3d: THREE.Vector3) => {
    const lng = bbox.minLng + ((p3d.x + (width / 2)) / width) * lngSpan;
    const lat = bbox.minLat + ((p3d.z + (depth / 2)) / depth) * latSpan;
    const realAlt = p3d.y / verticalScale;
    onPointAdded({ lat, lng, realAlt });
  };

  if (!data) return <Html center><div style={{background: 'white', padding: '10px'}}>Fetching Elevation...</div></Html>;

  return (
    <group>
      <TerrainBlock 
        heights={data.heights} resolution={data.resolution} 
        width={width} depth={depth} texture={texture} 
        exaggeration={exaggeration} latSpan={latSpan}
        onMeshClick={handleMeshClick}
      />
      {points.map((p: any, i: number) => {
        const sX = ((p.lng - bbox.minLng) / lngSpan) * width - (width / 2);
        const sZ = ((p.lat - bbox.minLat) / latSpan) * depth - (depth / 2);
        const sY = p.realAlt * verticalScale;
        return <Marker key={i} position={[sX, sY, sZ]} label={`${p.realAlt.toFixed(0)}m`} />;
      })}
    </group>
  );
};

// --- MAIN APP ---
export default function TopoApp() {
  const [inputs, setInputs] = useState({ minLat: 30.0, maxLat: 38.0, minLng: 0.0, maxLng: 7.0, exag: 5.0 });
  const [activeParams, setActiveParams] = useState(inputs);
  const [points, setPoints] = useState<any[]>([]);
  const [isAddMode, setIsAddMode] = useState(false);
  const [provider, setProvider] = useState("BLUE_MARBLE");

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a1a' }}>
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(255,255,255,0.95)', padding: '15px', borderRadius: '8px', width: '280px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
        <h4 style={{margin: '0 0 10px 0'}}>Geophysics Topo Tool</h4>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          <label style={{fontSize: '10px'}}>Min Lat<input type="number" step="0.1" value={inputs.minLat} onChange={e => setInputs({...inputs, minLat: parseFloat(e.target.value)})}/></label>
          <label style={{fontSize: '10px'}}>Max Lat<input type="number" step="0.1" value={inputs.maxLat} onChange={e => setInputs({...inputs, maxLat: parseFloat(e.target.value)})}/></label>
          <label style={{fontSize: '10px'}}>Min Lng<input type="number" step="0.1" value={inputs.minLng} onChange={e => setInputs({...inputs, minLng: parseFloat(e.target.value)})}/></label>
          <label style={{fontSize: '10px'}}>Max Lng<input type="number" step="0.1" value={inputs.maxLng} onChange={e => setInputs({...inputs, maxLng: parseFloat(e.target.value)})}/></label>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{fontSize: '11px'}}>Vertical Exaggeration: <b>{inputs.exag}x</b></label>
          <input type="range" min="1" max="50" style={{width: '100%'}} value={inputs.exag} onChange={e => setInputs({...inputs, exag: parseFloat(e.target.value)})}/>
        </div>

        <select value={provider} onChange={e => setProvider(e.target.value)} style={{width: '100%', marginBottom: '10px'}}>
          {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>

        <button onClick={() => setActiveParams({...inputs})} style={{ width: '100%', padding: '10px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', marginBottom: '10px' }}>GENERATE MODEL</button>

        <button onClick={() => setIsAddMode(!isAddMode)} style={{ width: '100%', padding: '8px', background: isAddMode ? '#2ed573' : '#ffa502', color: 'white', border: 'none', borderRadius: '4px' }}>
          {isAddMode ? "CLICK MESH TO ADD POINT" : "ENABLE POINT TOOL"}
        </button>

        {points.length > 0 && (
          <div style={{ marginTop: '15px', borderTop: '1px solid #ccc', paddingTop: '10px' }}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <span style={{fontSize: '12px', fontWeight: 'bold'}}>Saved Points ({points.length})</span>
              <button onClick={() => setPoints([])} style={{fontSize: '10px'}}>Clear</button>
            </div>
            <div style={{ maxHeight: '150px', overflowY: 'auto', marginTop: '5px' }}>
              {points.map((p, i) => (
                <div key={i} style={{ fontSize: '10px', background: '#f0f0f0', padding: '5px', borderRadius: '4px', marginBottom: '3px' }}>
                  <b>P{i+1}:</b> {p.lat.toFixed(4)}, {p.lng.toFixed(4)} | <b>{p.realAlt.toFixed(0)}m</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Canvas shadows>
        <Suspense fallback={<Html center>Loading 3D Engine...</Html>}>
          <PerspectiveCamera makeDefault position={[12, 12, 12]} />
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <Center>
            <TerrainContainer 
              key={`${activeParams.minLat}-${activeParams.minLng}-${activeParams.maxLat}-${activeParams.maxLng}`} 
              bbox={activeParams} 
              providerKey={provider} 
              exaggeration={activeParams.exag}
              points={points}
              onPointAdded={(p: any) => isAddMode && setPoints([...points, p])}
            />
          </Center>
          <OrbitControls makeDefault enablePan={!isAddMode} />
          <Grid infiniteGrid fadeDistance={50} cellColor="#333" position={[0, -2, 0]} />
        </Suspense>
      </Canvas>
    </div>
  );
}
