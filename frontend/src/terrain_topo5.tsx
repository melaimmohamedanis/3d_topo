import React, { useEffect, useState, useMemo, Suspense } from 'react';
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
  uniforms: { uTexture: { value: null }, uSideColor: { value: new THREE.Color('#4a4a4a') } },
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
const Marker = ({ position, lat, lng, alt }: { position: [number, number, number], lat: number, lng: number, alt: number }) => (
  <group position={position}>
    <mesh position={[0, 0.1, 0]}>
      <sphereGeometry args={[0.08, 16, 16]} />
      <meshBasicMaterial color="#ff4757" />
    </mesh>
    <Html distanceFactor={8} position={[0, 0.3, 0]}>
      <div style={{ 
        color: 'white', background: 'rgba(0,0,0,0.8)', padding: '4px 8px', 
        borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap', pointerEvents: 'none',
        border: '1px solid #ff4757', lineHeight: '1.4'
      }}>
        <strong>{alt !== undefined ? `${alt.toFixed(0)}m` : 'Calc...'}</strong><br/>
        Lat: {lat.toFixed(4)}°<br/>
        Lng: {lng.toFixed(4)}°
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
const TerrainContainer: React.FC<any> = ({ bbox, providerKey, exaggeration, onPointAdded, onPointsUpdated, points }) => {
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

  // Bilinear interpolation to find exact altitude at any Lat/Lng
  const getAltitudeAtLatLng = (lat: number, lng: number) => {
    if (!data) return 0;
    // 0 is North (maxLat), 1 is South (minLat)
    const normLat = (bbox.maxLat - lat) / latSpan; 
    const normLng = (lng - bbox.minLng) / lngSpan;
    
    const iExact = normLat * data.resolution;
    const jExact = normLng * data.resolution;
    
    const i0 = Math.max(0, Math.min(data.resolution, Math.floor(iExact)));
    const i1 = Math.max(0, Math.min(data.resolution, i0 + 1));
    const j0 = Math.max(0, Math.min(data.resolution, Math.floor(jExact)));
    const j1 = Math.max(0, Math.min(data.resolution, j0 + 1));
    
    const u = iExact - i0;
    const v = jExact - j0;
    
    const stride = data.resolution + 1;
    const h00 = data.heights[i0 * stride + j0];
    const h01 = data.heights[i0 * stride + j1];
    const h10 = data.heights[i1 * stride + j0];
    const h11 = data.heights[i1 * stride + j1];
    
    const h0 = h00 * (1 - v) + h01 * v;
    const h1 = h10 * (1 - v) + h11 * v;
    
    return h0 * (1 - u) + h1 * u;
  };

  // Sync missing altitudes back to the UI state
  useEffect(() => {
    if (!data || points.length === 0) return;
    let needsUpdate = false;
    const updatedPoints = points.map((p: any) => {
      if (p.realAlt === undefined) {
        needsUpdate = true;
        return { ...p, realAlt: getAltitudeAtLatLng(p.lat, p.lng) };
      }
      return p;
    });
    if (needsUpdate) onPointsUpdated(updatedPoints);
  }, [points, data]);

  const handleMeshClick = (p3d: THREE.Vector3) => {
    // X mapping is standard: -width/2 is West (minLng)
    const lng = bbox.minLng + ((p3d.x + (width / 2)) / width) * lngSpan;
    // FIXED Z MAPPING: -depth/2 is North (maxLat)
    const lat = bbox.maxLat - ((p3d.z + (depth / 2)) / depth) * latSpan;
    
    const realAlt = p3d.y / verticalScale;
    onPointAdded({ lat, lng, realAlt });
  };

  if (!data) return <Html center><div style={{background: 'white', padding: '10px', borderRadius: '4px'}}>Fetching Elevation...</div></Html>;

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
        // FIXED Z MAPPING FOR MARKERS: maxLat goes to -depth/2
        const sZ = ((bbox.maxLat - p.lat) / latSpan) * depth - (depth / 2);
        
        // Use pre-calculated alt if available, otherwise calculate it on the fly
        const currentAlt = p.realAlt !== undefined ? p.realAlt : getAltitudeAtLatLng(p.lat, p.lng);
        const sY = currentAlt * verticalScale;
        
        return <Marker key={i} position={[sX, sY, sZ]} lat={p.lat} lng={p.lng} alt={currentAlt} />;
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
  
  // State for manual point entry (No Altitude needed!)
  const [manualPoint, setManualPoint] = useState({ lat: 34.0, lng: 3.5 });

  const handleAddPoint = (p: any) => {
    if (
      p.lat >= activeParams.minLat && p.lat <= activeParams.maxLat &&
      p.lng >= activeParams.minLng && p.lng <= activeParams.maxLng
    ) {
      setPoints(prev => [...prev, p]);
    } else {
      alert(`Point out of bounds!\nMust be within:\nLat: ${activeParams.minLat} to ${activeParams.maxLat}\nLng: ${activeParams.minLng} to ${activeParams.maxLng}`);
    }
  };

  const removePoint = (indexToRemove: number) => {
    setPoints(points.filter((_, index) => index !== indexToRemove));
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a1a', display: 'flex' }}>
      
      {/* SIDEBAR UI */}
      <div style={{ 
        position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(255,255,255,0.95)', 
        padding: '15px', borderRadius: '8px', width: '320px', maxHeight: '90vh', overflowY: 'auto', 
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)', fontFamily: 'sans-serif' 
      }}>
        <h3 style={{margin: '0 0 15px 0', borderBottom: '2px solid #333', paddingBottom: '5px'}}>Geophysics Topo Tool</h3>
        
        {/* Terrain Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          <label style={{fontSize: '11px'}}>Min Lat<input type="number" step="0.1" value={inputs.minLat} onChange={e => setInputs({...inputs, minLat: parseFloat(e.target.value) || 0})} style={{width: '100%'}}/></label>
          <label style={{fontSize: '11px'}}>Max Lat<input type="number" step="0.1" value={inputs.maxLat} onChange={e => setInputs({...inputs, maxLat: parseFloat(e.target.value) || 0})} style={{width: '100%'}}/></label>
          <label style={{fontSize: '11px'}}>Min Lng<input type="number" step="0.1" value={inputs.minLng} onChange={e => setInputs({...inputs, minLng: parseFloat(e.target.value) || 0})} style={{width: '100%'}}/></label>
          <label style={{fontSize: '11px'}}>Max Lng<input type="number" step="0.1" value={inputs.maxLng} onChange={e => setInputs({...inputs, maxLng: parseFloat(e.target.value) || 0})} style={{width: '100%'}}/></label>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{fontSize: '11px'}}>Vertical Exaggeration: <b>{inputs.exag}x</b></label>
          <input type="range" min="1" max="50" style={{width: '100%'}} value={inputs.exag} onChange={e => setInputs({...inputs, exag: parseFloat(e.target.value)})}/>
        </div>

        <select value={provider} onChange={e => setProvider(e.target.value)} style={{width: '100%', marginBottom: '10px', padding: '5px'}}>
          {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>

        <button onClick={() => { setActiveParams({...inputs}); setPoints([]); }} 
          style={{ width: '100%', padding: '10px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', marginBottom: '20px', cursor: 'pointer' }}>
          GENERATE MODEL
        </button>

        <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '15px 0' }} />

        {/* Points Manager */}
        <h4 style={{margin: '0 0 10px 0'}}>Points Manager</h4>
        
        <button onClick={() => setIsAddMode(!isAddMode)} 
          style={{ width: '100%', padding: '10px', background: isAddMode ? '#2ed573' : '#ffa502', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '10px' }}>
          {isAddMode ? "🎯 CLICK MESH TO ADD POINT" : "🖱️ ENABLE CLICK-TO-ADD"}
        </button>

        {/* Manual Point Entry - No Altitude Needed */}
        <div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '4px', border: '1px solid #e9ecef', marginBottom: '10px' }}>
          <strong style={{fontSize: '11px', display: 'block', marginBottom: '5px'}}>Manual Entry (Auto-Heights):</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginBottom: '8px' }}>
            <input type="number" placeholder="Lat" value={manualPoint.lat} onChange={e => setManualPoint({...manualPoint, lat: parseFloat(e.target.value) || 0})} style={{fontSize: '11px', padding: '4px'}}/>
            <input type="number" placeholder="Lng" value={manualPoint.lng} onChange={e => setManualPoint({...manualPoint, lng: parseFloat(e.target.value) || 0})} style={{fontSize: '11px', padding: '4px'}}/>
          </div>
          <button 
            // Note: We don't pass realAlt here anymore. The TerrainContainer will calculate it!
            onClick={() => handleAddPoint({ lat: manualPoint.lat, lng: manualPoint.lng })} 
            style={{ width: '100%', padding: '5px', background: '#343a40', color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
            + ADD MANUAL POINT
          </button>
        </div>

        {/* Points List */}
        {points.length > 0 && (
          <div>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px'}}>
              <span style={{fontSize: '12px', fontWeight: 'bold'}}>Saved Points ({points.length})</span>
              <button onClick={() => setPoints([])} style={{fontSize: '10px', padding: '2px 6px', cursor: 'pointer'}}>Clear All</button>
            </div>
            <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
              {points.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', background: i % 2 === 0 ? '#fff' : '#f8f9fa', padding: '8px', borderBottom: '1px solid #eee' }}>
                  <div>
                    <b>P{i+1}:</b> {p.lat.toFixed(3)}°, {p.lng.toFixed(3)}° <br/>
                    <span style={{color: '#666'}}>Alt: {p.realAlt !== undefined ? `${p.realAlt.toFixed(1)}m` : 'Calculating...'}</span>
                  </div>
                  <button onClick={() => removePoint(i)} style={{ background: 'transparent', border: 'none', color: '#ff4757', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', padding: '0 5px' }} title="Remove Point">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3D CANVAS */}
      <Canvas shadows>
        <Suspense fallback={<Html center>Loading 3D Engine...</Html>}>
          <PerspectiveCamera makeDefault position={[12, 12, 12]} />
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1.2} />
          <Center>
            <TerrainContainer 
              key={`${activeParams.minLat}-${activeParams.minLng}-${activeParams.maxLat}-${activeParams.maxLng}`} 
              bbox={activeParams} 
              providerKey={provider} 
              exaggeration={activeParams.exag}
              points={points}
              onPointAdded={(p: any) => isAddMode && handleAddPoint(p)}
              onPointsUpdated={setPoints} 
            />
          </Center>
          <OrbitControls makeDefault enablePan={!isAddMode} />
          <Grid infiniteGrid fadeDistance={50} cellColor="#444" position={[0, -2, 0]} />
        </Suspense>
      </Canvas>
    </div>
  );
}