import * as THREE from "three";
import type { Blob } from "./blob";
import type { Profile } from "./rig";

// ── 자세 계산. 각 함수는 자기 가중치(k)로 pose를 목표 쪽으로 섞는다. 호출 순서: walk → hand → reaction → pray → idle ──
// 좌표: "캐릭터 공간"(g) = 발밑 땅이 원점, +z가 앞, -x가 오른쪽. "몸 공간"(l) = 몸통 바닥 가운데가 원점, 몸이 숙이고 흔들리고 눌리는 것까지 따라간다.
// 손·발 목표는 어느 공간으로든 줄 수 있고(Target.g / Target.l), 섞인 뒤 animateBlob이 최종 몸 변환으로 캐릭터 공간에 풀어 IK를 건다

// 캐릭터 공간 성분 g와 몸 공간 성분 l(가중치 w)을 따로 들고 있다가 몸 행렬 M으로 푼다: 결과 = g + M·(l, w).
// 이렇게 두면 두 공간의 목표를 섞어도 결과가 그대로 선형 보간된다
export class Target {
  gp = new THREE.Vector3();
  lp = new THREE.Vector3();
  w = 0;
  // 캐릭터 공간 목표 쪽으로 k만큼
  g(x: number, y: number, z: number, k = 1) {
    this.gp.set(this.gp.x + (x - this.gp.x) * k, this.gp.y + (y - this.gp.y) * k, this.gp.z + (z - this.gp.z) * k);
    this.lp.multiplyScalar(1 - k);
    this.w *= 1 - k;
    return this;
  }
  // 몸 공간 목표 쪽으로 k만큼
  l(x: number, y: number, z: number, k = 1) {
    this.gp.multiplyScalar(1 - k);
    this.lp.set(this.lp.x + (x - this.lp.x) * k, this.lp.y + (y - this.lp.y) * k, this.lp.z + (z - this.lp.z) * k);
    this.w += (1 - this.w) * k;
    return this;
  }
  gv(v: THREE.Vector3, k = 1) { return this.g(v.x, v.y, v.z, k); }
  lv(v: THREE.Vector3, k = 1) { return this.l(v.x, v.y, v.z, k); }
  // 점으로 풀기
  resolve(M: THREE.Matrix4, out: THREE.Vector3) {
    const e = M.elements, x = this.lp.x, y = this.lp.y, z = this.lp.z;
    return out.set(
      this.gp.x + e[0] * x + e[4] * y + e[8] * z + e[12] * this.w,
      this.gp.y + e[1] * x + e[5] * y + e[9] * z + e[13] * this.w,
      this.gp.z + e[2] * x + e[6] * y + e[10] * z + e[14] * this.w,
    );
  }
  // 방향으로 풀기(이동 성분 없이)
  resolveDir(M: THREE.Matrix4, out: THREE.Vector3) {
    const e = M.elements, x = this.lp.x, y = this.lp.y, z = this.lp.z;
    return out.set(this.gp.x + e[0] * x + e[4] * y + e[8] * z, this.gp.y + e[1] * x + e[5] * y + e[9] * z, this.gp.z + e[2] * x + e[6] * y + e[10] * z);
  }
}

// p = 손바닥 가운데, f = 손끝 방향, o = 손등 방향, pole = 팔꿈치가 향할 방향
export type HandPose = { p: Target; f: Target; o: Target; pole: Target };
// p = 발목, pole = 무릎이 향할 방향, pitch = 발끝 내림(+ 아래, 라디안)
export type FootPose = { p: Target; pole: Target; pitch: number };
// y: 몸 높이 변화(음수면 내려감, 다리가 굽는다), r*: 몸 회전(x+ 앞으로 숙임), s*: 몸 크기 배율
export type BodyPose = { y: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number };
// lift: 캐릭터 전체(발 포함)가 땅에서 뜨는 높이. hold: 들고 있는 돌의 바닥 가운데.
// grip(0~1): 돌을 hold 대신 실제 두 손바닥 사이에 둔다(줍기·놓기 중 손이 돌을 쥐고 있을 때)
export type Pose = { hands: [HandPose, HandPose]; feet: [FootPose, FootPose]; body: BodyPose; lift: number; hold: Target; grip: number };

export const makePose = (): Pose => {
  const hand = (): HandPose => ({ p: new Target(), f: new Target(), o: new Target(), pole: new Target() });
  const foot = (): FootPose => ({ p: new Target(), pole: new Target(), pitch: 0 });
  return { hands: [hand(), hand()], feet: [foot(), foot()], body: { y: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }, lift: 0, hold: new Target(), grip: 0 };
};

export function blendBody(b: BodyPose, k: number, y: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1) {
  b.y += (y - b.y) * k; b.rx += (rx - b.rx) * k; b.ry += (ry - b.ry) * k; b.rz += (rz - b.rz) * k;
  b.sx += (sx - b.sx) * k; b.sy += (sy - b.sy) * k; b.sz += (sz - b.sz) * k;
}

// 캐릭터마다 고정된 치수. 따로 적지 않으면 몸 공간. 배열 [0]은 오른쪽(-x), [1]은 왼쪽(+x)
export type Dims = {
  H: number; W: number; legLen: number; // 몸 키·너비, 서 있을 때 몸 바닥 높이
  shoulder: [THREE.Vector3, THREE.Vector3]; hip: [THREE.Vector3, THREE.Vector3];
  armLen: number; legLength: number; // 어깨→손목, 엉덩이→발목 (굽히지 않았을 때)
  handS: number; palm: number; palmT: number; // 손 크기, 손목→손바닥 가운데 거리, 손바닥 반두께
  footY: number; // 서 있을 때 발목 높이(캐릭터 공간)
  hang: [THREE.Vector3, THREE.Vector3]; // 가만히 섰을 때 손바닥 가운데
  chest: THREE.Vector3; // 합장할 때 두 손바닥이 맞닿는 점
  cover: [THREE.Vector3, THREE.Vector3]; // 얼굴을 가릴 때 손바닥 가운데(겉면에서 띄움)
  headTop: THREE.Vector3; // 머리 꼭대기(들고 있는 돌의 바닥)
  eyeY: number; eyeX: number;
  sitDrop: number; // 앉을 때 몸이 내려가는 높이(엉덩이가 땅 바로 위에 오도록)
  profile: Profile; // 손을 몸 밖으로 미는 데 쓴다(animateBlob이 자동으로 함)
};

// ── 걷기·서기: 바탕 자세. 모든 값을 k=1로 덮어쓴다 ──
// ch.walk: 오른발(feet[0])은 위상 walk, 왼발은 walk+π. 위상 0(2π의 배수)에서 오른발이 앞에서 땅에 닿는다 → π의 배수마다 한 발씩 딛는다
export function walkPose(pose: Pose, d: Dims, ch: Blob) {
  const m = ch.moveK, L = d.legLength;
  const A = 0.3 * L * m, lift = 0.32 * L * m;
  for (let i = 0; i < 2; i++) {
    const q = ch.walk + i * Math.PI, c = Math.cos(q), s = Math.sin(q);
    const f = pose.feet[i], h = d.hip[i];
    // 디딤(0~π): 앞에서 뒤로 미끄러지고, 흔듦(π~2π): 들어 올려 앞으로
    f.p.g(h.x, d.footY + Math.max(0, -s) * lift, h.z + 0.02 + A * c);
    f.pole.g(h.x * 0.3, 0, 1);
    f.pitch = -0.45 * m * c; // 닿을 때 발끝을 들고, 떼기 전에 발끝으로 민다
  }
  // 발이 닿는 순간 가장 낮고, 지나가는 순간 높다. 걷는 쪽으로 살짝 숙이고 좌우로 뒤뚱
  const bob = 1 - Math.abs(Math.sin(ch.walk));
  blendBody(pose.body, 1, -0.08 * L * m * bob, 0.07 * m, 0, 0.035 * m * Math.sin(ch.walk));
  pose.lift = 0;
  pose.hold.lv(d.headTop);
  pose.grip = 0;
  // 팔: 반대쪽 다리와 함께 앞뒤로. 앞으로 갈 때 팔꿈치가 더 굽는다
  const sw = 0.24 * d.armLen * m;
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1, hp = pose.hands[i], r = d.hang[i];
    const z = sw * (i ? 1 : -1) * Math.cos(ch.walk), fwd = Math.max(0, z) / (sw || 1);
    hp.p.l(r.x, r.y + 0.1 * d.armLen * fwd * m, r.z + z);
    hp.f.l(s * 0.25, -1, 0.2 + 1.2 * z);
    hp.o.l(s, 0, 0);
    hp.pole.l(s * 0.45, 0, -1);
  }
}

// ── 줍기·놓기·들기 ──
// pickup: stateT 0~0.45, place: 0~0.5, 들기: ch.carryK(부드럽게 0→1), 돌 크기: ch.holdR, ch.holdH
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const handTmp = (): HandPose => ({ p: new Target(), f: new Target(), o: new Target(), pole: new Target() });
const _hA = handTmp(), _hB = handTmp();
const HAND_KEYS = ["p", "f", "o", "pole"] as const;
// 손 자세 전체를 src 쪽으로 k만큼(두 공간 성분을 그대로 선형 보간)
function mixHand(dst: HandPose, src: HandPose, k: number) {
  for (const n of HAND_KEYS) {
    const a = dst[n], b = src[n];
    a.gp.lerp(b.gp, k); a.lp.lerp(b.lp, k); a.w += (b.w - a.w) * k;
  }
}

// 머리에 인 돌 옆을 두 손바닥으로 잡는다(몸 공간). 손끝은 위·안쪽, 팔꿈치는 밖으로
function holdHand(h: HandPose, d: Dims, ch: Blob, i: number, k: number) {
  const s = i ? 1 : -1, t = d.headTop, m = ch.moveK;
  const sw = 0.012 * m * Math.sin(ch.walk + i * Math.PI); // 걸을 때 발걸음 따라 손이 살짝 오르내림
  h.p.l(s * (ch.holdR + d.palmT * 0.6), t.y + ch.holdH * 0.5 + sw, t.z + 0.01 * m * Math.cos(ch.walk), k);
  h.f.l(-s * 0.35, 1, 0.08, k);
  h.o.l(s, 0.12, 0, k);
  h.pole.l(s, -0.25, -0.2, k);
}
// 발 앞 땅의 돌 옆을 잡는다(캐릭터 공간). 손끝은 아래·앞, 팔꿈치는 밖·뒤
function groundHand(h: HandPose, ch: Blob, i: number, z: number, out: number, k: number) {
  const s = i ? 1 : -1;
  h.p.g(s * (ch.holdR + 0.04 + out), ch.holdH * 0.5 + 0.03 + out * 0.5, z, k);
  h.f.g(-s * 0.3, -1, 0.45, k);
  h.o.g(s, 0.1, 0, k);
  h.pole.g(s, 0.25, -0.6, k);
}

// 줍기·놓기 가중치: 상태가 끝나면 마지막 자세 그대로 천천히 놓아 준다(dt는 ch.bob 차이)
type HandAct = { kind: "pickup" | "place"; u: number; k: number; t: number };
const handActs = new WeakMap<Blob, HandAct>();
function handAct(ch: Blob) {
  let a = handActs.get(ch);
  if (!a) handActs.set(ch, (a = { kind: "pickup", u: 1, k: 0, t: ch.bob }));
  const dt = Math.min(0.1, Math.max(0, ch.bob - a.t));
  a.t = ch.bob;
  if (ch.state === "pickup" || ch.state === "place") {
    a.kind = ch.state;
    a.u = Math.min(1, ch.stateT / (ch.state === "pickup" ? 0.45 : 0.5));
    a.k = 1;
  } else a.k = Math.max(0, a.k - dt * 7);
  return a;
}

export function handPose(pose: Pose, d: Dims, ch: Blob) {
  const a = handAct(ch), b = pose.body, L = d.legLength;
  // 들기: 줍기·놓기 중에는 그쪽이 손을 맡는다
  const cw = ch.carryK * (1 - a.k);
  if (cw > 1e-3) {
    for (let i = 0; i < 2; i++) holdHand(pose.hands[i], d, ch, i, cw);
    blendBody(b, cw, b.y, b.rx, b.ry, b.rz, b.sx * 1.012, b.sy * 0.975, b.sz * 1.012); // 돌 무게로 살짝 눌림
  }
  if (a.k < 1e-3) return;
  const u = a.u, k = a.k;
  if (a.kind === "pickup") {
    // 0~0.4 무릎 굽혀 숙이며 손을 땅으로 → 잡고 → 0.55~1 일어서며 머리 위로
    const reach = ease(u / 0.4), lift = ease((u - 0.55) / 0.45);
    const c = ease(u / 0.38) * (1 - ease((u - 0.5) / 0.45));
    pose.grip = k * ease((u - 0.3) / 0.1); // 손이 땅의 돌에 닿은 뒤부터 돌이 손을 따라온다
    for (let i = 0; i < 2; i++) {
      const h = _hA;
      mixHand(h, pose.hands[i], 1);
      groundHand(h, ch, i, 0.45 + ch.holdR * 0.5, 0, reach);
      holdHand(h, d, ch, i, lift);
      const arc = Math.sqrt(Math.sin(Math.PI * lift)); // 올릴 때 얼굴 앞을 지나 둥글게
      h.p.lp.z += 0.4 * arc; h.p.lp.y += 0.05 * arc;
      h.pole.l(i ? 1 : -1, -0.6, 0, arc); // 올리는 동안 팔꿈치는 옆·아래로
      mixHand(pose.hands[i], h, k);
      pose.feet[i].p.gp.x += d.hip[i].x * 0.3 * c * k;
    }
    const up = Math.sin(Math.PI * lift);
    blendBody(b, k * Math.max(c, up), -Math.min(0.45 * L, d.sitDrop * 0.75) * c, 0.5 * c, b.ry, b.rz, 1 - 0.02 * up, 1 + 0.035 * up, 1 - 0.02 * up);
  } else {
    // 0~0.5 앞으로 내리며 무릎 굽힘 → 손을 벌려 놓고 → 0.6~1 제자리
    const down = ease(u / 0.5), rel = ease((u - 0.46) / 0.14), back = ease((u - 0.6) / 0.4);
    const c = down * (1 - back);
    pose.grip = k * (1 - rel); // 손을 벌릴 때까지 돌은 손 사이에
    for (let i = 0; i < 2; i++) {
      const h = _hA, base = _hB;
      mixHand(base, pose.hands[i], 1);
      mixHand(h, base, 1);
      holdHand(h, d, ch, i, 1);
      groundHand(h, ch, i, 0.7, 0.07 * rel, down); // game.dropPoint가 0.7 앞
      const arc = Math.sin(Math.PI * down);
      h.p.lp.z += 0.22 * arc;
      mixHand(h, base, back);
      mixHand(pose.hands[i], h, k);
      pose.feet[i].p.gp.x += d.hip[i].x * 0.2 * c * k;
    }
    blendBody(b, k * c, -0.22 * L * c, 0.36 * c, b.ry, b.rz);
  }
}

// 몸 공간 목표 쪽으로 k만큼 섞되, 가는 도중(k≈0.5)엔 (mx,my,mz) 쪽으로 m만큼 돌아간다.
// 손끝이 아래→위로 바뀔 때 방향 벡터가 0을 지나며 뒤집히지 않게, 손이 몸을 뚫고 지나가지 않게 쓴다
function via(t: Target, k: number, x: number, y: number, z: number, mx: number, my: number, mz: number, m = 0.7) {
  t.l(x, y, z, k);
  if (k > 0 && k < 1) t.l(mx, my, mz, Math.sin(Math.PI * k) * m);
}

// ── 반응: 앉기(restK) · 인사(waveK, 오른팔=hands[0]) · 기쁨(joyK, ch.joyH) · 슬픔(sadK) ──
export function reactionPose(pose: Pose, d: Dims, ch: Blob, _dt: number) {
  const a = d.armLen, L = d.legLength, t = ch.stateT;

  // 앉기: 엉덩이를 땅에 대고 다리를 앞으로 벌려 뻗는다(무릎은 살짝 굽혀 위로). 몸은 살짝 뒤로, 손은 배 아래쪽에 얹는다
  const r = ch.restK;
  if (r > 0.001) {
    blendBody(pose.body, r, -d.sitDrop, -0.12, 0, 0);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, f = pose.feet[i], h = d.hip[i];
      f.p.g(h.x * 1.8, d.footY, h.z + 0.92 * L, r);
      f.pole.g(s * 0.3, 1, 0.4, r);
      f.pitch += (-0.45 - f.pitch) * r; // 뒤꿈치로 딛고 발끝은 위로
      const hp = pose.hands[i];
      via(hp.p, r, s * 0.3, 0.22 * d.H, 0.3, d.hang[i].x, d.hang[i].y, 0.3, 0.4);
      hp.f.l(-s * 0.6, -0.5, 0.5, r);
      hp.o.l(s * 0.6, 0.3, 0.7, r);
      hp.pole.l(s, -0.3, -0.5, r);
    }
  }

  // 인사: 오른팔을 옆으로 들어 팔꿈치는 어깨 높이에, 아래팔을 세워 손바닥이 앞을 보게 흔든다. 2.4초에 3번
  const w = ch.waveK;
  if (w > 0.001) {
    const sh = d.shoulder[0], hp = pose.hands[0];
    const q = 0.12 + 0.36 * Math.sin(t * Math.PI * 2.5); // 아래팔이 바깥(-x)으로 기운 각
    const ex = sh.x - 0.42 * a, ey = sh.y + 0.03 * a, ez = sh.z + 0.12 * a;
    const ux = -Math.sin(q), uy = Math.cos(q), uz = 0.12, n = 0.5 * a + d.palm;
    via(hp.p, w, ex + ux * n, ey + uy * n, ez + uz * n, sh.x - 0.7 * a, sh.y - 0.1 * a, sh.z + 0.2 * a, 0.5);
    via(hp.f, w, ux - 0.1 * Math.sin(t * Math.PI * 2.5), uy, uz, -1, 0, 0.4);
    hp.o.l(0, 0, -1, w);
    hp.pole.l(-1, -1, 0.1, w);
    blendBody(pose.body, w, pose.body.y, pose.body.rx, pose.body.ry, -0.05 - 0.02 * Math.sin(t * Math.PI * 2.5), pose.body.sx, pose.body.sy, pose.body.sz);
  }

  // 기쁨: 콩콩콩 3번. 땅 근처(jump<TH)에선 무릎을 굽혀 웅크리고(도약 준비·착지), 위로는 다리를 뻗고 난다.
  // 웅크림 깊이는 이륙 순간 속도가 이어지도록 맞췄다: 높이 = lift + body.y 가 jump에 대해 매끈
  const j = ch.joyK;
  if (j > 0.001) {
    const TH = 0.4, jump = Math.min(1, ch.joyH / 0.4);
    const air = Math.max(0, (jump - TH) / (1 - TH)), low = Math.max(0, 1 - (jump / TH) ** 2);
    const crouch = (0.2 * TH) / (1 - TH) * low;
    pose.lift += (0.4 * air - pose.lift) * j;
    blendBody(pose.body, j, -crouch, 0.1 * low - 0.05 * air, 0, 0, 1 + 0.06 * low - 0.03 * air, 1 - 0.1 * low + 0.07 * air, 1 + 0.06 * low - 0.03 * air);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, f = pose.feet[i];
      f.pitch += (0.5 * air - f.pitch) * j; // 공중에선 발끝을 내린다
      const sh = d.shoulder[i], hp = pose.hands[i], up = 0.14 * a * (air - low); // 팔이 한 박자 출렁
      via(hp.p, j, sh.x + s * 0.3 * a, sh.y + 0.7 * a + up, sh.z + 0.18 * a, sh.x + s * 0.6 * a, sh.y, sh.z + 0.2 * a, 0.5);
      via(hp.f, j, s * 0.35, 1, 0.1, s, 0, 0.4);
      hp.o.l(-s * 0.2, 0, -1, j);
      hp.pole.l(s, -0.6, -0.3, j);
    }
  }

  // 슬픔: 두 손바닥으로 눈을 가리고 팔꿈치는 아래·바깥으로. 고개를 저으며(1초에 1번) 살짝 숙이고 흐느낀다
  const sd = ch.sadK;
  if (sd > 0.001) {
    const sob = Math.abs(Math.sin(t * Math.PI * 4));
    blendBody(pose.body, sd, -0.02 * sob, 0.2 + 0.03 * sob, 0.42 * Math.sin(t * Math.PI * 2), 0);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, c = d.cover[i], hp = pose.hands[i], y = Math.max(c.y, d.eyeY - 0.02); // 입이 아니라 눈 높이
      via(hp.p, sd, c.x, y, c.z, s * d.W * 0.45, y - 0.25 * a, c.z + 0.1, 0.6);
      via(hp.f, sd, -s * 0.25, 1, -0.1, 0, 0, 1);
      hp.o.l(s * 0.2, 0.1, 1, sd);
      hp.pole.l(s, -0.6, 0.4, sd);
    }
  }
}

// ── 합장(prayK): 가슴 앞에서 두 손바닥을 세워 맞대고, 팔꿈치는 아래·바깥으로. 살짝 숙인다 ──
export function prayPose(pose: Pose, d: Dims, ch: Blob) {
  const k = ch.prayK;
  if (k < 0.001) return;
  blendBody(pose.body, k, pose.body.y, 0.14, pose.body.ry, pose.body.rz, pose.body.sx, pose.body.sy, pose.body.sz);
  const c = d.chest;
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1, hp = pose.hands[i];
    via(hp.p, k, c.x + s * d.palmT * 0.9, c.y, c.z, s * d.W * 0.4, c.y - 0.15 * d.armLen, c.z, 0.5);
    via(hp.f, k, 0, 1, 0.2, 0, 0, 1);
    hp.o.l(s, 0, 0, k);
    hp.pole.l(s, -0.6, 0.3, k);
  }
}

// ── 가만히 있을 때의 작은 행동(idleK, idleKind, idleT, idleArm) ──
const _up = new THREE.Vector3();
// 각 행동은 idleT 안에서 스스로 0으로 돌아오고, idleK가 들고 나는 걸 한 번 더 부드럽게 한다
export function idlePose(pose: Pose, d: Dims, ch: Blob) {
  const K = ch.idleK, t = ch.idleT, b = pose.body;
  if (K < 1e-3) return;
  if (ch.idleKind === "swing") {
    // 한 팔을 어깨에서 시계추처럼. 손끝이 조금 늦게 따라와 느슨해 보인다. 반대 팔·몸은 살짝 거꾸로
    const env = ease(t / 0.4) * (1 - ease((t - 1.8) / 0.55)), w = (2 * Math.PI * t) / 1.15;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, me = i === ch.idleArm, sh = d.shoulder[i], r = d.hang[i];
      const sw = Math.sin(w), th = (me ? (sw > 0 ? 0.75 : 0.45) : -0.12) * env * sw, lag = th - (me ? 0.3 : 0.05) * env * Math.cos(w);
      const R = (sh.y - r.y) * (1 - 0.1 * Math.max(0, Math.sin(th))); // 앞으로 갈 때 팔꿈치가 조금 굽는다
      const h = pose.hands[i];
      h.p.l(r.x, sh.y - R * Math.cos(th), r.z + R * Math.sin(th), K);
      h.f.l(s * 0.15, -Math.cos(lag), Math.sin(lag), K);
      h.o.l(s, 0, 0, K);
      h.pole.l(s * 0.45, 0, -1, K);
    }
    const sgn = ch.idleArm ? 1 : -1;
    blendBody(b, K, b.y, b.rx, b.ry - sgn * 0.06 * env * Math.sin(w), b.rz, b.sx, b.sy, b.sz);
  } else if (ch.idleKind === "look") {
    // 발은 그대로 두고 몸을 왼쪽 → 오른쪽 → 가운데로 돌려 둘러본다
    const A = 0.5, ry = A * (ease(t / 0.6) - 2 * ease((t - 1.2) / 0.8) + ease((t - 2.5) / 0.6));
    blendBody(b, K, b.y, b.rx - 0.04 * Math.min(1, Math.abs(ry) / A), b.ry + ry, b.rz - 0.08 * ry, b.sx, b.sy, b.sz);
  } else if (ch.idleKind === "stretch") {
    // 두 팔을 머리 위로 쭉, 몸은 살짝 젖히며 늘어나고 발끝으로 선다
    const up = ease(t / 0.7) * (1 - ease((t - 1.6) / 0.7)), k = K * up;
    const reach = 0.97 + 0.05 * Math.sin(Math.PI * ease((t - 0.7) / 0.9)); // 꼭대기에서 한 번 더 쭉
    const arc = Math.sin(Math.PI * up); // 몸 앞을 지나 둥글게 올라간다
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, sh = d.shoulder[i], h = pose.hands[i];
      const dir = _up.set(-s * 0.18, 1, 0.06).normalize(), L = (d.armLen + d.palm) * reach;
      h.p.l(sh.x + dir.x * L, sh.y + dir.y * L, sh.z + dir.z * L + 0.35 * arc, k);
      h.f.lv(dir, k);
      h.o.l(s, 0, -0.2, k);
      h.pole.l(s, 0, -0.3, k);
      const f = pose.feet[i];
      f.p.gp.y += 0.04 * k;
      f.pitch += (0.5 - f.pitch) * k;
    }
    blendBody(b, k, b.y + 0.04, b.rx - 0.12, b.ry, b.rz, b.sx * 0.975, b.sy * 1.05, b.sz * 0.975);
  } else {
    // sway: 좌우로 천천히 무게를 옮긴다. 짐이 빠진 쪽 발은 뒤꿈치가 살짝 들린다
    const env = ease(t / 0.5) * (1 - ease((t - 2.4) / 0.6)), ph = Math.sin((2 * Math.PI * t) / 1.5) * env;
    const free = ph > 0 ? 1 : 0, f = pose.feet[free], a = Math.abs(ph) * K;
    f.p.gp.y += 0.015 * a;
    f.pitch += 0.25 * a;
    blendBody(b, K, b.y - 0.012 * Math.abs(ph), b.rx, b.ry + 0.05 * ph, b.rz + 0.11 * ph, b.sx, b.sy, b.sz);
  }
}
