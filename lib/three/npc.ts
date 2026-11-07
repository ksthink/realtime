import * as THREE from "three";
import { type Blob, animateBlob, createBodyGeometry, encodeBody, makeBlob } from "./blob";
import paths from "./npc-paths.json";

// ── 나무지기: 세계 곳곳의 나무를 찾아다니며 가꾸는 숲의 정령 ──
// 슬라임 같은 반투명 구 몸에 얼굴·팔·정수리 새싹이 있고, 발 없이 둥둥 떠다닌다. 얼굴·팔·동작은 캐릭터(makeBlob)를 쓰고 다리만 숨긴다.
// 다닐 길은 scripts/gen-npc-paths.ts가 미리 만든 npc-paths.json을 쓴다. 위치는 서버 시각만으로 계산하므로
// 네트워크로 주고받지 않아도 모든 접속자가 같은 자리에서 본다

const SPEED = 2; // m/s. 캐릭터(4m/s)의 절반
const TEND = 6; // 나무 하나를 가꾸는 시간(초)
const SCALE = 0.8; // 캐릭터보다 조금 작게
const HOVER = 0.35; // 몸 바닥이 땅에서 뜬 높이(m)
const FLOAT = 0.12; // 둥실거리는 높이(m)
const SPACE = 2; // NPC끼리 이보다 가까워지지 않는다(m)

type Tree = { x: number; z: number };
type Seg = { t0: number; t1: number; ax: number; az: number; bx: number; bz: number; tree: Tree | null };
type Npc = {
  ch: Blob; tour: Seg[]; length: number; phase: number; legLen: number; x: number; z: number; lean: number; seg?: Seg;
  // 새싹 흔들림: 앞뒤(x)·좌우(z) 기울기와 그 속도. 지난 프레임 위치·방향으로 움직임을 잰다
  sprout: THREE.Group; sx: number; sz: number; vx: number; vz: number; px: number; pz: number; pyaw: number; speed: number;
};

export type NpcEnv = {
  blocked: (x: number, z: number) => boolean;
  standY: (x: number, z: number) => number;
  font: string;
};

// npc-paths.json의 한 바퀴를 시간표로 푼다. 양수 k는 점 k로 이동, 음수 -(k+1)은 점 k에서 나무 가꾸기
function makeTour(steps: number[]) {
  const pt = paths.points, tour: Seg[] = [];
  let at = pt[steps[0]], t = 0;
  for (const k of steps.slice(1)) {
    if (k >= 0) {
      const b = pt[k], dt = Math.hypot(b[0] - at[0], b[1] - at[1]) / SPEED;
      if (dt > 0) tour.push({ t0: t, t1: t + dt, ax: at[0], az: at[1], bx: b[0], bz: b[1], tree: null });
      t += dt; at = b;
    } else {
      const p = pt[-k - 1];
      tour.push({ t0: t, t1: t + TEND, ax: p[0], az: p[1], bx: p[0], bz: p[1], tree: { x: p[2], z: p[3] } });
      t += TEND;
    }
  }
  return { tour, length: t };
}

// 서버 시각과 이 기기 시각의 차이(ms). 세 번 재서 왕복이 가장 짧았던 값을 쓴다
async function clockOffset() {
  let best = Infinity, offset = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const res = await fetch("/api/time", { cache: "no-store" });
    const { now } = (await res.json()) as { now: number };
    const t1 = Date.now();
    if (t1 - t0 < best) { best = t1 - t0; offset = now - (t0 + t1) / 2; }
  }
  return offset;
}

// 새싹은 용수철처럼 흔들린다: 빨라지면 뒤로 젖혀지고, 멈추면 앞으로 낭창, 돌면 바깥쪽으로 기운다
function swaySprout(n: Npc, dt: number) {
  const ch = n.ch, p = ch.g.position;
  if (dt <= 0 || Number.isNaN(n.px)) { n.px = p.x; n.pz = p.z; n.pyaw = ch.yaw; return; }
  const sp = Math.min(Math.hypot(p.x - n.px, p.z - n.pz) / dt, SPEED * 2);
  const accel = (sp - n.speed) / dt;
  n.speed = sp;
  const turn = Math.atan2(Math.sin(ch.yaw - n.pyaw), Math.cos(ch.yaw - n.pyaw)) / dt;
  n.px = p.x; n.pz = p.z; n.pyaw = ch.yaw;
  const wantX = -0.18 * (sp / SPEED) - 0.02 * accel, wantZ = 0.12 * turn;
  n.vx += ((wantX - n.sx) * 90 - n.vx * 7) * dt;
  n.vz += ((wantZ - n.sz) * 90 - n.vz * 7) * dt;
  n.sx = Math.max(-0.6, Math.min(0.6, n.sx + n.vx * dt));
  n.sz = Math.max(-0.6, Math.min(0.6, n.sz + n.vz * dt));
  n.sprout.rotation.set(n.sx, 0, n.sz);
}

// 정수리의 새싹: 짧은 줄기와 양쪽으로 벌어진 떡잎 두 장
function sprout(top: number) {
  const g = new THREE.Group(), green = new THREE.MeshStandardMaterial({ color: "#7cc46a", roughness: 0.8 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.16, 6), green);
  stem.position.y = 0.08;
  g.add(stem);
  for (const s of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 6), green);
    leaf.scale.set(1, 0.28, 0.6);
    leaf.position.set(s * 0.07, 0.17, 0);
    leaf.rotation.z = s * 0.45;
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.position.y = top - 0.03;
  return g;
}

// 몸: 반투명 슬라임 구.
// 빚기 화면의 굳히기(bake)처럼 바닥을 y=0, 키를 1.45로 맞춰 캐릭터 몸과 같은 형식으로 만든다
export function npcBody() {
  const geo = createBodyGeometry();
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox!.min.y, 0);
  const h = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
  geo.scale(1.45 / h, 1.45 / h, 1.45 / h);
  const out = encodeBody(geo);
  geo.dispose();
  return out;
}

// 슬라임 재질: 반투명에 매끈하고, 보는 각도에 따라 무지개빛(박막 간섭)이 돈다. 안쪽이 은은하게 빛나 빛이 비쳐 든 것처럼 보인다.
// 진짜 투과(transmission)는 화면을 한 번 더 그려야 해서 휴대폰에서 무거우므로 쓰지 않는다
function slime(color: THREE.Color) {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true, transparent: true, opacity: 0.72, roughness: 0.12, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.08,
    iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 620,
    emissive: color, emissiveIntensity: 0.22,
  });
}

export function makeNpcs(root: THREE.Object3D, env: NpcEnv) {
  const body = npcBody(), npcs: Npc[] = [];
  paths.tours.forEach((steps, i) => {
    const { tour, length } = makeTour(steps);
    const c = new THREE.Color().setHSL(0.45 + 0.5 * (i / paths.tours.length), 0.55, 0.72);
    const ch = makeBlob({ seed: 5000 + i, name: "", top: `#${c.getHexString()}`, bottom: `#${c.clone().offsetHSL(0.06, 0.05, -0.06).getHexString()}`, body }, env.font);
    ch.g.traverse((o) => { if ((o as THREE.Sprite).isSprite) o.visible = false; }); // 이름표는 달지 않는다
    for (const l of ch.legs) l.visible = false; // 발 없이 떠다닌다
    (ch.body.material as THREE.Material).dispose();
    ch.body.material = slime(c);
    ch.g.scale.setScalar(SCALE);
    ch.g.rotation.order = "YXZ"; // 앞으로 기우는 각(x)이 바라보는 쪽을 따라가게
    ch.g.visible = false; // 서버 시각을 받을 때까지 숨긴다
    ch.body.geometry.computeBoundingBox();
    const sp = sprout(ch.body.geometry.boundingBox!.max.y);
    ch.body.add(sp);
    root.add(ch.g);
    npcs.push({ ch, tour, length, phase: i * 1.7, legLen: ch.body.position.y * SCALE, x: 0, z: 0, lean: 0, sprout: sp, sx: 0, sz: 0, vx: 0, vz: 0, px: NaN, pz: 0, pyaw: 0, speed: 0 });
  });
  let offset: number | null = null, fresh = true;
  clockOffset().then((o) => { offset = o; }, () => { offset = 0; }); // 못 받으면 이 기기 시계로

  return {
    update(dt: number) {
      if (offset === null) return;
      const now = (Date.now() + offset) / 1000, k = fresh ? 1 : Math.min(1, dt * 8);
      if (fresh) for (const n of npcs) n.ch.g.visible = true;
      fresh = false;
      for (const n of npcs) {
        const t = (now + n.phase * 1000) % n.length;
        let lo = 0, hi = n.tour.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (n.tour[m].t1 < t) lo = m + 1; else hi = m; }
        const s = n.tour[lo], u = Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0)));
        n.seg = s;
        n.x = s.ax + (s.bx - s.ax) * u; n.z = s.az + (s.bz - s.az) * u;
      }
      // 서로 SPACE보다 가까우면 반씩 비켜 선다. 위치만으로 정하므로 모든 접속자에게 같다. 막힌 땅으로는 밀지 않는다
      for (let i = 0; i < npcs.length; i++) for (let j = i + 1; j < npcs.length; j++) {
        const a = npcs[i], b = npcs[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= SPACE) continue;
        const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0, push = (SPACE - d) / 2;
        if (!env.blocked(a.x - ux * push, a.z - uz * push)) { a.x -= ux * push; a.z -= uz * push; }
        if (!env.blocked(b.x + ux * push, b.z + uz * push)) { b.x += ux * push; b.z += uz * push; }
      }
      for (const n of npcs) {
        const s = n.seg!, ch = n.ch, x = n.x, z = n.z;
        // 나무 앞에서는 나무를 보고 두 손을 모은다. 떠갈 때는 가는 쪽을 보고 앞으로 살짝 기운다
        const wantYaw = s.tree ? Math.atan2(s.tree.x - x, s.tree.z - z) : Math.atan2(s.bx - s.ax, s.bz - s.az);
        const dy = wantYaw - ch.yaw;
        ch.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
        if (s.tree ? ch.state !== "pray" : ch.state === "pray") { ch.state = s.tree ? "pray" : "idle"; ch.stateT = 0; }
        ch.g.position.set(x, 0, z);
        // 다리가 있던 높이(legLen)를 빼고 땅에서 HOVER만큼 떠서 둥실둥실
        const bob = Math.sin(now * 1.9 + n.phase);
        ch.baseY = env.standY(x, z) + HOVER - n.legLen + FLOAT * (1 + bob);
        animateBlob(ch, dt, false);
        // 슬라임처럼 올라갈 땐 길쭉, 내려올 땐 납작
        const sq = 0.05 * Math.cos(now * 1.9 + n.phase);
        ch.body.scale.y *= 1 + sq; ch.body.scale.x *= 1 - sq * 0.5; ch.body.scale.z *= 1 - sq * 0.5;
        n.lean += ((s.tree ? 0 : 0.12) - n.lean) * k;
        ch.g.rotation.x = n.lean;
        ch.g.rotation.z = 0.04 * Math.sin(now * 1.3 + n.phase * 2); // 살랑살랑
        swaySprout(n, dt);
        // 떠갈 때 팔이 하늘하늘
        if (!s.tree) for (let a = 0; a < 2; a++) ch.arms[a].rotation.z += (a ? 1 : -1) * (0.25 + 0.12 * Math.sin(now * 3 + n.phase + a));
      }
    },
  };
}
