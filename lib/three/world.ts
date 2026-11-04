import * as THREE from "three";
import { WATER_Y, WORLD, clamp, rng, terrainY, vnoise } from "../terrain";
import { stoneGeometry } from "./stone";

type Item = { x: number; y: number; z: number; r: () => number };

function scatter(count: number, seed: number, rMin: number, rMax: number, ok: (x: number, y: number, z: number, slope: number) => boolean) {
  const r = rng(seed), out: Item[] = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 20) {
    const a = r() * Math.PI * 2, d = rMin + Math.sqrt(r()) * (rMax - rMin);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, y = terrainY(x, z);
    const slope = Math.hypot(terrainY(x + 0.4, z) - terrainY(x - 0.4, z), terrainY(x, z + 0.4) - terrainY(x, z - 0.4));
    if (ok(x, y, z, slope)) out.push({ x, y, z, r });
  }
  return out;
}

function instanced<T extends { x: number; y: number; z: number }>(
  root: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, items: T[],
  place: (it: T, o: THREE.Object3D, c: THREE.Color) => void,
) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  items.forEach((it, i) => {
    o.position.set(it.x, it.y, it.z);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
    place(it, o, c);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    m.setColorAt(i, c);
  });
  m.castShadow = m.receiveShadow = true;
  root.add(m);
}

export function buildWorld(root: THREE.Object3D) {
  // 땅: 높이·경사에 따라 색이 변한다
  const S = WORLD + 14, SEG = 260;
  const geo = new THREE.PlaneGeometry(S * 2, S * 2, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  const grass = new THREE.Color("#b9cf9d"), grass2 = new THREE.Color("#9fbf86"), sand = new THREE.Color("#e3d7b8"), rock = new THREE.Color("#aaa6a8"), snow = new THREE.Color("#f1f0f4");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = terrainY(x, z);
    pos.setY(i, y);
    const slope = Math.hypot(terrainY(x + 0.5, z) - terrainY(x - 0.5, z), terrainY(x, z + 0.5) - terrainY(x, z - 0.5));
    c.copy(grass).lerp(grass2, vnoise(x * 0.3, z * 0.3));
    if (y < WATER_Y + 0.6) c.lerp(sand, clamp((WATER_Y + 0.6 - y) / 0.6, 0, 1));
    if (slope > 0.7) c.lerp(rock, clamp((slope - 0.7) / 0.8, 0, 1));
    if (y > 5.5) c.lerp(snow, clamp((y - 5.5) / 2, 0, 1));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  root.add(ground);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(S * 2, S * 2),
    new THREE.MeshStandardMaterial({ color: "#8fb8da", roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.82 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  root.add(water);

  // 식생: 전부 인스턴싱
  const onLand = (_x: number, y: number, _z: number, slope: number) => y > WATER_Y + 0.5 && slope < 0.9;
  const trees = scatter(620, 11, 8, WORLD + 3, (x, y, z, s) => onLand(x, y, z, s) && y < 5);
  instanced(root, new THREE.CylinderGeometry(0.1, 0.17, 1, 7), new THREE.MeshStandardMaterial({ roughness: 1 }), trees, (t, o, col) => {
    const h = 0.9 + t.r() * 0.8;
    o.position.y += h / 2;
    o.scale.set(1, h, 1);
    col.set("#8b6a52").offsetHSL(0, 0, (t.r() - 0.5) * 0.1);
  });
  const canopy: { x: number; y: number; z: number; s: number; hue: number; l: number }[] = [];
  for (const t of trees) {
    const h = 0.9 + t.r() * 0.8, k = 2 + Math.floor(t.r() * 2), hue = 0.25 + t.r() * 0.12, l = 0.5 + t.r() * 0.15;
    for (let i = 0; i < k; i++) canopy.push({ x: t.x + (t.r() - 0.5) * 0.5, y: t.y + h + 0.3 + i * 0.45 * (t.r() + 0.5), z: t.z + (t.r() - 0.5) * 0.5, s: 0.55 + t.r() * 0.5, hue, l });
  }
  instanced(root, new THREE.SphereGeometry(1, 12, 9), new THREE.MeshStandardMaterial({ roughness: 0.95 }), canopy, (t, o, col) => {
    o.scale.set(t.s * 1.1, t.s * 0.9, t.s * 1.1);
    col.setHSL(t.hue, 0.45, t.l);
  });
  instanced(root, new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ roughness: 1 }), scatter(420, 23, 5, WORLD + 1, onLand), (t, o, col) => {
    const s = 0.35 + t.r() * 0.45;
    o.position.y += s * 0.5;
    o.scale.set(s * 1.3, s * 0.8, s * 1.2);
    col.setHSL(0.28 + t.r() * 0.08, 0.4, 0.5 + t.r() * 0.12);
  });
  const flowers = scatter(1800, 37, 3.5, WORLD - 1, onLand);
  instanced(root, new THREE.CylinderGeometry(0.018, 0.022, 0.3, 5), new THREE.MeshStandardMaterial({ roughness: 1 }), flowers, (_t, o, col) => {
    o.position.y += 0.15;
    col.set("#88b57a");
  });
  instanced(root, new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.9 }), flowers, (t, o, col) => {
    o.position.y += 0.32;
    o.scale.set(1, 0.55, 1);
    col.setHSL([0, 0.08, 0.14, 0.78, 0.9, 0.55][Math.floor(t.r() * 6)], 0.6, 0.72);
  });
  // 주울 수 없는 큰 바위. 줍는 돌과 구별되도록 한참 크다
  instanced(root, stoneGeometry(3), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), scatter(90, 71, 7, WORLD + 4, (_x, y) => y > WATER_Y + 0.2), (t, o, col) => {
    const s = 0.9 + t.r() * 1.3;
    o.scale.set(s * 1.4, s, s * 1.2);
    o.rotation.set((t.r() - 0.5) * 0.4, t.r() * 6, 0);
    o.position.y += s * 0.25;
    col.setHSL(0.09, 0.06, 0.55 + t.r() * 0.15);
  });
}
