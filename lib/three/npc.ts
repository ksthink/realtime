import * as THREE from "three";
import { WORLD, rng } from "../terrain";

// ── 나무지기: 세계 곳곳의 나무를 찾아다니며 가꾸는 역삼각형 NPC ──
// 서버 없이 모든 접속자가 같은 자리에서 보도록, 길과 일정은 시드로 정하고 위치는 현재 시각(Date.now)만으로 계산한다.
// 걸을 수 있는 곳 판정은 캐릭터와 같은 blocked를 쓴다

const COUNT = 11;
const SPEED = 1.5; // m/s
const TEND = 6; // 나무 하나를 가꾸는 시간(초)
const STOPS = 40; // NPC마다 한 바퀴에 들르는 나무 수
const FILL = 600; // 나무 사이를 잇는 길목 점 수
const TREE_SHARE = 0.4; // 이 비율의 나무만 찾아갈 나무로 삼는다(길 만드는 데 드는 시간을 줄인다)
const LINK = 11; // 이 거리(m) 안의 점끼리 곧은 길이 막히지 않으면 잇는다
const HOVER = 0.3; // 꼭짓점이 땅에서 뜬 높이
const SIZE = { r: 0.5, h: 1.1 };

type Node = { x: number; z: number; tree: { x: number; z: number } | null; edges: number[] };
type Seg = { t0: number; t1: number; ax: number; az: number; bx: number; bz: number; tree: { x: number; z: number } | null };
type Npc = { mesh: THREE.Mesh; tour: Seg[]; length: number; yaw: number; lean: number; phase: number };

export type NpcEnv = {
  blocked: (x: number, z: number) => boolean;
  standY: (x: number, z: number) => number;
  trees: { x: number; z: number }[];
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
function* makeTour(nodes: Node[], trees: number[], seed: number) {
  const r = rng(seed), tour: Seg[] = [];
  const start = trees[Math.floor(r() * trees.length)];
  let at = start, t = 0;
  const go = (to: number) => {
    for (const j of path(nodes, at, to)) {
      const a = nodes[at], b = nodes[j], dt = Math.hypot(b.x - a.x, b.z - a.z) / SPEED;
      tour.push({ t0: t, t1: t + dt, ax: a.x, az: a.z, bx: b.x, bz: b.z, tree: null });
      t += dt; at = j;
    }
  };
  for (let k = 0; k < STOPS; k++) {
    // 가까운 나무를 더 자주 고르되 가끔 멀리 떠난다
    let to = trees[Math.floor(r() * trees.length)];
    if (r() < 0.75) {
      let bestD = Infinity;
      for (let n = 0; n < 12; n++) {
        const c = trees[Math.floor(r() * trees.length)], d = Math.hypot(nodes[c].x - nodes[at].x, nodes[c].z - nodes[at].z);
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

// 꼭짓점이 아래를 향한 삼각뿔
function npcMesh(color: THREE.Color) {
  const geo = new THREE.ConeGeometry(SIZE.r, SIZE.h, 3);
  geo.rotateX(Math.PI);
  geo.translate(0, SIZE.h / 2, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true }));
  mesh.castShadow = true;
  return mesh;
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
    for (let i = 0; i < COUNT; i++) {
      const make = makeTour(nodes, trees, 9000 + i * 77);
      let m = make.next();
      while (!m.done) { yield; m = make.next(); }
      const { tour, length } = m.value;
      const mesh = npcMesh(new THREE.Color().setHSL(i / COUNT, 0.45, 0.78));
      root.add(mesh);
      npcs.push({ mesh, tour, length, yaw: 0, lean: 0, phase: i * 1.7 });
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
      const now = Date.now() / 1000, k = fresh ? 1 : Math.min(1, dt * 5);
      fresh = false;
      for (const n of npcs) {
        const t = (now + n.phase * 1000) % n.length;
        let lo = 0, hi = n.tour.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (n.tour[m].t1 < t) lo = m + 1; else hi = m; }
        const s = n.tour[lo], u = Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0)));
        const x = s.ax + (s.bx - s.ax) * u, z = s.az + (s.bz - s.az) * u;
        let wantYaw: number, wantLean: number, y = HOVER + 0.07 * Math.sin(now * 2.2 + n.phase);
        if (s.tree) {
          // 나무를 보고 고개 숙이듯 기울어 살랑살랑 흔든다
          wantYaw = Math.atan2(s.tree.x - x, s.tree.z - z);
          wantLean = 0.35 + 0.12 * Math.sin(now * 3 + n.phase);
          y += 0.06 * Math.abs(Math.sin(now * 3 + n.phase));
        } else {
          wantYaw = Math.atan2(s.bx - s.ax, s.bz - s.az);
          wantLean = 0.15;
        }
        const dy = wantYaw - n.yaw;
        n.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
        n.lean += (wantLean - n.lean) * k;
        n.mesh.position.set(x, env.standY(x, z) + y, z);
        n.mesh.rotation.set(n.lean, n.yaw, 0, "YXZ");
      }
    },
  };
}
