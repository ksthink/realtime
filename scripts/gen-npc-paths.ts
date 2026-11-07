// 나무지기 NPC가 다닐 길과 할 일(나무 가꾸기·꽃 물주기·물고기 먹이 주기)을 미리 만들어 lib/three/npc-paths.json에 쓴다.
// 브라우저마다 길을 만들면 느리고(저사양 휴대폰에서 수 초), 땅 판정이 경계에서 아주 조금만 달라도 길 전체가 달라질 수 있어서다.
// 지형(lib/terrain.ts), 나무·꽃 배치(lib/three/world.ts), 물고기 터(lib/three/critters.ts)를 바꾸면 다시 돌릴 것: npm run gen:npc
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { WORLD, blocked, bridgeLines, rng } from "../lib/terrain";
import { fishPonds } from "../lib/three/critters";
import { buildWorld } from "../lib/three/world";

const COUNT = 11;
const STOPS = 40; // NPC마다 한 바퀴에 들르는 곳 수
// 할 일: 0 나무 가꾸기, 1 꽃 물주기, 2 물고기 먹이 주기. 들를 곳을 고를 때의 비율
const TREE = 0, FLOWER = 1, POND = 2, KIND_SHARE = [0.45, 0.35, 0.2];
const FLOWER_SPOTS = 700; // 물줄 꽃으로 삼을 꽃 수
const FILL = 1200; // 나무 사이를 잇는 길목 점 수
const LINK = 11; // 이 거리(m) 안의 점끼리 곧은 길이 막히지 않으면 잇는다
const STEP = 0.05; // 곧은 길이 막혔는지 이 간격으로 살핀다. 물가의 얇은 틈도 놓치지 않게 촘촘히
const AWAY = 0.12; // 다음 나무를 자기 구역 밖에서 고를 확률
// NPC마다의 구역 중심(집). 안쪽 고리 3곳, 바깥 고리 8곳. 나무는 가장 가까운 집의 구역에 든다
const HOMES = [
  ...[0, 1, 2].map((i) => [Math.cos((i / 3) * Math.PI * 2 + 0.5) * 32, Math.sin((i / 3) * Math.PI * 2 + 0.5) * 32]),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [Math.cos((i / 8) * Math.PI * 2) * 82, Math.sin((i / 8) * Math.PI * 2) * 82]),
];

// spot: 이 점에서 할 일과 그 대상(나무·꽃·물고기 터 가운데) 자리
type Spot = { x: number; z: number; kind: number };
type Node = { x: number; z: number; spot: Spot | null; edges: number[] };
const round = (v: number) => Math.round(v * 100) / 100;

function clearPath(ax: number, az: number, bx: number, bz: number) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / STEP);
  for (let i = 1; i < n; i++) if (blocked(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false;
  return true;
}

// ── 길 그래프: 나무 옆 자리, 다리 위, 무작위 길목 점을 막히지 않은 곧은 길로 잇는다 ──
const world = buildWorld(new THREE.Group());
const r = rng(424242), nodes: Node[] = [];
const add = (x: number, z: number, spot: Spot | null = null) => {
  x = round(x); z = round(z); // 파일에 반올림해 쓰므로 판정도 그 자리로
  if (blocked(x, z)) return false;
  nodes.push({ x, z, spot, edges: [] });
  return true;
};
for (const t of world.trees) {
  if (Math.hypot(t.x, t.z) > WORLD - 2) continue;
  const a = r() * Math.PI * 2;
  add(t.x + Math.sin(a) * 0.9, t.z + Math.cos(a) * 0.9, { x: round(t.x), z: round(t.z), kind: TREE });
}
// 꽃: 꽃송이에서 0.7m 떨어진 자리에 서서 물을 준다
for (let k = 0; k < FLOWER_SPOTS && world.flowers.length; k++) {
  const f = world.flowers[Math.floor(r() * world.flowers.length)], a = r() * Math.PI * 2;
  if (Math.hypot(f.x, f.z) < WORLD - 2) add(f.x + Math.sin(a) * 0.7, f.z + Math.cos(a) * 0.7, { x: round(f.x), z: round(f.z), kind: FLOWER });
}
// 물고기 터: 터 가운데에서 가장 가까운 물가(걸을 수 있는 땅)에 서서 먹이를 던진다
for (const p of fishPonds(false)) {
  let found = false;
  for (let d = 2; d <= 8 && !found; d += 0.5) for (let k = 0; k < 24 && !found; k++) {
    const a = (k / 24) * Math.PI * 2;
    found = add(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, { x: round(p.x), z: round(p.z), kind: POND });
  }
}
// 무작위 점으로는 좁은 다리 위가 잘 이어지지 않으므로 다리 가운데 줄을 따라 점을 놓는다
for (const [bx, z0, z1] of bridgeLines()) for (let z = z0 - 2; z <= z1 + 2; z += 3) add(bx, z);
for (let n = 0, tries = 0; n < FILL && tries < FILL * 10; tries++) {
  const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (WORLD - 1), before = nodes.length;
  add(Math.cos(a) * d, Math.sin(a) * d);
  if (nodes.length > before) n++;
}
const cell = new Map<string, number[]>();
nodes.forEach((p, i) => { const k = `${Math.floor(p.x / LINK)},${Math.floor(p.z / LINK)}`; (cell.get(k) ?? cell.set(k, []).get(k)!).push(i); });
nodes.forEach((p, i) => {
  const cx = Math.floor(p.x / LINK), cz = Math.floor(p.z / LINK);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? []) {
    const q = nodes[j];
    if (j > i && Math.hypot(q.x - p.x, q.z - p.z) <= LINK && clearPath(p.x, p.z, q.x, q.z)) { p.edges.push(j); q.edges.push(i); }
  }
});
// 가장 큰 덩어리(서로 오갈 수 있는 점들)만 쓴다
const comp = new Int32Array(nodes.length).fill(-1);
let best = -1, bestN = 0;
for (let s = 0, c = 0; s < nodes.length; s++) {
  if (comp[s] >= 0) continue;
  const stack = [s];
  let n = 0;
  comp[s] = c;
  while (stack.length) { const i = stack.pop()!; n++; for (const j of nodes[i].edges) if (comp[j] < 0) { comp[j] = c; stack.push(j); } }
  if (n > bestN) { bestN = n; best = c; }
  c++;
}
// 할 일별로 들를 수 있는 점
const spots = [TREE, FLOWER, POND].map((kind) => nodes.map((n, i) => (n.spot?.kind === kind && comp[i] === best ? i : -1)).filter((i) => i >= 0));
console.error(`spots: ${spots.map((l) => l.length).join(" / ")} (tree / flower / pond)`);

// a에서 b까지 가장 짧은 길(점 번호 목록, a 제외). 다익스트라 + 이진 힙
function path(a: number, b: number) {
  const dist = new Float64Array(nodes.length).fill(Infinity), prev = new Int32Array(nodes.length).fill(-1), heap: [number, number][] = [[0, a]];
  const up = (i: number) => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const down = (i: number) => {
    for (;;) {
      const l = i * 2 + 1, rr = l + 1;
      let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
      if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
      if (m === i) return;
      [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
    }
  };
  dist[a] = 0;
  while (heap.length) {
    const [d, i] = heap[0], last = heap.pop()!;
    if (heap.length) { heap[0] = last; down(0); }
    if (i === b) break;
    if (d > dist[i]) continue;
    for (const j of nodes[i].edges) {
      const nd = d + Math.hypot(nodes[j].x - nodes[i].x, nodes[j].z - nodes[i].z);
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push([nd, j]); up(heap.length - 1); }
    }
  }
  const out: number[] = [];
  for (let i = b; i !== a && i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

// ── 한 바퀴: 자기 구역의 나무·꽃·물고기 터를 STOPS곳 차례로 들르고(가끔 구역 밖) 처음 자리로 돌아온다 ──
// 기록: 양수 k는 점 k로 이동, 음수 -(k+1)은 점 k에서 그 점의 할 일
const own = spots.map((list) => {
  const byHome: number[][] = HOMES.map(() => []);
  for (const t of list) {
    let h = 0, bd = Infinity;
    HOMES.forEach(([hx, hz], k) => { const d = Math.hypot(nodes[t].x - hx, nodes[t].z - hz); if (d < bd) { bd = d; h = k; } });
    byHome[h].push(t);
  }
  return byHome;
});
const tours: number[][] = [];
for (let i = 0; i < COUNT; i++) {
  const rr = rng(9000 + i * 77);
  const mine = (kind: number) => (own[kind][i].length ? own[kind][i] : spots[kind]);
  const start = mine(TREE)[Math.floor(rr() * mine(TREE).length)], tour = [start];
  let at = start;
  const go = (to: number) => { for (const j of path(at, to)) { tour.push(j); at = j; } };
  const done = [0, 0, 0];
  for (let k = 0; k < STOPS; k++) {
    const u = rr();
    let kind = u < KIND_SHARE[0] ? TREE : u < KIND_SHARE[0] + KIND_SHARE[1] ? FLOWER : POND;
    if (kind === POND && !own[POND][i].length && rr() > 0.3) kind = TREE; // 제 구역에 물고기 터가 없으면 멀리 가는 일은 드물게
    const list = mine(kind);
    let to = spots[kind][Math.floor(rr() * spots[kind].length)];
    if (rr() > AWAY) { // 구역 안에서는 가까운 곳을 더 자주 고른다
      let bd = Infinity;
      for (let n = 0; n < 8; n++) {
        const c = list[Math.floor(rr() * list.length)], d = Math.hypot(nodes[c].x - nodes[at].x, nodes[c].z - nodes[at].z);
        if (c !== at && d < bd) { bd = d; to = c; }
      }
    }
    go(to);
    tour.push(-(at + 1));
    done[kind]++;
  }
  go(start);
  tours.push(tour);
  console.error(`npc ${i}: ${tour.length} steps, tree ${done[0]} / flower ${done[1]} / pond ${done[2]}`);
}

// 쓰인 점만 다시 번호 매겨 쓴다. 점은 [x, z] 또는 할 일이 있으면 [x, z, 대상 x, 대상 z, 할 일]
const used = new Map<number, number>(), points: number[][] = [];
const id = (k: number) => {
  if (!used.has(k)) { const n = nodes[k]; used.set(k, points.length); points.push(n.spot ? [n.x, n.z, n.spot.x, n.spot.z, n.spot.kind] : [n.x, n.z]); }
  return used.get(k)!;
};
const out = { points, tours: tours.map((t) => t.map((k) => (k < 0 ? -(id(-k - 1) + 1) : id(k)))) };
writeFileSync("lib/three/npc-paths.json", JSON.stringify(out) + "\n");
console.error(`${nodes.length} nodes (${bestN} connected), ${points.length} used points`);
