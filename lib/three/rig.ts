import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ── 말랑이 팔다리: 뼈 3개(뿌리·관절·끝)로 휘는 고무관. 네 팔다리와 손발을 SkinnedMesh 하나로 그린다 ──
// 뼈는 계층 없이 모두 메시의 자식이다. IK가 캐릭터 공간에서 각 뼈의 위치·방향을 직접 정하므로 상속 문제(늘일 때 손이 찌그러짐)가 없다.
// 쉴 때 자세: 각 팔다리의 뿌리 뼈는 원점, 관절 뼈는 (0,a,0), 끝 뼈는 (0,a+b,0)이고 회전은 없다. 관은 +y로 뻗는다

export type Limb = { up: THREE.Bone; low: THREE.Bone; end: THREE.Bone; a: number; b: number };
export type Rig = { mesh: THREE.SkinnedMesh; arms: [Limb, Limb]; legs: [Limb, Limb] };
export type LimbSpec = { a: number; b: number; r: number; tip: THREE.BufferGeometry | null };

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// 지오메트리의 모든 정점을 한 뼈에 붙이고 색을 칠한다
function paint(geo: THREE.BufferGeometry, color: THREE.Color, bone: number) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
    si[i * 4] = bone; sw[i * 4] = 1;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  return geo;
}

// 관: 캡슐을 [0, a+b]에 놓고 관절 부근(±blend)에서 위·아래 뼈 가중치를 부드럽게 섞어 둥글게 휘게 한다
function tube(s: LimbSpec, color: THREE.Color, base: number) {
  const L = s.a + s.b;
  const geo = new THREE.CapsuleGeometry(s.r, L, 4, 10, 16);
  geo.translate(0, L / 2, 0);
  paint(geo, color, base);
  const pos = geo.attributes.position, si = geo.attributes.skinIndex as THREE.BufferAttribute, sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  const w = Math.min(s.a, s.b) * 0.6;
  for (let i = 0; i < pos.count; i++) {
    const k = smooth(s.a - w, s.a + w, pos.getY(i));
    si.setXY(i, base, base + 1);
    sw.setXY(i, 1 - k, k);
  }
  return geo;
}

// 손: 손 공간에서 +y가 손목 → 손끝, +x가 손등. side는 엄지가 붙는 쪽(-z면 1, +z면 -1)
export function handGeometry(handS: number, side: number) {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx: number, rz: number, sx: number, sy: number, sz: number) => {
    m.compose(v.set(x, y, z).multiplyScalar(handS), q.setFromEuler(e.set(rx, 0, rz)), sc.set(sx, sy, sz).multiplyScalar(handS));
    parts.push(g.applyMatrix4(m));
  };
  add(new THREE.SphereGeometry(0.075, 12, 10), 0, 0.045, 0, 0, 0, 0.62, 1.05, 1);
  for (let i = -1; i <= 1; i++) add(new THREE.SphereGeometry(0.03, 8, 6), -0.012, 0.12 - Math.abs(i) * 0.012, i * 0.038, 0, 0.35, 0.9, 1.5, 0.9);
  add(new THREE.SphereGeometry(0.03, 8, 6), -0.02, 0.035, -side * 0.078, -side * 0.7, 0, 0.9, 1.45, 0.9);
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

// 발: 발목에서 앞(+z)으로 조금 나온 납작한 공
export function footGeometry(r: number) {
  const g = new THREE.SphereGeometry(r, 10, 8);
  g.scale(1, 0.8, 1.3);
  g.translate(0, 0, 0.05);
  return g;
}

// limbs: [오른팔, 왼팔, 오른다리, 왼다리]. tip은 끝 뼈에 붙는 손/발(끝 뼈 공간 기준), tipColor로 칠한다
export function buildRig(limbs: LimbSpec[], color: THREE.Color, tipColor: THREE.Color[], bound: THREE.Sphere): Rig {
  const geos: THREE.BufferGeometry[] = [];
  const bones: THREE.Bone[] = [];
  const out: Limb[] = limbs.map((s, j) => {
    const up = new THREE.Bone(), low = new THREE.Bone(), end = new THREE.Bone();
    low.position.set(0, s.a, 0);
    end.position.set(0, s.a + s.b, 0);
    bones.push(up, low, end);
    geos.push(tube(s, color, j * 3));
    if (s.tip) geos.push(paint(s.tip.translate(0, s.a + s.b, 0), tipColor[j], j * 3 + 2));
    return { up, low, end, a: s.a, b: s.b };
  });
  const geo = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 }));
  for (const b of bones) mesh.add(b);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  // 자세마다 다시 계산하지 않도록 캐릭터 전체를 덮는 구를 고정해 둔다
  mesh.boundingSphere = bound;
  return { mesh, arms: [out[0], out[1]], legs: [out[2], out[3]] };
}

// ── 두 뼈 IK ──
const _d = new THREE.Vector3(), _n = new THREE.Vector3(), _h = new THREE.Vector3(), _e = new THREE.Vector3(), _w = new THREE.Vector3();
const _u = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();

function place(bone: THREE.Bone, at: THREE.Vector3, y: THREE.Vector3, x: THREE.Vector3, k: number) {
  _z.crossVectors(x, y);
  bone.position.copy(at);
  bone.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, _z));
  bone.scale.set(1, k, 1);
}

// root(어깨/엉덩이)에서 target(손목/발목)으로. pole은 관절(팔꿈치/무릎)이 향할 방향. 모두 캐릭터 공간.
// 닿지 않으면 maxStretch배까지 늘이고, 그래도 모자라면 target 쪽으로 곧게 뻗는다
export function solve(l: Limb, root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, maxStretch = 1.25) {
  _d.subVectors(target, root);
  let d = _d.length();
  if (d < 1e-5) { _d.set(0, -1, 0); d = 1e-5; } else _d.divideScalar(d);
  const reach = (l.a + l.b) * 0.995;
  const k = d > reach ? Math.min(d / reach, maxStretch) : 1;
  const A = l.a * k, B = l.b * k;
  const dd = Math.min(Math.max(d, Math.abs(A - B) + 1e-4), (A + B) * 0.995);
  const cosA = (A * A + dd * dd - B * B) / (2 * A * dd), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _n.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_n.lengthSq() < 1e-8) { // pole이 뻗는 방향과 겹치면 아무 수직 방향
    _n.set(0, 0, 1);
    if (Math.abs(_d.z) > 0.9) _n.set(1, 0, 0);
    _n.addScaledVector(_d, -_n.dot(_d));
  }
  _n.normalize();
  _h.crossVectors(_d, _n).normalize(); // 굽힘 축. 위·아래 뼈가 같은 축을 써서 관절이 비틀리지 않는다
  _e.copy(root).addScaledVector(_d, A * cosA).addScaledVector(_n, A * sinA);
  _w.copy(root).addScaledVector(_d, dd);
  place(l.up, root, _u.subVectors(_e, root).divideScalar(A), _h, k);
  place(l.low, _e, _u.subVectors(_w, _e).divideScalar(B), _h, k);
  l.end.position.copy(_w);
}

// 손 방향: f = 손끝, o = 손등. 캐릭터 공간
export function orientHand(l: Limb, f: THREE.Vector3, o: THREE.Vector3) {
  _u.copy(f).normalize();
  _n.copy(o).addScaledVector(_u, -o.dot(_u));
  if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0).addScaledVector(_u, -_u.x);
  _n.normalize();
  _z.crossVectors(_n, _u);
  l.end.quaternion.setFromRotationMatrix(_m.makeBasis(_n, _u, _z));
}

// 발 방향: 앞(+z)을 보고 pitch만큼 발끝을 내린다(+면 발끝이 아래)
export function orientFoot(l: Limb, pitch: number) {
  l.end.quaternion.set(Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2));
}

// ── 몸통 단면: 높이·방향별로 축에서 겉면까지의 수평 거리. 손이 몸에 묻히지 않게 밀어내는 데 쓴다 ──
const NA = 12, NY = 10;
export type Profile = { R: Float32Array; H: number };

export function bodyProfile(body: THREE.Mesh, H: number, baseY: number): Profile {
  const R = new Float32Array(NA * NY), rc = new THREE.Raycaster(), o = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let j = 0; j < NY; j++) {
    const y = baseY + (H * (j + 0.5)) / NY;
    for (let i = 0; i < NA; i++) {
      const t = (i / NA) * Math.PI * 2;
      o.set(Math.sin(t) * 5, y, Math.cos(t) * 5);
      dir.set(-Math.sin(t), 0, -Math.cos(t));
      rc.set(o, dir);
      const h = rc.intersectObject(body, false)[0];
      R[j * NA + i] = h ? Math.hypot(h.point.x, h.point.z) : 0;
    }
  }
  return { R, H };
}

// 몸 높이 y(몸 공간), 방향 각 t(+z가 0, +x가 π/2)에서의 반지름
export function radiusAt(p: Profile, y: number, t: number) {
  const fy = (y / p.H) * NY - 0.5;
  if (fy < -0.5 || fy > NY - 0.5) return 0;
  const j0 = Math.max(0, Math.min(NY - 1, Math.floor(fy))), j1 = Math.min(NY - 1, j0 + 1), ty = Math.max(0, Math.min(1, fy - j0));
  let fa = (t / (Math.PI * 2)) * NA;
  fa = ((fa % NA) + NA) % NA;
  const i0 = Math.floor(fa) % NA, i1 = (i0 + 1) % NA, ta = fa - Math.floor(fa);
  const r0 = p.R[j0 * NA + i0] * (1 - ta) + p.R[j0 * NA + i1] * ta;
  const r1 = p.R[j1 * NA + i0] * (1 - ta) + p.R[j1 * NA + i1] * ta;
  return r0 * (1 - ty) + r1 * ty;
}

// 몸 공간의 점을 겉면에서 clear만큼 바깥으로 밀어낸다(수평으로)
export function pushOut(p: Profile, v: THREE.Vector3, clear: number) {
  const r = Math.hypot(v.x, v.z), R = radiusAt(p, v.y, Math.atan2(v.x, v.z)) + clear;
  if (R <= clear || r >= R) return v;
  if (r < 1e-4) { v.z = R; return v; }
  return v.set((v.x / r) * R, v.y, (v.z / r) * R);
}
