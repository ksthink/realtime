import * as THREE from "three";
import { lerp, rng } from "../terrain";
import { type Dims, type Pose, handPose, idlePose, makePose, prayPose, reactionPose, walkPose } from "./motions";
import { type Rig, bodyProfile, buildRig, footGeometry, handGeometry, orientFoot, orientHand, pushOut, solve } from "./rig";

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

export const REACTIONS = ["rest", "wave", "joy", "sad"] as const;
export type Reaction = (typeof REACTIONS)[number];
// 자동 종료까지 걸리는 초. rest는 사용자가 움직일 때까지 계속되므로 Infinity
export const REACTION_SECONDS: Record<Reaction, number> = { rest: Infinity, wave: 2.4, joy: 1.8, sad: 3 };

// 가만히 서 있을 때 가끔 하는 행동. 여기서 도는 애니메이션이라 다른 접속자에게 전송하지 않는다
const IDLE_ACTIONS = { swing: 2.4, look: 3.2, stretch: 2.4, sway: 3 }; // 행동별 길이(초)
type IdleAction = keyof typeof IDLE_ACTIONS;
const idleKinds = Object.keys(IDLE_ACTIONS) as IdleAction[];
const nextIdleWait = () => 4 + Math.random() * 6; // 행동 사이의 쉬는 시간(초)

export type Blob = {
  g: THREE.Group; body: THREE.Mesh; mouth: THREE.Mesh;
  rig: Rig; dims: Dims; pose: Pose;
  yaw: number; state: "idle" | "pickup" | "place" | "pray" | Reaction; stateT: number;
  carrying: boolean; walk: number; bob: number; baseY: number; prayK: number;
  moveK: number; carryK: number; bodyRy: number;
  restK: number; waveK: number; joyK: number; sadK: number; joyH: number; sitDrop: number;
  // 들고 있는 돌의 바닥 가운데(캐릭터 공간, 매 프레임 머리를 따라간다)와 돌 크기(game이 채운다)
  holdPoint: THREE.Vector3; holdR: number; holdH: number;
  idleWait: number; idleKind: IdleAction; idleOn: boolean; idleT: number; idleK: number; idleArm: 0 | 1;
};

export type BlobInit = { seed: number; name: string; top: string; bottom: string; body: string };

const SHOULDER_FWD = 0.5; // 어깨가 옆에서 앞으로 돌아간 각(라디안)

export function makeBlob(init: BlobInit, font: string): Blob {
  const r = rng(init.seed);
  const top = new THREE.Color(init.top), bottom = new THREE.Color(init.bottom);
  const limb = bottom.clone().lerp(new THREE.Color("#ffffff"), 0.1);
  const skin = limb.clone().lerp(new THREE.Color("#ffe3d2"), 0.55);
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

  const profile = bodyProfile(body, H, legLen);

  // 엉덩이: 아래에서 위로 쏴서 바닥면을 찾고 조금 안쪽에 둔다(몸 공간)
  const legX = Math.min(W * 0.3, 0.14 + r() * 0.12);
  const hip: THREE.Vector3[] = [], legR: number[] = [], footR: number[] = [];
  for (const s of [-1, 1]) {
    const h = hit(s * legX, -1, 0, 0, 1, 0) || hit(0, -1, 0, 0, 1, 0);
    hip.push(new THREE.Vector3(h ? h.point.x : s * legX, (h ? h.point.y : legLen) - legLen + 0.04, h ? h.point.z : 0));
    legR.push(0.055 + r() * 0.02);
    footR.push(0.075 + r() * 0.03);
  }
  const footY = (footR[0] + footR[1]) / 2 * 0.8 * 0.55; // 발이 땅에 살짝만 묻히게
  // 서 있을 때 무릎이 아주 조금 굽도록 다리를 엉덩이~발목보다 3% 길게
  const legLength = (legLen + Math.min(hip[0].y, hip[1].y) - footY) / 0.97;

  // 어깨: 옆에서 안쪽으로 쏴서 찾고 겉면보다 조금 안에 둔다(몸 공간)
  const armY = legLen + H * (0.52 + r() * 0.16), armL = 0.8 + r() * 0.5, handS = 0.8 + r() * 0.5;
  const armLen = 0.45 * armL + 0.28;
  const palm = 0.045 * handS, palmT = 0.0465 * handS;
  const shoulder: THREE.Vector3[] = [], hang: THREE.Vector3[] = [], cover: THREE.Vector3[] = [];
  const coverY = eyeY; // 눈을 가린다
  for (const s of [-1, 1]) {
    // 옆에서 앞쪽으로 SHOULDER_FWD만큼 돌린 방향에 붙인다. 손이 가슴·얼굴 앞으로 올 때 팔이 둥근 몸을 덜 파고든다
    const sa = Math.sin(SHOULDER_FWD), ca = Math.cos(SHOULDER_FWD);
    const h = hit(s * ca * 5, armY, sa * 5, -s * ca, 0, -sa);
    const p = h?.face ? h.point.clone().addScaledVector(h.face.normal, -0.03) : new THREE.Vector3(s * W * 0.45 * ca, armY, W * 0.45 * sa);
    p.y -= legLen;
    shoulder.push(p);
    // 차렷 손: 어깨에서 아래·조금 밖·조금 앞으로 거의 다 뻗은 자리(팔꿈치는 아주 살짝만 굽는다). 몸에 묻히면 밖으로 밀고 다시 맞춘다
    const reach = armLen * 0.97 + palm, hv = new THREE.Vector3(s * 0.3, -1, 0.15).normalize().multiplyScalar(reach).add(p);
    for (let k = 0; k < 3; k++) pushOut(profile, hv, palmT + 0.03).sub(p).setLength(reach).add(p);
    hang.push(hv);
    // 얼굴 가리기: 손이 닿는 범위의 가장 앞쪽 표면보다 띄워서 묻히지 않게 한다
    const coverX = s * (eyeX + 0.03);
    let front = -Infinity;
    for (const dx of [-0.11, 0, 0.11]) for (const dy of [-0.1, 0, 0.16]) {
      const f = hit(coverX + dx * handS, coverY + dy * handS, 5, 0, 0, -1);
      if (f) front = Math.max(front, f.point.z);
    }
    cover.push(new THREE.Vector3(coverX, coverY - legLen, (front > -Infinity ? front : W * 0.45) + palmT + 0.04));
  }
  // 합장: 얼굴(몸통 높이의 50~78%)을 가리지 않도록 그 아래 가슴 앞
  const prayY = legLen + H * 0.34;
  const chestHit = hit(0, prayY, 5, 0, 0, -1);
  const chest = new THREE.Vector3(0, prayY - legLen, (chestHit ? chestHit.point.z : W * 0.45) + palmT + 0.12);
  const topHit = hit(0, 5, 0.05, 0, -1, 0);
  const headTop = new THREE.Vector3(0, (topHit ? topHit.point.y : legLen + H) - legLen + 0.02, 0.05);

  const rig = buildRig(
    [
      { a: armLen / 2, b: armLen / 2, r: 0.045, tip: handGeometry(handS, -1) },
      { a: armLen / 2, b: armLen / 2, r: 0.045, tip: handGeometry(handS, 1) },
      { a: legLength / 2, b: legLength / 2, r: legR[0], tip: footGeometry(footR[0]) },
      { a: legLength / 2, b: legLength / 2, r: legR[1], tip: footGeometry(footR[1]) },
    ],
    limb, [skin, skin, limb, limb],
    new THREE.Sphere(new THREE.Vector3(0, (legLen + H) / 2, 0), (legLen + H) / 2 + armLen + 0.4),
  );
  g.add(rig.mesh);

  const label = nameSprite(init.name, font);
  label.position.y = legLen + H + 0.85;
  g.add(label);

  // 앉을 때 내려가는 높이: 엉덩이와 몸 바닥 중 낮은 쪽이 땅 바로 위에 오도록
  const sitDrop = Math.max(0, Math.min(hip[0].y, hip[1].y) + legLen + Math.min(0, geo.boundingBox!.min.y) - 0.06);
  const dims: Dims = {
    H, W, legLen, shoulder: [shoulder[0], shoulder[1]], hip: [hip[0], hip[1]], armLen, legLength, handS, palm, palmT, footY,
    hang: [hang[0], hang[1]], chest, cover: [cover[0], cover[1]], headTop, eyeY: eyeY - legLen, eyeX, sitDrop, profile,
  };

  const ch: Blob = {
    g, body, mouth, rig, dims, pose: makePose(),
    yaw: 0, state: "idle", stateT: 0, carrying: false, walk: 0, bob: 0, baseY: 0, prayK: 0,
    moveK: 0, carryK: 0, bodyRy: 0,
    restK: 0, waveK: 0, joyK: 0, sadK: 0, joyH: 0, sitDrop,
    holdPoint: new THREE.Vector3(0, legLen + headTop.y, 0.05), holdR: 0.3, holdH: 0.2,
    idleWait: nextIdleWait(), idleKind: "swing", idleOn: false, idleT: 0, idleK: 0, idleArm: 0,
  };
  animateBlob(ch, 0, false);
  return ch;
}

const _M = new THREE.Matrix4(), _Mi = new THREE.Matrix4();
const ARM_STRETCH = 1.5; // 손이 닿지 않으면 팔을 이만큼까지 늘인다(고무관)
const _e = new THREE.Vector3(), _mid = new THREE.Vector3(), _tmp = new THREE.Vector3(), _grip = [new THREE.Vector3(), new THREE.Vector3()];
const _root = new THREE.Vector3(), _tgt = new THREE.Vector3(), _pole = new THREE.Vector3(), _f = new THREE.Vector3(), _o = new THREE.Vector3();

export function animateBlob(ch: Blob, dt: number, moving: boolean) {
  const blend = Math.min(1, dt * 6);
  ch.restK = lerp(ch.restK, ch.state === "rest" ? 1 : 0, blend);
  ch.waveK = lerp(ch.waveK, ch.state === "wave" ? 1 : 0, blend);
  ch.joyK = lerp(ch.joyK, ch.state === "joy" ? 1 : 0, Math.min(1, dt * 14));
  ch.sadK = lerp(ch.sadK, ch.state === "sad" ? 1 : 0, blend);
  ch.prayK = lerp(ch.prayK, ch.state === "pray" ? 1 : 0, Math.min(1, dt * 7));
  ch.moveK = lerp(ch.moveK, moving ? 1 : 0, Math.min(1, dt * 8));
  ch.carryK = lerp(ch.carryK, ch.carrying ? 1 : 0, Math.min(1, dt * 8));
  ch.walk = moving ? ch.walk + dt * 9 : lerp(ch.walk, Math.round(ch.walk / Math.PI) * Math.PI, 0.2);
  ch.bob += dt;
  ch.stateT += dt;
  // 기쁨: 1.8초에 3번 콩콩콩. 도중에 끊기면 공중에서 부드럽게 내려온다
  ch.joyH = ch.state === "joy"
    ? 0.4 * Math.abs(Math.sin(Math.PI * 3 * Math.min(1, ch.stateT / REACTION_SECONDS.joy)))
    : lerp(ch.joyH, 0, Math.min(1, dt * 10));

  // 멍하니 서 있으면 가끔 작은 행동을 한다. 움직이거나 다른 동작을 시작하면 바로 멈춘다
  if (moving || ch.carrying || ch.state !== "idle") {
    ch.idleOn = false;
    ch.idleWait = nextIdleWait();
  } else if (ch.idleOn) {
    if (ch.idleT >= IDLE_ACTIONS[ch.idleKind]) { ch.idleOn = false; ch.idleWait = nextIdleWait(); }
  } else if ((ch.idleWait -= dt) <= 0) {
    ch.idleKind = idleKinds[Math.floor(Math.random() * idleKinds.length)];
    ch.idleArm = Math.random() < 0.5 ? 0 : 1;
    ch.idleOn = true;
    ch.idleT = 0;
  }
  ch.idleT += dt;
  ch.idleK = lerp(ch.idleK, ch.idleOn ? 1 : 0, Math.min(1, dt * 4));

  // 자세를 겹겹이 섞는다
  const P = ch.pose, d = ch.dims;
  walkPose(P, d, ch);
  handPose(P, d, ch);
  reactionPose(P, d, ch, dt);
  prayPose(P, d, ch);
  idlePose(P, d, ch);

  // 몸: 숨쉬기 + 자세
  const b = P.body, breathe = Math.sin(ch.bob * 2.2) * 0.012;
  ch.bodyRy = dt ? lerp(ch.bodyRy, b.ry, Math.min(1, dt * 10)) : b.ry;
  ch.body.position.y = d.legLen + b.y;
  ch.body.rotation.set(b.rx, ch.bodyRy, b.rz);
  ch.body.scale.set(b.sx * (1 + breathe), b.sy * (1 - breathe), b.sz * (1 + breathe));
  ch.g.position.y = ch.baseY + P.lift;
  ch.body.updateMatrix();
  _M.copy(ch.body.matrix);
  _Mi.copy(_M).invert();

  // 다리: 발목 목표는 땅 아래로 내려가지 않게
  for (let i = 0; i < 2; i++) {
    const f = P.feet[i], l = ch.rig.legs[i];
    _root.copy(d.hip[i]).applyMatrix4(_M);
    f.p.resolve(_M, _tgt);
    if (_tgt.y < d.footY * 0.9) _tgt.y = d.footY * 0.9;
    solve(l, _root, _tgt, f.pole.resolveDir(_M, _pole), 1.1);
    orientFoot(l, f.pitch);
  }
  // 팔: 손바닥 가운데를 몸 밖으로 밀고, 손끝 방향을 따라 손목 자리를 구한다
  for (let i = 0; i < 2; i++) {
    const h = P.hands[i], l = ch.rig.arms[i];
    _root.copy(d.shoulder[i]).applyMatrix4(_M);
    h.p.resolve(_M, _tgt).applyMatrix4(_Mi);
    pushOut(d.profile, _tgt, d.palmT + 0.02).applyMatrix4(_M);
    h.f.resolveDir(_M, _f).normalize();
    h.o.resolveDir(_M, _o);
    _tgt.addScaledVector(_f, -d.palm);
    h.pole.resolveDir(_M, _pole);
    solve(l, _root, _tgt, _pole, ARM_STRETCH);
    // 팔꿈치나 아래팔 가운데가 몸속이면 팔꿈치를 몸 밖으로 밀어낸 쪽을 pole로 삼아 다시 푼다
    _e.copy(l.low.position).applyMatrix4(_Mi);
    _mid.copy(l.low.position).add(l.end.position).multiplyScalar(0.5).applyMatrix4(_Mi);
    pushOut(d.profile, _e, 0.07).sub(_mid).add(pushOut(d.profile, _tmp.copy(_mid), 0.07));
    _mid.copy(l.low.position).add(_root).multiplyScalar(0.5).applyMatrix4(_Mi); // 위팔 가운데도
    _e.sub(_mid).add(pushOut(d.profile, _tmp.copy(_mid), 0.07)).applyMatrix4(_M);
    if (_e.distanceToSquared(l.low.position) > 1e-6) solve(l, _root, _tgt, _pole.subVectors(_e, _root), ARM_STRETCH);
    orientHand(l, _f, _o);
    _grip[i].copy(_f).multiplyScalar(d.palm).add(l.end.position);
  }
  // 돌: 평소엔 머리 위, 쥐고 있을 땐 두 손바닥 사이(돌 가운데 → 바닥)
  P.hold.resolve(_M, ch.holdPoint);
  if (P.grip > 1e-3) {
    _tmp.copy(_grip[0]).add(_grip[1]).multiplyScalar(0.5);
    _tmp.y -= ch.holdH / 2;
    ch.holdPoint.lerp(_tmp, Math.min(1, P.grip));
  }

  const carry = ch.carrying;
  const mouthY = lerp(lerp(carry ? 0.45 : ch.state === "pickup" ? 1.3 : 1, 1.7, ch.joyK), 0.55, ch.sadK);
  ch.mouth.scale.set(1 + 0.3 * ch.joyK - 0.35 * ch.sadK, mouthY, 1);
  ch.g.rotation.y = ch.yaw;
}
