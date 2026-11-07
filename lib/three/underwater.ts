import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WATER_Y, WORLD, rng, terrainY, vnoise } from "../terrain";

// ── 물속 장식: 수초와 조약돌 ──
// 돌려준 메시는 world.ts가 꽃처럼 가까운 칸만 그린다(그림자 없음). 자리는 시드로 정해 모두에게 같다
const TILE = 40; // 칸이 작으면 그리기 호출이 늘고, 크면 먼 칸까지 함께 그린다
const SWAY = 0.09; // 물결에 흔들리는 끝의 최대 폭(m)

// 띠 수초: 가늘고 긴 잎 6장이 밑동에서 퍼진다. 높이 1, 잎마다 길이·기울기가 다르다(양면 판, 36삼각형)
function ribbonGeometry() {
  const r = rng(11), parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 3).translate(0, 0.5, 0), p = g.attributes.position;
    const len = 0.6 + r() * 0.4, bend = 0.15 + r() * 0.25;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i); // 0(밑동)~1(끝)
      p.setXYZ(i, p.getX(i) * 0.11 * (1 - t * 0.7), t * len, bend * t * t);
    }
    parts.push(g.rotateY((k / 6) * Math.PI * 2 + r()).deleteAttribute("uv"));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}
// 둥근 수초: 넓적한 잎 7장이 바깥으로 휘며 둥글게 모인다. 높이 1쯤(양면 판, 28삼각형)
function rosetteGeometry() {
  const r = rng(23), parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 2).translate(0, 0.5, 0), p = g.attributes.position;
    const len = 0.8 + r() * 0.3, out = 0.45 + (k % 3) * 0.25; // 안쪽 잎은 서고 바깥 잎은 눕는다
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i);
      p.setXYZ(i, p.getX(i) * 0.5 * Math.sin(Math.PI * (0.12 + t * 0.76)), len * t * (1 - out * 0.6 * t), len * t * out);
    }
    parts.push(g.rotateY((k / 7) * Math.PI * 2 + r() * 0.5).deleteAttribute("uv"));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

// 흔들림: 물살 방향으로 천천히 오가고, 끝으로 갈수록 크게 휜다(밑동은 그대로)
function current(mat: THREE.Material, time: { value: number }, key: string) {
  mat.customProgramCacheKey = () => `under-${key}`;
  mat.onBeforeCompile = (s) => {
    s.uniforms.uWindTime = time;
    s.vertexShader = "uniform float uWindTime;\n" + s.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vec2 cp = instanceMatrix[3].xz;
      float sw = sin(uWindTime * 0.7 + cp.x * 0.35 + cp.y * 0.2) + 0.35 * sin(uWindTime * 1.1 + dot(cp, vec2(-0.5, 0.8)));
      vec2 cw = vec2(0.8, 0.6) * sw + vec2(-0.6, 0.8) * 0.3 * sin(uWindTime * 0.9 + cp.y * 0.4);
      transformed += inverse(mat3(instanceMatrix)) * vec3(cw.x, 0.0, cw.y) * ${SWAY.toFixed(3)} * position.y * position.y;`);
  };
  return mat;
}

type Spot = { x: number; y: number; z: number; d: number };
// 물 바닥에서 깊이 lo~hi인 곳을 무리 가운데로 count개 고른다(돌다리 밑은 바닥이 물 위라 빠진다)
function spots(count: number, seed: number, lo: number, hi: number) {
  const r = rng(seed), out: Spot[] = [];
  for (let k = 0; k < count * 60 && out.length < count; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * WORLD, x = Math.cos(a) * d, z = Math.sin(a) * d, y = terrainY(x, z);
    if (WATER_Y - y > lo && WATER_Y - y < hi) out.push({ x, y, z, d: WATER_Y - y });
  }
  return out;
}

type Inst = { x: number; z: number; m: THREE.Matrix4; c: THREE.Color };
// 칸마다 인스턴스 메시 하나
function cells(root: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[], pad: number) {
  const map = new Map<string, Inst[]>();
  for (const it of items) {
    const k = `${Math.floor(it.x / TILE)},${Math.floor(it.z / TILE)}`;
    map.get(k)?.push(it) ?? map.set(k, [it]);
  }
  return [...map.values()].map((cell) => {
    const m = new THREE.InstancedMesh(geo, mat, cell.length);
    cell.forEach((it, i) => { m.setMatrixAt(i, it.m); m.setColorAt(i, it.c); });
    m.receiveShadow = true;
    m.computeBoundingSphere();
    m.boundingSphere!.radius += pad;
    root.add(m);
    return m;
  });
}

export function buildUnderwater(root: THREE.Object3D, time: { value: number }): THREE.InstancedMesh[] {
  const r = rng(9071), o = new THREE.Object3D(), ribbons: Inst[] = [], rosettes: Inst[] = [], pebbles: Inst[] = [];
  const put = (list: Inst[], x: number, y: number, z: number, sx: number, sy: number, sz: number, c: THREE.Color, tilt = 0) => {
    o.position.set(x, y, z);
    o.rotation.set((r() - 0.5) * tilt, r() * Math.PI * 2, (r() - 0.5) * tilt);
    o.scale.set(sx, sy, sz);
    o.updateMatrix();
    list.push({ x, z, m: o.matrix.clone(), c });
  };
  const near = (c: Spot, spread: number) => {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
    return { x, z, y: terrainY(x, z), d: WATER_Y - terrainY(x, z) };
  };
  // 수초 무리: 대부분 띠 수초, 가끔 둥근 수초. 무리마다 색조가 조금 다르고 바닥에 조금 묻힌다
  // 키는 물 깊이보다 낮게 해 수면 위로 나오지 않는다
  for (const c of spots(170, 9101, 0.25, 1.6)) {
    const round = r() < 0.3, hue = round ? 0.27 + r() * 0.06 : 0.4 + r() * 0.07, n = round ? 2 + Math.floor(r() * 3) : 4 + Math.floor(r() * 6);
    for (let i = 0; i < n; i++) {
      const p = near(c, round ? 0.8 : 1.1);
      if (p.d < 0.25 || p.d > 1.7) continue;
      const col = new THREE.Color().setHSL(hue + (r() - 0.5) * 0.03, 0.34 + r() * 0.1, 0.6 + r() * 0.1);
      if (round) { const s = Math.min(0.3 + r() * 0.2, p.d * 0.6); put(rosettes, p.x, p.y - 0.03, p.z, s, s, s, col, 0.2); }
      else { const h = Math.min(0.45 + r() * 0.55, p.d * 0.85); put(ribbons, p.x, p.y - 0.04, p.z, h * 0.9, h, h * 0.9, col, 0.25); }
    }
  }
  // 조약돌: 걸어 들어가는 얕은 물가에는 두지 않고, 물속 몇 군데에 12~28개씩 소복이 모아 둔다(가운데가 빽빽하다)
  for (const c of spots(60, 9203, 0.45, 1.6)) {
    if (vnoise(c.x * 0.15 + 4.1, c.z * 0.15 + 2.3) < 0.35) continue;
    const n = 12 + Math.floor(r() * 17), light = 0.58 + r() * 0.16, hue = r() < 0.5 ? 0.09 + r() * 0.04 : 0.55 + r() * 0.08, spread = 0.5 + r() * 0.4;
    for (let i = 0; i < n; i++) {
      const p = i ? near(c, spread) : c, s = 0.05 + r() * r() * 0.1;
      if (p.d < 0.35) continue;
      const col = new THREE.Color().setHSL(hue, 0.06 + r() * 0.06, light + (r() - 0.5) * 0.08);
      put(pebbles, p.x, p.y + s * 0.15, p.z, s * (1 + r() * 0.4), s * (0.45 + r() * 0.2), s, col, 0.3);
    }
  }
  const pebble = new THREE.SphereGeometry(1, 7, 4).deleteAttribute("uv"); // 납작하게 늘려 쓰는 낮은 공(42삼각형)
  const plant = (key: string) => current(new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }), time, key);
  return [
    ...cells(root, ribbonGeometry(), plant("ribbon"), ribbons, SWAY),
    ...cells(root, rosetteGeometry(), plant("rosette"), rosettes, SWAY),
    ...cells(root, pebble, new THREE.MeshStandardMaterial({ roughness: 1 }), pebbles, 0),
  ];
}
