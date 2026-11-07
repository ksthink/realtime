import * as THREE from "three";
import { WATER_Y } from "../terrain";
import { type Blob, animateBlob, createBodyGeometry, encodeBody, makeBlob } from "./blob";
import paths from "./npc-paths.json";

// ── 나무지기: 세계 곳곳을 다니며 나무를 가꾸고, 꽃에 물을 주고, 물고기에게 먹이를 주는 숲의 정령 ──
// 슬라임 같은 반투명 구 몸에 얼굴·팔·정수리 새싹이 있고, 발 없이 둥둥 떠다닌다. 얼굴·팔·동작은 캐릭터(makeBlob)를 쓰고 다리만 숨긴다.
// 다닐 길은 scripts/gen-npc-paths.ts가 미리 만든 npc-paths.json을 쓴다. 위치는 서버 시각만으로 계산하므로
// 네트워크로 주고받지 않아도 모든 접속자가 같은 자리에서 본다

const SPEED = 2; // m/s. 캐릭터(4m/s)의 절반
// 할 일(0 나무 가꾸기, 1 꽃 물주기, 2 물고기 먹이 주기)마다 머무는 시간(초)
const TREE = 0, FLOWER = 1, POND = 2, STAY = [6, 5, 9];
const SCALE = 0.8; // 캐릭터보다 조금 작게
const HOVER = 0.35; // 몸 바닥이 땅에서 뜬 높이(m)
const FLOAT = 0.12; // 둥실거리는 높이(m)
const SPACE = 2; // NPC끼리 이보다 가까워지지 않는다(m)

type Spot = { x: number; z: number; kind: number }; // 할 일과 그 대상 자리
type Seg = { t0: number; t1: number; ax: number; az: number; bx: number; bz: number; spot: Spot | null };
type Npc = {
  ch: Blob; tour: Seg[]; length: number; phase: number; legLen: number; x: number; z: number; lean: number; seg?: Seg;
  mats: { near: THREE.Material; far: THREE.Material };
  can: THREE.Group; drip: number; toss: number; // 물뿌리개, 물방울·먹이를 내보낼 때까지 남은 시간
  // 새싹 흔들림: 앞뒤(x)·좌우(z) 기울기와 그 속도. 지난 프레임 위치·방향으로 움직임을 잰다
  sprout: THREE.Group; sx: number; sz: number; vx: number; vz: number; px: number; pz: number; pyaw: number; speed: number;
};

export type NpcEnv = {
  blocked: (x: number, z: number) => boolean;
  standY: (x: number, z: number) => number;
  font: string;
  refract: boolean; // false면 빛 투과(굴절)를 쓰지 않는다(휴대폰)
  splash: (x: number, z: number, yaw: number) => void; // 먹이가 물에 떨어질 때 물결
};

// npc-paths.json의 한 바퀴를 시간표로 푼다. 양수 k는 점 k로 이동, 음수 -(k+1)은 점 k에서 그 점의 할 일(점의 다섯째 값)
function makeTour(steps: number[]) {
  const pt = paths.points, tour: Seg[] = [];
  let at = pt[steps[0]], t = 0;
  for (const k of steps.slice(1)) {
    if (k >= 0) {
      const b = pt[k], dt = Math.hypot(b[0] - at[0], b[1] - at[1]) / SPEED;
      if (dt > 0) tour.push({ t0: t, t1: t + dt, ax: at[0], az: at[1], bx: b[0], bz: b[1], spot: null });
      t += dt; at = b;
    } else {
      const p = pt[-k - 1], kind = p[4] ?? TREE;
      tour.push({ t0: t, t1: t + STAY[kind], ax: p[0], az: p[1], bx: p[0], bz: p[1], spot: { x: p[2], z: p[3], kind } });
      t += STAY[kind];
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

// 슬라임 재질 두 벌. 캐릭터(무광)와 어울리도록 반짝임·반사는 거의 없애고, 무지개빛(박막 간섭)은 은은하게, 안쪽은 살짝 빛난다.
// 반사를 남기면 환경맵이 없어 가장자리가 검게 비치므로 반사 세기를 낮춘다
// near: 진짜 빛 투과(transmission). 몸 너머의 것(뒤·옆에서 본 눈코입과 팔, 배경)이 물방울을 지나며 굴절돼 보인다.
//       화면을 한 번 더 그려야 해서 무거우므로 카메라 가까이(NEAR) 있는 NPC에만 쓴다
// far: 그냥 반투명. 멀리서는 굴절이 보이지 않으니 가볍게
const NEAR = 18;
function slime(color: THREE.Color) {
  const common = {
    vertexColors: true, roughness: 0.65, metalness: 0, specularIntensity: 0.15,
    iridescence: 0.35, iridescenceIOR: 1.35, iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 620,
    emissive: color, emissiveIntensity: 0.18,
  };
  return {
    near: new THREE.MeshPhysicalMaterial({ ...common, transmission: 0.55, ior: 1.1, thickness: 0.4, attenuationColor: color, attenuationDistance: 1.6 }),
    far: new THREE.MeshPhysicalMaterial({ ...common, transparent: true, opacity: 0.72 }),
  };
}

// 물뿌리개: 정령이 손 대신 몸 앞에 띄워 기울인다. 주둥이는 앞(+z)으로 비스듬히 올라가 있다
const SPOUT = new THREE.Vector3(0, 0.11, 0.2); // 주둥이 끝(물뿌리개 공간)
function wateringCan(color: THREE.Color) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.13, 14), mat);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.2, 6).translate(0, 0.1, 0).rotateX(1.0), mat);
  spout.position.set(0, 0.0, 0.06);
  const rose = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), mat); // 주둥이 끝 꼭지
  rose.position.copy(SPOUT);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 12, Math.PI), mat);
  handle.rotation.set(0, Math.PI / 2, 0);
  handle.position.set(0, 0.06, -0.02);
  g.add(body, spout, rose, handle);
  g.traverse((o) => { o.castShadow = true; });
  g.visible = false;
  g.name = "watering-can";
  return g;
}

// 물방울과 먹이 알갱이. 공 하나씩을 인스턴싱으로 그린다
const DROPS = 160, PELLETS = 90;
function particles(root: THREE.Object3D, n: number, size: number, color: string, opts: THREE.MeshStandardMaterialParameters = {}) {
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 6, 4), new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...opts }), n);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(mesh);
  return { mesh, p: new Float32Array(n * 3), v: new Float32Array(n * 3), life: new Float32Array(n), next: 0 };
}
type Particles = ReturnType<typeof particles>;
function emit(ps: Particles, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
  const i = ps.next; ps.next = (ps.next + 1) % ps.life.length;
  ps.p.set([x, y, z], i * 3); ps.v.set([vx, vy, vz], i * 3); ps.life[i] = life;
}
const _pm = new THREE.Matrix4(), _pv = new THREE.Vector3(), _pt = new THREE.Vector3(), _q0 = new THREE.Quaternion();

export function makeNpcs(root: THREE.Object3D, env: NpcEnv) {
  const body = npcBody(), npcs: Npc[] = [];
  paths.tours.forEach((steps, i) => {
    const { tour, length } = makeTour(steps);
    const c = new THREE.Color().setHSL(0.45 + 0.5 * (i / paths.tours.length), 0.55, 0.72);
    const ch = makeBlob({ seed: 5000 + i, name: "", top: `#${c.getHexString()}`, bottom: `#${c.clone().offsetHSL(0.06, 0.05, -0.06).getHexString()}`, body }, env.font);
    ch.g.traverse((o) => { if ((o as THREE.Sprite).isSprite) o.visible = false; }); // 이름표는 달지 않는다
    for (const l of ch.legs) l.visible = false; // 발 없이 떠다닌다
    (ch.body.material as THREE.Material).dispose();
    const mats = slime(c);
    ch.body.material = mats.far;
    ch.g.scale.setScalar(SCALE);
    ch.g.rotation.order = "YXZ"; // 앞으로 기우는 각(x)이 바라보는 쪽을 따라가게
    ch.g.visible = false; // 서버 시각을 받을 때까지 숨긴다
    ch.body.geometry.computeBoundingBox();
    const sp = sprout(ch.body.geometry.boundingBox!.max.y);
    ch.body.add(sp);
    const can = wateringCan(c.clone().offsetHSL(0.5, 0.1, -0.05));
    can.position.set(0.2, ch.body.position.y + 0.55, 0.85); // 몸 앞, 가슴 높이(그룹 공간)
    ch.g.add(can);
    root.add(ch.g);
    npcs.push({ ch, mats, can, drip: 0, toss: 0, tour, length, phase: i * 1.7, legLen: ch.body.position.y * SCALE, x: 0, z: 0, lean: 0, sprout: sp, sx: 0, sz: 0, vx: 0, vz: 0, px: NaN, pz: 0, pyaw: 0, speed: 0 });
  });
  const drops = particles(root, DROPS, 0.028, "#8fd0ff", { transparent: true, opacity: 0.9, emissive: "#6fb8ff", emissiveIntensity: 0.4 });
  const pellets = particles(root, PELLETS, 0.032, "#c98a4b");
  const feeding: { x: number; z: number }[] = [];
  let offset: number | null = null, fresh = true;
  clockOffset().then((o) => { offset = o; }, () => { offset = 0; }); // 못 받으면 이 기기 시계로

  // 물방울: 떨어지다 땅에 닿으면 사라진다. 먹이: 물에 떨어지면 물결을 내고 잠시 둥둥 떠 있다가 사라진다
  const stepParticles = (dt: number, now: number) => {
    for (const [ps, pellet] of [[drops, false], [pellets, true]] as const) {
      for (let i = 0; i < ps.life.length; i++) {
        if (ps.life[i] <= 0) { ps.mesh.setMatrixAt(i, _pm.makeScale(0, 0, 0)); continue; }
        ps.life[i] -= dt;
        const o = i * 3, floating = ps.v[o] === 0 && ps.v[o + 1] === 0 && ps.v[o + 2] === 0;
        if (!floating) {
          ps.v[o + 1] -= 9.8 * dt;
          ps.p[o] += ps.v[o] * dt; ps.p[o + 1] += ps.v[o + 1] * dt; ps.p[o + 2] += ps.v[o + 2] * dt;
          const x = ps.p[o], z = ps.p[o + 2], ground = env.standY(x, z);
          if (pellet && ps.p[o + 1] <= WATER_Y + 0.01 && ground < WATER_Y) {
            ps.p[o + 1] = WATER_Y + 0.01; ps.v.fill(0, o, o + 3); ps.life[i] = Math.min(ps.life[i], 3);
            if (i % 3 === 0) env.splash(x, z, 0);
          } else if (ps.p[o + 1] <= ground + 0.02) ps.life[i] = 0;
        }
        const bob = floating ? Math.sin(now * 3 + i) * 0.006 : 0, shrink = Math.max(0, Math.min(1, ps.life[i] * 2));
        ps.mesh.setMatrixAt(i, _pm.compose(_pv.set(ps.p[o], ps.p[o + 1] + bob, ps.p[o + 2]), _q0, _pt.setScalar(shrink)));
      }
      ps.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    // 지금 먹이를 주고 있는 물고기 터 가운데들. 물고기가 이리로 모인다
    feeding,
    update(dt: number, camera: THREE.Camera) {
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
      feeding.length = 0;
      for (const n of npcs) {
        const s = n.seg!, ch = n.ch, x = n.x, z = n.z, kind = s.spot?.kind ?? -1;
        // 할 일 앞에서는 그쪽(나무·꽃·물)을 본다. 떠갈 때는 가는 쪽을 보고 앞으로 살짝 기운다
        const wantYaw = s.spot ? Math.atan2(s.spot.x - x, s.spot.z - z) : Math.atan2(s.bx - s.ax, s.bz - s.az);
        const dy = wantYaw - ch.yaw;
        ch.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
        // 나무 앞에서는 두 손을 모은다
        const pray = kind === TREE;
        if (pray ? ch.state !== "pray" : ch.state === "pray") { ch.state = pray ? "pray" : "idle"; ch.stateT = 0; }
        ch.g.position.set(x, 0, z);
        // 다리가 있던 높이(legLen)를 빼고 땅에서 HOVER만큼 떠서 둥실둥실
        const bob = Math.sin(now * 1.9 + n.phase);
        ch.baseY = env.standY(x, z) + HOVER - n.legLen + FLOAT * (1 + bob);
        animateBlob(ch, dt, false);
        // 슬라임처럼 올라갈 땐 길쭉, 내려올 땐 납작
        const sq = 0.05 * Math.cos(now * 1.9 + n.phase);
        ch.body.scale.y *= 1 + sq; ch.body.scale.x *= 1 - sq * 0.5; ch.body.scale.z *= 1 - sq * 0.5;
        n.lean += ((s.spot ? (kind === FLOWER ? 0.1 : 0) : 0.12) - n.lean) * k;
        ch.g.rotation.x = n.lean;
        ch.g.rotation.z = 0.04 * Math.sin(now * 1.3 + n.phase * 2); // 살랑살랑
        swaySprout(n, dt);
        ch.body.material = env.refract && ch.g.position.distanceToSquared(camera.position) < NEAR * NEAR ? n.mats.near : n.mats.far;
        // 떠갈 때 팔이 하늘하늘
        if (!s.spot) for (let a = 0; a < 2; a++) ch.arms[a].rotation.z += (a ? 1 : -1) * (0.25 + 0.12 * Math.sin(now * 3 + n.phase + a));
        const near = ch.g.position.distanceToSquared(camera.position) < 60 * 60; // 물방울·먹이는 가까이 있을 때만
        // 꽃 물주기: 물뿌리개를 꽃 쪽으로 기울여 물방울을 뿌린다
        n.can.visible = kind === FLOWER;
        if (kind === FLOWER) {
          n.can.rotation.x = 0.55 + 0.12 * Math.sin(now * 2.4 + n.phase);
          if (near && (n.drip -= dt) <= 0) {
            n.drip = 0.022;
            n.can.updateWorldMatrix(true, false);
            const tip = n.can.localToWorld(_pv.copy(SPOUT)), fx = Math.sin(ch.yaw), fz = Math.cos(ch.yaw);
            emit(drops, tip.x, tip.y, tip.z, fx * 0.7 + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.4, fz * 0.7 + (Math.random() - 0.5) * 0.3, 1.5);
          }
        }
        // 물고기 먹이 주기: 한 손을 휘둘러 터 가운데 둘레로 먹이를 몇 알씩 던진다
        if (kind === POND) {
          const sp = s.spot!;
          feeding.push({ x: sp.x, z: sp.z });
          const swing = Math.max(0, Math.sin(now * 9 + n.phase)); // 0.7초쯤마다 한 번
          ch.arms[0].rotation.z -= 1.3 * swing;
          if (near && (n.toss -= dt) <= 0) {
            n.toss = 0.7;
            ch.g.updateWorldMatrix(true, false);
            const from = ch.g.localToWorld(_pv.set(-0.4, ch.body.position.y + 0.75, 0.6)), T = 0.9;
            for (let q = 0; q < 3; q++) {
              const tx = sp.x + (Math.random() - 0.5) * 2, tz = sp.z + (Math.random() - 0.5) * 2;
              emit(pellets, from.x, from.y, from.z, (tx - from.x) / T, (WATER_Y - from.y) / T + 4.9 * T, (tz - from.z) / T, 6);
            }
          }
        }
      }
      stepParticles(dt, now);
    },
  };
}
