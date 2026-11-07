import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WATER_Y, WORLD, canWade, rng, terrainY } from "../terrain";

// ── 수면에 떠 있는 것: 개구리밥, 연잎, 연꽃 ──
// 돌려준 메시는 world.ts가 꽃처럼 가까운 칸만 그린다(그림자 없음)
// 움직임은 정점 셰이더에서만: 제자리에서 작은 원을 그리며 떠돌고(DRIFT m), 천천히 돌고(TURN 라디안), 살짝 오르내린다(BOB m)
const DRIFT = 0.12, TURN = 0.25, BOB = 0.003;
const TILE = 24; // 격자 칸(m). 칸마다 메시를 나눠 가까운 칸만 그린다
const PAD_SITES = 14, WEED_SITES = 10;

// 위상: 떠돌기는 이웃끼리 거의 같게(물살이 함께 미는 것처럼) 해 연잎끼리 겹치지 않게 하고, 돌기·오르내림은 저마다 다르게.
// 연꽃은 연잎 한가운데(같은 xz)에 앉으므로 연잎과 똑같이 움직인다
const FLOAT_GLSL = `
uniform float uFloatTime;
float floatHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832; }
mat2 floatTurn() {
  float a = ${TURN.toFixed(3)} * sin(uFloatTime * 0.11 + floatHash(instanceMatrix[3].xz));
  return mat2(cos(a), sin(a), -sin(a), cos(a));
}
`;
function floating<M extends THREE.Material>(mat: M, time: { value: number }, key: string) {
  mat.customProgramCacheKey = () => `float-${key}`;
  const prev = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (s, r) => {
    s.uniforms.uFloatTime = time;
    s.vertexShader = FLOAT_GLSL + s.vertexShader
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nobjectNormal.xz = floatTurn() * objectNormal.xz;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
      transformed.xz = floatTurn() * transformed.xz;
      vec2 fp = instanceMatrix[3].xz;
      float fph = dot(fp, vec2(0.37, 0.29));
      vec3 off = vec3(${DRIFT.toFixed(3)} * sin(uFloatTime * 0.13 + fph), ${BOB.toFixed(4)} * sin(uFloatTime * 0.9 + floatHash(fp.yx)), ${DRIFT.toFixed(3)} * sin(uFloatTime * 0.1 + fph * 1.7 + 1.0));
      mat3 fim = mat3(instanceMatrix); // 돌기와 고른 크기만 있으므로 역행렬은 전치 / 크기²
      transformed += transpose(fim) * off / dot(fim[0], fim[0]);`);
    prev(s, r);
  };
  return mat;
}

// 연꽃 꽃술(aCenter=1)만 노랗게. 뒷면도 앞면처럼 위를 향한 빛을 받게 한다
function withCenter<M extends THREE.Material>(mat: M) {
  mat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);");
    s.vertexShader = "attribute float aCenter;\nvarying float vCenter;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvCenter = aCenter;");
    s.fragmentShader = "varying float vCenter;\n" + s.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.84, 0.38), vCenter);");
  };
  return mat;
}

// 연잎: 한쪽이 쐐기 모양으로 갈라진 납작한 원. 반지름 1
function padGeometry() {
  const notch = 0.55;
  return new THREE.CircleGeometry(1, 20, notch / 2, Math.PI * 2 - notch).rotateX(-Math.PI / 2).deleteAttribute("uv");
}
// 연꽃: 바깥 꽃잎 6장은 비스듬히, 안쪽 5장은 더 세워 오므린 모양. 가운데 노란 꽃술. 지름 0.25m쯤
function lotusGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const ring = (n: number, len: number, w: number, lift: number, turn: number) => {
    for (let k = 0; k < n; k++) parts.push(new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2).scale(len, 1, w).translate(len * 0.9, 0, 0).rotateZ(lift).rotateY(turn + (k / n) * Math.PI * 2));
  };
  ring(6, 0.065, 0.032, 0.45, 0);
  ring(5, 0.05, 0.026, 0.95, 0.5);
  const heart = new THREE.CylinderGeometry(0.032, 0.026, 0.03, 6).translate(0, 0.018, 0);
  parts.push(heart);
  const g = mergeGeometries(parts.map((x) => x.deleteAttribute("uv")))!;
  const center = new Float32Array(g.attributes.position.count);
  center.fill(1, g.attributes.position.count - heart.attributes.position.count);
  g.setAttribute("aCenter", new THREE.BufferAttribute(center, 1));
  // 꽃잎이 기운 쪽마다 어둡게 보이지 않게 법선을 모두 위로 둔다(납작하게 빛을 받는다)
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}
// 개구리밥 한 무더기: 작은 동그라미 잎 수십 장을 몇 덩어리로 뭉쳐 하나로 합친다. 반지름 1쯤.
// 잎마다 밝기를 조금 달리하고(정점 색), 겹쳐도 깜빡이지 않게 높이를 아주 조금씩 다르게 둔다
function duckweedGeometry() {
  const r = rng(7301), parts: THREE.BufferGeometry[] = [];
  const clumps = [...Array(4)].map(() => [(r() - 0.5) * 0.9, (r() - 0.5) * 0.9, 0.35 + r() * 0.3]);
  for (let i = 0; i < 120; i++) {
    const [cx, cz, cr] = clumps[i % clumps.length], a = r() * Math.PI * 2, d = Math.sqrt(r()) * cr;
    const s = 0.04 + r() * 0.03, light = 0.9 + r() * 0.2;
    const leaf = new THREE.CircleGeometry(1, 5).rotateX(-Math.PI / 2).scale(s, 1, s * (0.8 + r() * 0.2)).rotateY(r() * 6).translate(cx + Math.cos(a) * d, i * 0.00004, cz + Math.sin(a) * d).deleteAttribute("uv");
    leaf.setAttribute("color", new THREE.Float32BufferAttribute(new Array(leaf.attributes.position.count * 3).fill(light), 3));
    parts.push(leaf);
  }
  return mergeGeometries(parts)!;
}

// 떠 있을 자리: 가운데와 둘레 rad m가 모두 잔잔한 물(깊이 0.3~2.2m)이고 걸어 들어갈 수 있는 얕은 물이 아니다.
// 돌다리와 둑은 수면 위로 솟아 있으므로 걸러진다
const depth = (x: number, z: number) => WATER_Y - terrainY(x, z);
function calm(x: number, z: number, rad: number, max = 2.2) {
  const ok = (px: number, pz: number) => { const d = depth(px, pz); return d >= 0.3 && d <= max; };
  if (!ok(x, z) || canWade(x, z)) return false;
  for (let i = 0; i < 8; i++) if (!ok(x + Math.cos(i * Math.PI / 4) * rad, z + Math.sin(i * Math.PI / 4) * rad)) return false;
  return true;
}

type Inst = { x: number; z: number; m: THREE.Matrix4; c: THREE.Color };

// 같은 모양을 격자 칸마다 인스턴스 메시 하나로 묶는다
function cells(root: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[]) {
  const by = new Map<string, Inst[]>();
  for (const it of items) {
    const k = `${Math.floor(it.x / TILE)},${Math.floor(it.z / TILE)}`;
    by.set(k, [...(by.get(k) ?? []), it]);
  }
  return [...by.values()].map((cell) => {
    const m = new THREE.InstancedMesh(geo, mat, cell.length);
    cell.forEach((it, i) => { m.setMatrixAt(i, it.m); m.setColorAt(i, it.c); });
    m.castShadow = false;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    m.boundingSphere!.radius += DRIFT * 1.5 + 0.1; // 떠도는 만큼
    root.add(m);
    return m;
  });
}

export function buildFloaters(root: THREE.Object3D, time: { value: number }): THREE.InstancedMesh[] {
  const r = rng(9157), pads: Inst[] = [], lotus: Inst[] = [], weeds: Inst[] = [];
  const at = (x: number, y: number, z: number, yaw: number, s: number) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
  const sites: { x: number; z: number }[] = [];
  const pick = (count: number, rad: number, max: number, gap: number) => {
    const out: { x: number; z: number }[] = [];
    for (let k = 0; k < 3000 && out.length < count; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (WORLD - 6), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (sites.some((p) => Math.hypot(p.x - x, p.z - z) < gap) || !calm(x, z, rad, max)) continue;
      sites.push({ x, z });
      out.push({ x, z });
    }
    return out;
  };
  const weed = (x: number, z: number) => {
    const s = 0.35 + r() * 0.35, c = new THREE.Color().setHSL(0.25 + r() * 0.04, 0.6 + r() * 0.15, 0.47 + r() * 0.06);
    weeds.push({ x, z, m: at(x, WATER_Y + 0.01, z, r() * Math.PI * 2, s), c });
  };

  // 연잎 무리: 3~8장이 서로 겹치지 않게 모이고, 큰 잎 몇 장에 연꽃이 핀다. 둘레에 개구리밥도 조금
  for (const site of pick(PAD_SITES, 1.8, 2.2, 16)) {
    const n = 3 + Math.floor(r() * 6), mine: { x: number; z: number; s: number }[] = [];
    const hue = 0.27 + r() * 0.05;
    for (let k = 0; k < 60 && mine.length < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 1.4, x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
      const s = 0.12 + r() * 0.18; // 반지름: 지름 0.25~0.6m
      if (mine.some((p) => Math.hypot(p.x - x, p.z - z) < p.s + s + 0.06) || !calm(x, z, s + 0.4)) continue;
      mine.push({ x, z, s });
      // 잎마다 높이를 조금씩 달리해 떠돌다 겹쳐도 깜빡이지 않게 한다
      const c = new THREE.Color().setHSL(hue + (r() - 0.5) * 0.04, 0.42 + r() * 0.1, 0.36 + r() * 0.07);
      pads.push({ x, z, m: at(x, WATER_Y + 0.014 + mine.length * 0.0015, z, r() * Math.PI * 2, s), c });
    }
    const big = [...mine].sort((a, b) => b.s - a.s), blooms = r() < 0.7 ? 1 + Math.floor(r() * 2) : 0;
    for (const p of big.slice(0, blooms)) {
      if (p.s < 0.17) continue;
      const pink = r() < 0.65;
      const c = new THREE.Color().setHSL(pink ? 0.95 + r() * 0.03 : 0.1, pink ? 0.85 : 0.6, pink ? 0.76 + r() * 0.04 : 0.93);
      lotus.push({ x: p.x, z: p.z, m: at(p.x, WATER_Y + 0.03, p.z, r() * Math.PI * 2, 1.3 + r() * 0.3), c });
    }
    for (let k = 0, w = 1 + Math.floor(r() * 3); k < w; k++) {
      const a = r() * Math.PI * 2, d = 0.8 + r() * 1.4, x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
      if (calm(x, z, 0.9)) weed(x, z);
    }
  }
  // 개구리밥 터: 물가 가까운 잔잔한 얕은 물(깊이 0.3~1.3m)에 무더기 2~5개
  for (const site of pick(WEED_SITES, 0.7, 1.3, 12)) {
    for (let k = 0, w = 2 + Math.floor(r() * 4); k < w; k++) {
      const a = r() * Math.PI * 2, d = k ? 0.5 + r() * 1.2 : 0, x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
      if (calm(x, z, 0.9)) weed(x, z);
    }
  }

  const mat = (extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide, ...extra });
  return [
    ...cells(root, duckweedGeometry(), floating(mat({ vertexColors: true }), time, "weed"), weeds),
    ...cells(root, padGeometry(), floating(mat(), time, "pad"), pads),
    ...cells(root, lotusGeometry(), floating(withCenter(mat()), time, "lotus"), lotus),
  ];
}
