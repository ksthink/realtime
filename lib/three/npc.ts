import * as THREE from "three";
import { WORLD, bridgeLines, rng } from "../terrain";
import { type Blob, animateBlob, createBodyGeometry, encodeBody, makeBlob } from "./blob";

// ── 나무지기: 세계 곳곳의 나무를 찾아다니며 가꾸는 숲의 정령. 역삼각형 몸에 얼굴·팔·정수리 새싹이 있고 발 없이 떠다닌다 ──
// 얼굴·팔·동작은 캐릭터(makeBlob)를 그대로 쓰고 다리만 숨긴다. NPC마다 자기 구역의 나무를 주로 돌본다
// 서버 없이 모든 접속자가 같은 자리에서 보도록, 길과 일정은 시드로 정하고 위치는 현재 시각(Date.now)만으로 계산한다.
// 걸을 수 있는 곳 판정은 캐릭터와 같은 blocked를 쓴다

const COUNT = 11;
const SPEED = 2; // m/s. 캐릭터(4m/s)의 절반
const HOVER = 0.35; // 몸 바닥이 땅에서 뜬 높이(m)
const SPACE = 2.2; // NPC끼리 이보다 가까워지지 않는다(m)
const AWAY = 0.12; // 다음 나무를 자기 구역 밖에서 고를 확률
// NPC마다의 구역 중심(집). 안쪽 고리 3곳, 바깥 고리 8곳. 나무는 가장 가까운 집의 구역에 든다
const HOMES = [
  ...[0, 1, 2].map((i) => [Math.cos((i / 3) * Math.PI * 2 + 0.5) * 32, Math.sin((i / 3) * Math.PI * 2 + 0.5) * 32]),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [Math.cos((i / 8) * Math.PI * 2) * 82, Math.sin((i / 8) * Math.PI * 2) * 82]),
];
const TEND = 6; // 나무 하나를 가꾸는 시간(초)
const STOPS = 40; // NPC마다 한 바퀴에 들르는 나무 수
const FILL = 600; // 나무 사이를 잇는 길목 점 수
const TREE_SHARE = 0.4; // 이 비율의 나무만 찾아갈 나무로 삼는다(길 만드는 데 드는 시간을 줄인다)
const LINK = 11; // 이 거리(m) 안의 점끼리 곧은 길이 막히지 않으면 잇는다

type Node = { x: number; z: number; tree: { x: number; z: number } | null; edges: number[] };
type Seg = { t0: number; t1: number; ax: number; az: number; bx: number; bz: number; tree: { x: number; z: number } | null };
type Npc = {
  ch: Blob; tour: Seg[]; length: number; phase: number; legLen: number; x: number; z: number; lean: number; seg?: Seg;
  // 새싹 흔들림: 앞뒤(x)·좌우(z) 기울기와 그 속도. 지난 프레임 위치·방향으로 움직임을 잰다
  sprout: THREE.Group; sx: number; sz: number; vx: number; vz: number; px: number; pz: number; pyaw: number; speed: number;
};

export type NpcEnv = {
  blocked: (x: number, z: number) => boolean;
  standY: (x: number, z: number) => number;
  trees: { x: number; z: number }[];
  font: string;
};

function clearPath(env: NpcEnv, ax: number, az: number, bx: number, bz: number) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4);
  for (let i = 1; i < n; i++) if (env.blocked(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false;
  return true;
}

// 나무 옆 자리와 길목 점을 이은 길 그래프. 가장 큰 덩어리(서로 오갈 수 있는 점들)만 남긴다.
// 땅 판정을 수십만 번 하므로(1초 남짓) 조금씩 끊어 돌도록 중간중간 yield한다
function* buildGraph(env: NpcEnv) {
  const r = rng(424242), nodes: Node[] = [];
  for (const t of env.trees) {
    if (Math.hypot(t.x, t.z) > WORLD - 2 || r() > TREE_SHARE) continue;
    const a = r() * Math.PI * 2, x = t.x + Math.sin(a) * 0.9, z = t.z + Math.cos(a) * 0.9;
    if (!env.blocked(x, z)) nodes.push({ x, z, tree: t, edges: [] });
    yield;
  }
  // 다리: 무작위 점으로는 좁은 다리 위가 잘 이어지지 않으므로 다리 가운데 줄을 따라 점을 놓는다
  for (const [bx, z0, z1] of bridgeLines()) {
    for (let z = z0 - 2; z <= z1 + 2; z += 3) if (!env.blocked(bx, z)) nodes.push({ x: bx, z, tree: null, edges: [] });
  }
  for (let tries = 0, n = 0; n < FILL && tries < FILL * 10; tries++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (WORLD - 1), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!env.blocked(x, z)) { nodes.push({ x, z, tree: null, edges: [] }); n++; }
    yield;
  }
  // 격자로 가까운 점만 비교한다
  const cell = new Map<string, number[]>(), key = (x: number, z: number) => `${Math.floor(x / LINK)},${Math.floor(z / LINK)}`;
  nodes.forEach((p, i) => { const k = key(p.x, p.z); (cell.get(k) ?? cell.set(k, []).get(k)!).push(i); });
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i], cx = Math.floor(p.x / LINK), cz = Math.floor(p.z / LINK);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? []) {
        if (j <= i) continue;
        const q = nodes[j];
        if (Math.hypot(q.x - p.x, q.z - p.z) > LINK) continue;
        if (clearPath(env, p.x, p.z, q.x, q.z)) { p.edges.push(j); q.edges.push(i); }
        yield;
      }
    }
  }
  // 가장 큰 덩어리
  const comp = new Int32Array(nodes.length).fill(-1);
  let best = -1, bestN = 0;
  for (let s = 0, c = 0; s < nodes.length; s++, c++) {
    if (comp[s] >= 0) { c--; continue; }
    const stack = [s];
    let n = 0;
    comp[s] = c;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      for (const j of nodes[i].edges) if (comp[j] < 0) { comp[j] = c; stack.push(j); }
    }
    if (n > bestN) { bestN = n; best = c; }
  }
  return { nodes, ok: (i: number) => comp[i] === best };
}

// a에서 b까지 가장 짧은 길(점 번호 목록, a 제외)
function path(nodes: Node[], a: number, b: number) {
  const dist = new Float64Array(nodes.length).fill(Infinity), prev = new Int32Array(nodes.length).fill(-1);
  const heap: [number, number][] = [[0, a]];
  dist[a] = 0;
  const push = (v: [number, number]) => {
    heap.push(v);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, i] = pop();
    if (i === b) break;
    if (d > dist[i]) continue;
    for (const j of nodes[i].edges) {
      const nd = d + Math.hypot(nodes[j].x - nodes[i].x, nodes[j].z - nodes[i].z);
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push([nd, j]); }
    }
  }
  const out: number[] = [];
  for (let i = b; i !== a && i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

// 나무 STOPS개를 차례로 들러 처음 자리로 돌아오는 한 바퀴. 다 돌면 처음부터 되풀이한다
// own: 이 NPC의 구역 나무. 대부분 그중에서 고르고, 가끔(AWAY) 아무 나무나 찾아 멀리 다녀온다
function* makeTour(nodes: Node[], trees: number[], own: number[], seed: number) {
  const r = rng(seed), tour: Seg[] = [];
  const start = own[Math.floor(r() * own.length)];
  let at = start, t = 0;
  const go = (to: number) => {
    for (const j of path(nodes, at, to)) {
      const a = nodes[at], b = nodes[j], dt = Math.hypot(b.x - a.x, b.z - a.z) / SPEED;
      tour.push({ t0: t, t1: t + dt, ax: a.x, az: a.z, bx: b.x, bz: b.z, tree: null });
      t += dt; at = j;
    }
  };
  for (let k = 0; k < STOPS; k++) {
    // 구역 안에서는 가까운 나무를 더 자주 고른다
    let to = trees[Math.floor(r() * trees.length)];
    if (r() > AWAY) {
      let bestD = Infinity;
      for (let n = 0; n < 8; n++) {
        const c = own[Math.floor(r() * own.length)], d = Math.hypot(nodes[c].x - nodes[at].x, nodes[c].z - nodes[at].z);
        if (c !== at && d < bestD) { bestD = d; to = c; }
      }
    }
    go(to);
    yield;
    const p = nodes[at];
    tour.push({ t0: t, t1: t + TEND, ax: p.x, az: p.z, bx: p.x, bz: p.z, tree: p.tree });
    t += TEND;
  }
  go(start);
  return { tour, length: t };
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

// 몸: 앞에서 보면 위가 넓고 아래가 좁은 역삼각형. 모서리는 둥글게, 앞뒤로는 조금 납작하게.
// 빚기 화면의 굳히기(bake)처럼 바닥을 y=0, 키를 1.45로 맞춰 캐릭터 몸과 같은 형식으로 만든다
export function npcBody() {
  const geo = createBodyGeometry(), pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const p = 6, k = Math.pow(Math.abs(v.x) ** p + Math.abs(v.y) ** p + Math.abs(v.z) ** p, 1 / p);
    v.multiplyScalar(0.72 / k); // 둥근 정육면체
    const t = (v.y + 0.72) / 1.44, w = 0.32 + 1.05 * t; // 아래 0.32배 → 위 1.37배
    v.x *= w; v.z *= 0.5 + 0.45 * t;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox!.min.y, 0);
  const h = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
  geo.scale(1.45 / h, 1.45 / h, 1.45 / h);
  const out = encodeBody(geo);
  geo.dispose();
  return out;
}

// 준비(길 만들기)는 update에서 프레임마다 BUDGET ms씩 나눠 하고, 다 되면 NPC가 나타난다
const BUDGET = 4;

export function makeNpcs(root: THREE.Object3D, env: NpcEnv) {
  const npcs: Npc[] = [];
  const build = (function* () {
    const graph = buildGraph(env);
    let r = graph.next();
    while (!r.done) { yield; r = graph.next(); }
    const { nodes, ok } = r.value;
    const trees = nodes.map((n, i) => (n.tree && ok(i) ? i : -1)).filter((i) => i >= 0);
    if (trees.length < 2) return;
    const body = npcBody();
    // 나무마다 가장 가까운 집(HOMES)의 NPC 구역에 넣는다
    const own: number[][] = HOMES.map(() => []);
    for (const t of trees) {
      let best = 0, bestD = Infinity;
      HOMES.forEach(([hx, hz], h) => { const d = Math.hypot(nodes[t].x - hx, nodes[t].z - hz); if (d < bestD) { bestD = d; best = h; } });
      own[best].push(t);
    }
    for (let i = 0; i < COUNT; i++) {
      const make = makeTour(nodes, trees, own[i].length > 1 ? own[i] : trees, 9000 + i * 77);
      let m = make.next();
      while (!m.done) { yield; m = make.next(); }
      const { tour, length } = m.value;
      const c = new THREE.Color().setHSL(i / COUNT, 0.5, 0.74);
      const ch = makeBlob({ seed: 5000 + i, name: "", top: `#${c.getHexString()}`, bottom: `#${c.offsetHSL(0.08, 0, -0.04).getHexString()}`, body }, env.font);
      ch.g.traverse((o) => { if ((o as THREE.Sprite).isSprite) o.visible = false; }); // 이름표는 달지 않는다
      for (const l of ch.legs) l.visible = false; // 발 없이 떠다닌다
      ch.g.rotation.order = "YXZ"; // 앞으로 기우는 각(x)이 바라보는 쪽을 따라가게
      ch.body.geometry.computeBoundingBox();
      const sp = sprout(ch.body.geometry.boundingBox!.max.y);
      ch.body.add(sp);
      root.add(ch.g);
      npcs.push({ ch, tour, length, phase: i * 1.7, legLen: ch.body.position.y, x: 0, z: 0, lean: 0, sprout: sp, sx: 0, sz: 0, vx: 0, vz: 0, px: NaN, pz: 0, pyaw: 0, speed: 0 });
      yield;
    }
  })();
  let building = true, fresh = true;

  return {
    update(dt: number) {
      if (building) {
        const end = performance.now() + BUDGET;
        while (performance.now() < end) if (build.next().done) { building = false; break; }
        if (building) return;
      }
      const now = Date.now() / 1000, k = fresh ? 1 : Math.min(1, dt * 8);
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
        // 다리가 있던 높이(legLen)를 빼고 땅에서 HOVER만큼 떠서 둥실거린다
        ch.baseY = env.standY(x, z) + HOVER - n.legLen + 0.07 * Math.sin(now * 2 + n.phase);
        animateBlob(ch, dt, false);
        n.lean += ((s.tree ? 0 : 0.12) - n.lean) * k;
        ch.g.rotation.x = n.lean;
        swaySprout(n, dt);
        // 떠갈 때 팔이 하늘하늘
        if (!s.tree) for (let a = 0; a < 2; a++) ch.arms[a].rotation.z += (a ? 1 : -1) * (0.25 + 0.12 * Math.sin(now * 3 + n.phase + a));
      }
    },
  };
}
