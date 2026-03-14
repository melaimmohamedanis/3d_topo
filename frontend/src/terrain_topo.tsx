import React, { useEffect, useState, Suspense } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, Sky, PerspectiveCamera, Center } from '@react-three/drei';
import * as THREE from 'three';
// 1. IMPORT the TerrainBlock component
import TerrainBlock from './terrain_block'; 

interface TerrainData {
  heights: number[];
  resolution: number;
}

const TerrainContainer: React.FC = () => {
  const [data, setData] = useState<TerrainData | null>(null);

  // 2. Load the Texture
  const nasaUrl = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=BlueMarble_NextGeneration&STYLE=&FORMAT=image/jpeg&SRS=EPSG:4326&WIDTH=1024&HEIGHT=1024&BBOX=6.8,45.8,7.0,46.0"; 
  const satelliteTexture = useLoader(THREE.TextureLoader, nasaUrl);
  
  // Apply color correction
  satelliteTexture.colorSpace = THREE.SRGBColorSpace;

  // 3. Fetch Elevation Data
  useEffect(() => {
    fetch('http://localhost:3001/api/terrain')
      .then(res => res.json())
      .then(setData)
      .catch(err => console.error("Fetch error:", err));
  }, []);

  if (!data) return null;

  // 4. RETURN the integrated TerrainBlock
  return (
    <TerrainBlock 
      heights={data.heights} 
      resolution={data.resolution} 
      size={10} 
      texture={satelliteTexture} 
      exaggeration={0.002} 
    />
  );
};

export default function TopoApp() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Canvas shadows>
        <Suspense fallback={null}>
          <PerspectiveCamera makeDefault position={[12, 12, 12]} />
          <Sky distance={450000} sunPosition={[0, 1, 0]} />
          <ambientLight intensity={1.0} />
          <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
          
          <Center>
            <TerrainContainer />
          </Center>

          <OrbitControls makeDefault />
        </Suspense>
      </Canvas>
    </div>
  );
}