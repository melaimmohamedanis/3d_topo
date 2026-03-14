import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Center, Html, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { VideoRecordingHelper } from './HighResScreenshotHelper';

// --- MATH: UTM PROJECTION ---
function toUTM(lat: number, lng: number) {
    const latRad = lat * (Math.PI / 180);
    const lngRad = lng * (Math.PI / 180);
    const zone = Math.floor((lng + 180) / 6) + 1;
    const lngOrigin = (zone - 1) * 6 - 180 + 3;
    const lngOriginRad = lngOrigin * (Math.PI / 180);
  
    const a = 6378137.0;
    const e = 0.08181919106;
    const k0 = 0.9996;
  
    const N = a / Math.sqrt(1 - Math.pow(e * Math.sin(latRad), 2));
    const T = Math.pow(Math.tan(latRad), 2);
    const C = Math.pow(e / Math.sqrt(1 - Math.pow(e, 2)), 2) * Math.pow(Math.cos(latRad), 2);
    const A = (lngRad - lngOriginRad) * Math.cos(latRad);
    
    const M = a * ((1 - Math.pow(e, 2) / 4 - 3 * Math.pow(e, 4) / 64 - 5 * Math.pow(e, 6) / 256) * latRad 
      - (3 * Math.pow(e, 2) / 8 + 3 * Math.pow(e, 4) / 32 + 45 * Math.pow(e, 6) / 1024) * Math.sin(2 * latRad)
      + (15 * Math.pow(e, 4) / 256 + 45 * Math.pow(e, 6) / 1024) * Math.sin(4 * latRad)
      - (35 * Math.pow(e, 6) / 3072) * Math.sin(6 * latRad));
  
    const x = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + Math.pow(T, 2) + 72 * C - 58 * Math.pow(e, 2)) * Math.pow(A, 5) / 120) + 500000.0;
    const y = k0 * (M + N * Math.tan(latRad) * (Math.pow(A, 2) / 2 + (5 - T + 9 * C + 4 * Math.pow(C, 2)) * Math.pow(A, 4) / 24 + (61 - 58 * T + Math.pow(T, 2) + 600 * C - 330 * Math.pow(e, 2)) * Math.pow(A, 6) / 720));
  
    return { x, y }; // Returns precise meters
  }

// --- MATH: GET ALTITUDE FROM GRID (BILINEAR INTERPOLATION) ---
function getAltitude(lat: number, lng: number, bbox: any, heights: number[], resolution: number) {
    // Using 4+ decimal places via precision scaling
    const latRange = bbox.maxLat - bbox.minLat;
    const lngRange = bbox.maxLng - bbox.minLng;
    
    const u = (lng - bbox.minLng) / lngRange;
    const v = (bbox.maxLat - lat) / latRange;
  
    const x = u * resolution;
    const y = v * resolution;
  
    const x0 = Math.floor(x); const x1 = Math.min(x0 + 1, resolution);
    const y0 = Math.floor(y); const y1 = Math.min(y0 + 1, resolution);
    
    // Calculate weights for sub-meter precision
    const dx = x - x0; const dy = y - y0;
    const stride = resolution + 1;
  
    // Bilinear interpolation formula:
    // f(x,y) ≈ h00(1-dx)(1-dy) + h10(dx)(1-dy) + h01(1-dx)(dy) + h11(dx)(dy)
    const h00 = heights[y0 * stride + x0];
    const h10 = heights[y0 * stride + x1];
    const h01 = heights[y1 * stride + x0];
    const h11 = heights[y1 * stride + x1];
  
    return h00 * (1 - dx) * (1 - dy) + h10 * dx * (1 - dy) + h01 * (1 - dx) * dy + h11 * dx * dy;
  }
// --- SHADER ---
const terrainShader = {
  uniforms: { uTexture: { value: null }, uSideColor: { value: new THREE.Color('#34495e') } },
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
      float light = max(dot(vNormal, vec3(0.3, 1.0, 0.4)), 0.0) * 0.5 + 0.5;
      vec3 color = (vType < 0.5) ? texture2D(uTexture, vUv).rgb : uSideColor;
      gl_FragColor = vec4(color * light, 1.0);
    }
  `
};

// --- SOLID TERRAIN BLOCK ---
const TerrainBlock = ({heights, resolution, width, depth, texture, verticalScale, onMeshClick }: any) => {
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const stride = resolution + 1;
    const vertices: number[] = [], uvs: number[] = [], indices: number[] = [], types: number[] = [];
    
    const halfW = width / 2; const halfD = depth / 2;
    const stepX = width / resolution; const stepZ = depth / resolution;
    const floor = (Math.min(...heights) * verticalScale) - (depth * 0.15); 

    // 1. TOP SURFACE
    for (let i = 0; i <= resolution; i++) {
      for (let j = 0; j <= resolution; j++) {
        vertices.push(-halfW + j * stepX, heights[i * stride + j] * verticalScale, -halfD + i * stepZ);
        uvs.push(j / resolution, 1 - i / resolution);
        types.push(0); 
      }
    }
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const a = i * stride + j, b = a + 1, c = (i + 1) * stride + j, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const addSide = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3) => {
      const start = vertices.length / 3;
      vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      types.push(1, 1, 1, 1); 
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    };

    // 2. SOUTH & NORTH WALLS
    for (let j = 0; j < resolution; j++) {
      addSide(
        new THREE.Vector3(-halfW + j * stepX, heights[j] * verticalScale, -halfD),
        new THREE.Vector3(-halfW + (j + 1) * stepX, heights[j + 1] * verticalScale, -halfD),
        new THREE.Vector3(-halfW + j * stepX, floor, -halfD),
        new THREE.Vector3(-halfW + (j + 1) * stepX, floor, -halfD)
      );
      addSide(
        new THREE.Vector3(-halfW + (j + 1) * stepX, heights[resolution * stride + j + 1] * verticalScale, halfD),
        new THREE.Vector3(-halfW + j * stepX, heights[resolution * stride + j] * verticalScale, halfD),
        new THREE.Vector3(-halfW + (j + 1) * stepX, floor, halfD),
        new THREE.Vector3(-halfW + j * stepX, floor, halfD)
      );
    }

    // 3. WEST & EAST WALLS
    for (let i = 0; i < resolution; i++) {
      addSide(
        new THREE.Vector3(-halfW, heights[(i + 1) * stride] * verticalScale, -halfD + (i + 1) * stepZ),
        new THREE.Vector3(-halfW, heights[i * stride] * verticalScale, -halfD + i * stepZ),
        new THREE.Vector3(-halfW, floor, -halfD + (i + 1) * stepZ),
        new THREE.Vector3(-halfW, floor, -halfD + i * stepZ)
      );
      addSide(
        new THREE.Vector3(halfW, heights[i * stride + resolution] * verticalScale, -halfD + i * stepZ),
        new THREE.Vector3(halfW, heights[(i + 1) * stride + resolution] * verticalScale, -halfD + (i + 1) * stepZ),
        new THREE.Vector3(halfW, floor, -halfD + i * stepZ),
        new THREE.Vector3(halfW, floor, -halfD + (i + 1) * stepZ)
      );
    }

    // 4. BOTTOM PLANE
    addSide(
      new THREE.Vector3(-halfW, floor, halfD),
      new THREE.Vector3(halfW, floor, halfD),
      new THREE.Vector3(-halfW, floor, -halfD),
      new THREE.Vector3(halfW, floor, -halfD)
    );

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('type', new THREE.Float32BufferAttribute(types, 1));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }, [heights, resolution, width, depth, verticalScale]);

  return (
    <mesh onClick={(e) => { e.stopPropagation(); onMeshClick(e.point); }}>
      <primitive object={geometry} attach="geometry" />
      <shaderMaterial args={[terrainShader]} uniforms-uTexture-value={texture} side={THREE.DoubleSide} />
    </mesh>
  );
};

// --- DATA CONTAINER ---
const TerrainContainer = ({  isClickEnabled,bbox, exaggeration, points, setPoints, showLabels }: any) => {
  const [data, setData] = useState<any>(null);
 
  const sw = useMemo(() => toUTM(bbox.minLat, bbox.minLng), [bbox]);
  const ne = useMemo(() => toUTM(bbox.maxLat, bbox.maxLng), [bbox]);
  
  const widthM = Math.abs(ne.x - sw.x);
  const depthM = Math.abs(ne.y - sw.y);
  const sceneScale = 12 / widthM; 
  const width = 12;
  const depth = depthM * sceneScale;
  const vScale = sceneScale * exaggeration;

  const url = useMemo(() => {
    // Always ensure min < max for the URL string
    const l1 = Math.min(bbox.minLng, bbox.maxLng);
    const l2 = Math.max(bbox.minLng, bbox.maxLng);
    const b1 = Math.min(bbox.minLat, bbox.maxLat);
    const b2 = Math.max(bbox.minLat, bbox.maxLat);
  
    return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=BlueMarble_NextGeneration&STYLE=&FORMAT=image/jpeg&SRS=EPSG:4326&WIDTH=1024&HEIGHT=1024&BBOX=${l1},${b1},${l2},${b2}`;
  }, [bbox]);
  const texture = useLoader(THREE.TextureLoader, url);

  useEffect(() => {
    setData(null);
    fetch(`http://localhost:3001/api/terrain?minLat=${bbox.minLat}&maxLat=${bbox.maxLat}&minLng=${bbox.minLng}&maxLng=${bbox.maxLng}`)
      .then(r => r.json()).then(setData);
  }, [bbox]);

  // NEW: Calculate altitude for manually typed points!
  useEffect(() => {
    if (!data) return;
    let hasUpdates = false;
    const updatedPoints = points.map((p: any) => {
      if (p.realAlt === null) {
        hasUpdates = true;
        return { ...p, realAlt: getAltitude(p.lat, p.lng, bbox, data.heights, data.resolution) };
      }
      return p;
    });
    if (hasUpdates) setPoints(updatedPoints);
  }, [points, data, bbox, setPoints]);

  if (!data) return <Html center><div style={{background:'white', padding:'10px', borderRadius:'5px', color:'black'}}>Calculating UTM Mesh...</div></Html>;

  return (
    <group>
   <TerrainBlock 
  heights={data.heights} resolution={data.resolution} width={width} depth={depth} 
  texture={texture} verticalScale={vScale}
  onMeshClick={(p: any) => {
    // Only add if the button is enabled
    if (!isClickEnabled) return; 
    
    const lng = bbox.minLng + ((p.x + width/2)/width) * (bbox.maxLng - bbox.minLng);
    const lat = bbox.maxLat - ((p.z + depth/2)/depth) * (bbox.maxLat - bbox.minLat);
    setPoints([...points, { lat, lng, realAlt: p.y / vScale }]);
  }}
/>
      {points.map((p: any, i: number) => {
        if (p.realAlt === null) return null; // Wait to render until altitude is calculated
        const pt = toUTM(p.lat, p.lng);
        const sX = (pt.x - sw.x) * sceneScale - (width / 2);
        const sZ = (ne.y - pt.y) * sceneScale - (depth / 2);
        return (
          <group key={i} position={[sX, p.realAlt * vScale, sZ]}>
            <mesh><sphereGeometry args={[0.1, 16, 16]} /><meshBasicMaterial color="#ff4757" /></mesh>
            {showLabels && <Html distanceFactor={10} position={[0, 0.4, 0]}><div style={{background:'black', color:'white', padding:'2px 5px', fontSize:'10px', whiteSpace:'nowrap', border:'1px solid #ff4757'}}>{p.realAlt.toFixed(0)}m | {p.lat.toFixed(3)},{p.lng.toFixed(3)}</div></Html>}
          </group>
        );
      })}
    </group>
  );
};

// --- MAIN APP ---
export default function TopoApp() {
  const [inputs, setInputs] = useState({ minLat: 34, maxLat: 38, minLng: -85, maxLng: -81, exag: 15 });
  const [active, setActive] = useState(inputs);
  const [points, setPoints] = useState<any[]>([]);
  const [manual, setManual] = useState({ lat: 34.5, lng: 4.0 });
  const [showLabels, setShowLabels] = useState(true);
  const [isClickEnabled, setIsClickEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const handleToggleRecording = () => {
    if ((window as any).toggleVideoRecording) {
      // Call the helper and pass setIsRecording so the button updates automatically!
      (window as any).toggleVideoRecording((recordingState: boolean) => {
        setIsRecording(recordingState);
      });
    } else {
      console.warn("Video helper not loaded yet.");
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f172a' }}>
      <div style={{ position:'absolute', top:20, left:20, zIndex:10, background:'white', padding:'20px', borderRadius:'12px', width:'320px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
        <h3 style={{marginTop:0, color:'#1e293b'}}>UTM Terrain Engine</h3>
        
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
          <label style={{fontSize:'11px'}}>Min Lat<input type="number" step="0.1" value={inputs.minLat} onChange={e => setInputs({...inputs, minLat: parseFloat(e.target.value) || 0})} style={{width:'100%'}}/></label>
          <label style={{fontSize:'11px'}}>Max Lat<input type="number" step="0.1" value={inputs.maxLat} onChange={e => setInputs({...inputs, maxLat: parseFloat(e.target.value) || 0})} style={{width:'100%'}}/></label>
          <label style={{fontSize:'11px'}}>Min Lng<input type="number" step="0.1" value={inputs.minLng} onChange={e => setInputs({...inputs, minLng: parseFloat(e.target.value) || 0})} style={{width:'100%'}}/></label>
          <label style={{fontSize:'11px'}}>Max Lng<input type="number" step="0.1" value={inputs.maxLng} onChange={e => setInputs({...inputs, maxLng: parseFloat(e.target.value) || 0})} style={{width:'100%'}}/></label>
        </div>

        <div style={{ marginTop:'15px' }}>
          <label style={{fontSize:'11px', fontWeight:'bold'}}>Vertical Exaggeration: {inputs.exag}x</label>
          <input type="range" min="1" max="50" value={inputs.exag} onChange={e => setInputs({...inputs, exag: parseInt(e.target.value) || 1})} style={{width:'100%'}} />
        </div>

        <button onClick={() => setActive({...inputs})} style={{ width:'100%', marginTop:'15px', background:'#2563eb', color:'white', border:'none', padding:'10px', borderRadius:'6px', cursor:'pointer', fontWeight:'bold' }}>
          UPDATE 3D MODEL
        </button>
        // <button onClick={handleToggleRecording}>
  {isRecording ? '🛑 Stop Recording' : '🎥 Start Recording'}
 </button>
        <hr style={{margin:'20px 0', border:'none', borderTop:'1px solid #e2e8f0'}}/>
        
        <h4 style={{margin:'0 0 10px 0'}}>Points Manager</h4>
        <button 
    onClick={() => setIsClickEnabled(!isClickEnabled)} 
    style={{ 
      width: '100%', padding: '10px', marginBottom: '10px',
      background: isClickEnabled ? '#e11d48' : '#2563eb', 
      color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight:'bold' 
    }}>
    {isClickEnabled ? '⏹ Disable Click-to-Add' : '🖱 Enable Click-to-Add'}
  </button>
        <button onClick={() => setShowLabels(!showLabels)} style={{ width: '100%', padding: '8px', background: showLabels ? '#3498db' : '#95a5a6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginBottom: '10px', fontSize: '11px' }}>
          {showLabels ? '👁️ Hide Labels' : '👁️‍🗨️ Show Labels'}
        </button>

        <div style={{display:'flex', gap:'5px', marginBottom:'10px'}}>
          <input type="number" placeholder="Lat" value={manual.lat} onChange={e => setManual({...manual, lat: parseFloat(e.target.value) || 0})} style={{width:'40%', fontSize:'11px', padding:'4px'}}/>
          <input type="number" placeholder="Lng" value={manual.lng} onChange={e => setManual({...manual, lng: parseFloat(e.target.value) || 0})} style={{width:'40%', fontSize:'11px', padding:'4px'}}/>
          
          {/* THE FIX IS HERE: realAlt starts as null, forcing the useEffect to calculate it */}
          <button onClick={() => setPoints([...points, { ...manual, realAlt: null }])} style={{width:'20%', background:'#333', color:'white', border:'none', borderRadius:'4px', cursor:'pointer'}}>+</button>
        </div>

        {points.length > 0 && (
          <div style={{maxHeight:'120px', overflowY:'auto', border:'1px solid #e2e8f0', borderRadius:'4px'}}>
            {points.map((p, i) => (
              <div key={i} style={{fontSize:'11px', padding:'8px', borderBottom:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between', background: i%2===0 ? '#fff' : '#f8fafc'}}>
                <div>
                  <strong>P{i+1}:</strong> {p.lat.toFixed(3)}, {p.lng.toFixed(3)}
                  {/* AND HERE: Checked against null instead of falsy */}
                  <div style={{color:'#64748b'}}>Alt: {p.realAlt !== null ? `${p.realAlt.toFixed(1)}m` : 'Calculating...'}</div>
                </div>
                <button onClick={() => setPoints(points.filter((_, idx) => idx !== i))} style={{color:'#ef4444', border:'none', background:'none', cursor:'pointer', fontWeight:'bold', fontSize:'14px'}}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Canvas shadows gl={{ preserveDrawingBuffer: true }} dpr={[1, 2]}>
        <Suspense fallback={<Html center><div style={{color:'white'}}>Loading Engine...</div></Html>}>
          <PerspectiveCamera makeDefault position={[18, 15, 18]} />
          <ambientLight intensity={0.6} />
          <pointLight position={[50, 50, 50]} intensity={1.5} />
          <VideoRecordingHelper />
          <Center>
            <TerrainContainer 
            isClickEnabled={isClickEnabled}
              bbox={active} exaggeration={active.exag} 
              points={points} setPoints={setPoints}
              showLabels={showLabels}
            />
          </Center>
          <OrbitControls makeDefault />
          <Grid infiniteGrid fadeDistance={80} cellColor="#1e293b" sectionColor="#334155" position={[0, -2, 0]} />
        </Suspense>
      </Canvas>
    </div>
  );
}