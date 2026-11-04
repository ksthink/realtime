import * as THREE from "three";
import { lerp, rng } from "../terrain";

// ── 몸통: 구 위상을 공유하는 정점. 네트워크로는 고유 정점만 int16으로 보낸다 (약 6.5KB) ──
const DETAIL = 8;
type Topology = { gid: Int32Array; members: number[][]; neighbors: Set<number>[]; count: number };
let topo: Topology | null = null;

function topology(): Topology {
  if (topo) return topo;
  const pos = new THREE.IcosahedronGeometry(1, DETAIL).attributes.position;
  const ids = new Map<string, number>();
  const gid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    gid[i] = ids.get(k)!;
  }
  const members: number[][] = Array.from({ length: ids.size }, () => []);
  const neighbors: Set<number>[] = Array.from({ length: ids.size }, () => new Set());
  for (let i = 0; i < pos.count; i++) members[gid[i]].push(i);
  for (let i = 0; i < pos.count; i += 3) {
    const [a, b, c] = [gid[i], gid[i + 1], gid[i + 2]];
    neighbors[a].add(b).add(c); neighbors[b].add(a).add(c); neighbors[c].add(a).add(b);
  }
  return (topo = { gid, members, neighbors, count: pos.count });
}

export const sculptTopology = topology;
export const createBodyGeometry = () => new THREE.IcosahedronGeometry(1, DETAIL);

// 같은 위치 정점끼리 법선을 평균 → 각지지 않고 매끈하게
export function smoothNormals(geo: THREE.BufferGeometry) {
  const { gid, members, count } = topology();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const acc = new Float32Array(members.length * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.sub(b));
    for (const j of [i, i + 1, i + 2]) { const g = gid[j]; acc[g * 3] += n.x; acc[g * 3 + 1] += n.y; acc[g * 3 + 2] += n.z; }
  }
  members.forEach((m, g) => {
    n.set(acc[g * 3], acc[g * 3 + 1], acc[g * 3 + 2]).normalize();
    for (const i of m) nor.setXYZ(i, n.x, n.y, n.z);
  });
  nor.needsUpdate = true;
}

const Q = 32767 / 2.5; // ±2.5 범위를 int16으로
export function encodeBody(geo: THREE.BufferGeometry): string {
  const { members } = topology();
  const pos = geo.attributes.position;
  const out = new Int16Array(members.length * 3);
  members.forEach((m, g) => {
    out[g * 3] = Math.round(pos.getX(m[0]) * Q);
    out[g * 3 + 1] = Math.round(pos.getY(m[0]) * Q);
    out[g * 3 + 2] = Math.round(pos.getZ(m[0]) * Q);
  });
  let s = "";
  new Uint8Array(out.buffer).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
export function decodeBody(data: string): THREE.BufferGeometry {
  const { members } = topology();
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const src = new Int16Array(bytes.buffer);
  const geo = createBodyGeometry();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  members.forEach((m, g) => {
    for (const i of m) pos.setXYZ(i, src[g * 3] / Q, src[g * 3 + 1] / Q, src[g * 3 + 2] / Q);
  });
  smoothNormals(geo);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function colorize(geo: THREE.BufferGeometry, bottom: THREE.Color, top: THREE.Color) {
  geo.computeBoundingBox();
  const y0 = geo.boundingBox!.min.y, H = geo.boundingBox!.max.y - y0 || 1;
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(bottom).lerp(top, Math.pow((pos.getY(i) - y0) / H, 1.3));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

export function randomPalette(r: () => number) {
  return {
    top: new THREE.Color().setHSL(r(), 0.65, 0.72),
    bottom: new THREE.Color().setHSL(r(), 0.7, 0.68),
  };
}

// ── 캐릭터 ──
function makeTube(points: number[][], radius: number, color: THREE.Color) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, radius, 8, false), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  m.castShadow = true;
  return m;
}

function nameSprite(name: string, font: string) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext("2d")!;
  ctx.font = `600 30px ${font}`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,.85)";
  const w = ctx.measureText(name).width + 28;
  ctx.beginPath(); ctx.roundRect(128 - w / 2, 10, w, 44, 22); ctx.fill();
  ctx.fillStyle = "#4a3f52";
  ctx.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false, toneMapped: false }));
  sp.scale.set(1.6, 0.4, 1);
  sp.renderOrder = 5;
  return sp;
}

export type Blob = {
  g: THREE.Group; body: THREE.Mesh; mouth: THREE.Mesh;
  legs: THREE.Group[]; arms: THREE.Group[]; prayArms: THREE.Group;
  yaw: number; state: "idle" | "pickup" | "place" | "pray"; stateT: number;
  carrying: boolean; walk: number; bob: number; baseY: number; prayK: number;
  holdPoint: THREE.Vector3;
};

export type BlobInit = { seed: number; name: string; top: string; bottom: string; body: string };

export function makeBlob(init: BlobInit, font: string): Blob {
  const r = rng(init.seed);
  const top = new THREE.Color(init.top), bottom = new THREE.Color(init.bottom);
  const limb = bottom.clone().lerp(new THREE.Color("#ffffff"), 0.1);
  const g = new THREE.Group();
  const geo = decodeBody(init.body);
  colorize(geo, bottom, top);
  const H = geo.boundingBox!.max.y, W = geo.boundingBox!.max.x - geo.boundingBox!.min.x;
  const legLen = 0.45 + r() * 0.3;
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  body.castShadow = true;
  body.position.y = legLen;
  g.add(body);
  g.updateMatrixWorld(true);

  const rc = new THREE.Raycaster();
  const hit = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => {
    rc.set(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(dx, dy, dz).normalize());
    return rc.intersectObject(body, false)[0];
  };

  // 얼굴: 앞(+z)에서 광선을 쏴 표면에 붙인다
  const face = new THREE.Group();
  body.add(face);
  const dark = new THREE.MeshStandardMaterial({ color: "#3a2f3f", roughness: 0.6 });
  const attach = (mesh: THREE.Mesh, h: THREE.Intersection | undefined, lift: number) => {
    if (!h?.face) return false;
    mesh.position.copy(h.point).sub(body.position).addScaledVector(h.face.normal, lift);
    face.add(mesh);
    mesh.lookAt(h.point.clone().add(h.face.normal));
    return true;
  };
  const eyeY = legLen + H * (0.68 + r() * 0.1), eyeX = 0.08 + r() * 0.08, eyeR = 0.028 + r() * 0.022;
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 10, 8), dark);
    const h = hit(s * eyeX, eyeY, 5, 0, 0, -1) || hit(0, eyeY, 5, 0, 0, -1);
    if (attach(e, h, 0.005) && Math.abs(e.position.x) < 0.02) e.position.x = s * eyeX * 0.6;
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025 + r() * 0.03, 10, 8), new THREE.MeshStandardMaterial({ color: "#e98c9c", roughness: 0.9 }));
  attach(nose, hit(0, legLen + H * (0.6 + r() * 0.06), 5, 0, 0, -1), 0.015);
  const mouthKind = Math.floor(r() * 3);
  const mouth = new THREE.Mesh(
    mouthKind === 0 ? new THREE.TorusGeometry(0.04 + r() * 0.03, 0.02, 8, 16)
      : mouthKind === 1 ? new THREE.TorusGeometry(0.07, 0.018, 8, 16, Math.PI)
        : new THREE.SphereGeometry(0.03, 8, 6),
    dark,
  );
  attach(mouth, hit(0, legLen + H * (0.5 + r() * 0.08), 5, 0, 0, -1), 0.01);
  if (mouthKind === 1) mouth.rotateZ(Math.PI);

  // 다리: 아래에서 위로 쏴서 바닥면을 찾는다
  const legs: THREE.Group[] = [];
  const legX = Math.min(W * 0.3, 0.14 + r() * 0.12);
  for (const s of [-1, 1]) {
    const h = hit(s * legX, -1, 0, 0, 1, 0) || hit(0, -1, 0, 0, 1, 0);
    const px = h ? h.point.x : s * legX, py = h ? h.point.y : legLen, pz = h ? h.point.z : 0;
    const p = new THREE.Group();
    p.position.set(px, py + 0.04, pz);
    const L = py + 0.04;
    const t = makeTube([[0, 0, 0], [s * 0.02, -L * 0.5, 0.02], [0, -L, 0]], 0.055 + r() * 0.02, limb);
    p.add(t);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.075 + r() * 0.03, 10, 8), t.material);
    foot.position.set(0, -L, 0.05);
    foot.scale.set(1, 0.8, 1.3);
    p.add(foot);
    g.add(p);
    legs.push(p);
  }

  // 팔: 옆에서 안쪽으로 쏴서 어깨를 찾는다. 합장은 어깨에서 가슴 앞으로 굽힌 별도의 팔을 켜서 표현한다
  const arms: THREE.Group[] = [];
  const prayArms = new THREE.Group();
  prayArms.visible = false;
  g.add(prayArms);
  const armY = legLen + H * (0.52 + r() * 0.16), armL = 0.8 + r() * 0.5, handS = 0.8 + r() * 0.5;
  const chest = hit(0, armY + 0.05, 5, 0, 0, -1);
  const prayAt = new THREE.Vector3(0, armY + 0.12, (chest ? chest.point.z : W * 0.45) + 0.2);
  for (const s of [-1, 1]) {
    const h = hit(s * 5, armY, 0.05, -s, 0, 0);
    const p = new THREE.Group();
    if (h?.face) p.position.copy(h.point).addScaledVector(h.face.normal, -0.02);
    else p.position.set(s * W * 0.45, armY, 0.05);
    p.add(makeTube([[0, 0, 0], [s * 0.14 * armL, -0.05, 0.06], [s * 0.24 * armL, -0.18, 0.1]], 0.045, limb));
    const skin = new THREE.MeshStandardMaterial({ color: limb.clone().lerp(new THREE.Color("#ffe3d2"), 0.55), roughness: 0.9 });
    const hand = new THREE.Group();
    const tip = new THREE.Vector3(s * 0.26 * armL, -0.2, 0.11);
    hand.position.copy(tip);
    hand.rotation.z = s * 0.5;
    hand.scale.setScalar(handS);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), skin);
    palm.scale.set(1, 1.15, 0.6);
    palm.castShadow = true;
    hand.add(palm);
    for (let i = -1; i <= 1; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), skin);
      f.position.set(s * (0.055 + i * 0.02), 0.095 - Math.abs(i) * 0.02, i * 0.045);
      f.scale.set(1, 1.6, 1);
      hand.add(f);
    }
    p.add(hand);
    g.add(p);
    arms.push(p);

    // 합장 팔: 어깨 → 팔꿈치(바깥 아래) → 가슴 앞. 손바닥은 세워서 가운데에서 맞댄다
    const sx = p.position.x, sy = p.position.y, sz = p.position.z;
    const handAt = new THREE.Vector3(s * 0.05, prayAt.y, prayAt.z);
    prayArms.add(makeTube([[sx, sy, sz], [lerp(sx, handAt.x, 0.35) + s * 0.08, sy - 0.14, lerp(sz, handAt.z, 0.6)], [handAt.x + s * 0.04, handAt.y - 0.12, handAt.z]], 0.045, limb));
    const prayHand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), skin);
    prayHand.position.copy(handAt);
    prayHand.scale.set(0.42, 1.55, 0.95);
    prayHand.rotation.x = -0.12;
    prayHand.castShadow = true;
    prayArms.add(prayHand);
  }

  const label = nameSprite(init.name, font);
  label.position.y = legLen + H + 0.85;
  g.add(label);

  return {
    g, body, mouth, legs, arms, prayArms,
    yaw: 0, state: "idle", stateT: 0, carrying: false, walk: 0, bob: 0, baseY: 0, prayK: 0,
    holdPoint: new THREE.Vector3(0, legLen + H + 0.25, 0.05),
  };
}

export function animateBlob(ch: Blob, dt: number, moving: boolean) {
  ch.walk = moving ? ch.walk + dt * 9 : lerp(ch.walk, Math.round(ch.walk / Math.PI) * Math.PI, 0.2);
  const sw = moving ? 0.6 : 0.6 * Math.abs(Math.sin(ch.walk)) * 0.2;
  ch.legs[0].rotation.x = Math.sin(ch.walk) * sw;
  ch.legs[1].rotation.x = -Math.sin(ch.walk) * sw;
  ch.bob += dt;
  const breathe = Math.sin(ch.bob * 2.2) * 0.012;
  ch.body.scale.set(1 + breathe, 1 - breathe, 1 + breathe);
  ch.g.position.y = ch.baseY + (moving ? Math.abs(Math.sin(ch.walk)) * 0.06 : 0);
  ch.stateT += dt;

  const carry = ch.carrying;
  let armZ = carry ? 2.3 : moving ? -0.1 + Math.sin(ch.walk) * 0.2 : -0.15;
  let armX = carry ? -0.3 : moving ? Math.sin(ch.walk) * 0.4 : 0;
  let crouch = 0;
  if (ch.state === "pickup") {
    const k = Math.sin(Math.min(1, ch.stateT / 0.45) * Math.PI);
    crouch = k * 0.28; armZ = -0.15 + 0.6 * k; armX = 1.1 * k;
  }
  if (ch.state === "place") {
    const k = Math.sin(Math.min(1, ch.stateT / 0.5) * Math.PI);
    armZ = 2.3 - 1.6 * k; armX = -0.3 - 0.9 * k;
  }
  ch.arms[0].rotation.set(armX, 0, -armZ);
  ch.arms[1].rotation.set(armX, 0, armZ);

  // 합장: 손을 가슴 앞에 모으고 살짝 고개를 숙인다
  ch.prayK = lerp(ch.prayK, ch.state === "pray" ? 1 : 0, Math.min(1, dt * 7));
  const praying = ch.prayK > 0.3;
  ch.prayArms.visible = praying;
  ch.arms[0].visible = ch.arms[1].visible = !praying;
  ch.body.rotation.x = 0.14 * ch.prayK;

  ch.body.scale.y *= 1 - crouch;
  ch.g.position.y -= crouch * 0.15;
  ch.mouth.scale.set(1, carry ? 0.45 : ch.state === "pickup" ? 1.3 : 1, 1);
  ch.g.rotation.y = ch.yaw;
}
