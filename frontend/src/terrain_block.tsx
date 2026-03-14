import React, { useMemo } from 'react';
import * as THREE from 'three';

interface TerrainBlockProps {
  heights: number[];
  resolution: number;
  size: number;
  texture: THREE.Texture;
  exaggeration?: number;
}

const TerrainBlock: React.FC<TerrainBlockProps> = ({ 
  heights, 
  resolution, 
  size, 
  texture, 
  exaggeration = 0.002 
}) => {
  const res = resolution;
  const stride = res + 1;
  const halfSize = size / 2;
  const step = size / res;

  const { geometry, floorLevel } = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const minH = Math.min(...heights) * exaggeration;
    const floor = minH - 1.5;

    // 1. GENERATE TOP VERTICES
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        const x = -halfSize + j * step;
        const z = -halfSize + i * step;
        const y = heights[i * stride + j] * exaggeration;
        vertices.push(x, y, z);
        uvs.push(j / res, 1 - i / res);
      }
    }

    // Top Face Indices
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const a = i * stride + j;
        const b = i * stride + j + 1;
        const c = (i + 1) * stride + j;
        const d = (i + 1) * stride + j + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const topIndexCount = indices.length;

    // 2. GENERATE SIDE WALLS (Connecting to the same top vertices)
    const floorStartIdx = vertices.length / 3;
    
    // Add floor-level perimeter vertices
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        const x = -halfSize + j * step;
        const z = -halfSize + i * step;
        vertices.push(x, floor, z);
        uvs.push(j / res, 1 - i / res); // Placeholder UVs
      }
    }

    // Build side faces (North, South, East, West)
    const addSide = (start1: number, start2: number, step: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const t1 = start1 + i * step;
        const t2 = start1 + (i + 1) * step;
        const b1 = t1 + floorStartIdx;
        const b2 = t2 + floorStartIdx;
        indices.push(t1, b1, t2, t2, b1, b2);
      }
    };

    addSide(0, 1, 1, res); // North
    addSide(res * stride, (res * stride) + 1, 1, res); // South
    addSide(0, stride, stride, res); // West
    addSide(res, res + stride, stride, res); // East

    const totalIndexCount = indices.length;

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);

    // 3. APPLY GROUPS (Group 0 = Top, Group 1 = Sides)
    geom.addGroup(0, topIndexCount, 0); 
    geom.addGroup(topIndexCount, totalIndexCount - topIndexCount, 1);

    geom.computeVertexNormals(); // This now smooths the edge because vertices are shared!

    return { geometry: geom, floorLevel: floor };
  }, [heights, res, size, exaggeration, stride]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      {/* Array of materials: [Top Material, Side Material] */}
      <meshStandardMaterial attach="material-0" map={texture} roughness={1} />
      <meshStandardMaterial attach="material-1" color="#222" roughness={0.8} />
    </mesh>
  );
};

export default TerrainBlock;