import * as THREE from "three";
import { rng } from "../terrain";

// 시드 → 모양. 지오메트리·재질은 풀로 공유하고 서버가 정한 반경·높이는 스케일로 맞춘다.
const SHAPE_COUNT = 16;
const COLOR_COUNT = 10;
let shapes: THREE.BufferGeometry[] | null = null;
let materials: THREE.Material[] | null = null;

function buildShape(seed: number) {
  const r = rng(seed * 7919 + 13);
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position, v = new THREE.Vector3();
  const f = [1.3 + r() * 2, 1.3 + r() * 2, 1.3 + r() * 2], ph = [r() * 6, r() * 6, r() * 6], amp = 0.08 + r() * 0.14;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * f[0] + ph[0]) * Math.sin(v.y * f[1] + ph[1]) + Math.cos(v.z * f[2] + ph[2]) * 0.7 + Math.sin((v.x + v.y + v.z) * 3.1 + ph[0]) * 0.4;
    v.multiplyScalar(1 + n * amp);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // 경계 상자를 중심 원점, 크기 1로 정규화
  geo.computeBoundingBox();
  const c = geo.boundingBox!.getCenter(new THREE.Vector3()), s = geo.boundingBox!.getSize(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(1 / s.x, 1 / s.y, 1 / s.z);
  geo.computeVertexNormals();
  return geo;
}

export function stoneGeometry(seed: number) {
  shapes ??= Array.from({ length: SHAPE_COUNT }, (_, i) => buildShape(i));
  return shapes[Math.abs(seed) % SHAPE_COUNT];
}

function stoneMaterial(seed: number) {
  materials ??= Array.from({ length: COLOR_COUNT }, (_, i) => {
    const r = rng(i * 131 + 5);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.08 + r() * 0.08, 0.08 + r() * 0.1, 0.45 + r() * 0.3),
      roughness: 0.95,
      flatShading: true,
    });
  });
  return materials[Math.abs(seed >> 4) % COLOR_COUNT];
}

export function makeStoneMesh(seed: number, radius: number, height: number) {
  const mesh = new THREE.Mesh(stoneGeometry(seed), stoneMaterial(seed));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.scale.set(radius * 2, height, radius * 2);
  mesh.rotation.y = rng(seed)() * Math.PI * 2;
  return mesh;
}
