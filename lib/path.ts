import { WORLD } from "./terrain";

// 탭으로 걸을 때 강·동산 비탈 같은 막힌 곳을 돌아가는 길을 찾는다(격자 위 A*).
// 칸이 걸을 수 있는지는 처음 볼 때 한 번만 계산해 둔다(지형은 바뀌지 않는다)
const CELL = 0.5;
const N = Math.ceil((WORLD * 2) / CELL) + 1;
const MAX_EXPAND = 120000; // 이보다 많이 찾아도 못 가면 가장 가까이 갈 수 있는 곳까지만 간다
const SQ2 = Math.SQRT2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export type PathPoint = { x: number; z: number };

export function makePathfinder(walkable: (x: number, z: number) => boolean) {
  const cache = new Int8Array(N * N); // 0 아직 모름, 1 걸을 수 있음, 2 막힘
  const g = new Float32Array(N * N);
  const from = new Int32Array(N * N);
  const stamp = new Uint32Array(N * N); // 이번 찾기에서 g·from을 쓴 칸인지(배열을 매번 비우지 않는다)
  const closed = new Uint32Array(N * N);
  let gen = 0;

  const cx = (k: number) => (k % N) * CELL - WORLD;
  const cz = (k: number) => Math.floor(k / N) * CELL - WORLD;
  const idx = (x: number, z: number) => {
    const i = Math.round((x + WORLD) / CELL), j = Math.round((z + WORLD) / CELL);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  };
  const ok = (k: number) => {
    if (k < 0) return false;
    let c = cache[k];
    if (!c) {
      // 칸보다 얇게 막힌 곳(물가의 꺼진 땅 줄 등)을 놓치지 않게 가운데와 둘레 네 점을 모두 본다
      const x = cx(k), z = cz(k), r = CELL * 0.4;
      cache[k] = c = walkable(x, z) && walkable(x + r, z) && walkable(x - r, z) && walkable(x, z + r) && walkable(x, z - r) ? 1 : 2;
    }
    return c === 1;
  };
  const okAt = (x: number, z: number) => ok(idx(x, z));
  // 두 점 사이를 곧장 걸어갈 수 있는지
  const clear = (ax: number, az: number, bx: number, bz: number) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2);
    for (let i = 1; i <= n; i++) if (!okAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false;
    return true;
  };

  // (sx, sz)에서 (tx, tz)로 가는 꺾이는 점들. reached가 false면 목표에 닿지 못해 가장 가까운 곳까지의 길이다
  function find(sx: number, sz: number, tx: number, tz: number): { pts: PathPoint[]; reached: boolean } {
    if (clear(sx, sz, tx, tz)) return { pts: [{ x: tx, z: tz }], reached: true };
    const s = idx(sx, sz), t = idx(tx, tz);
    if (s < 0) return { pts: [], reached: false };
    gen++;
    const ti = t % N, tj = Math.floor(t / N);
    const h = (k: number) => {
      const dx = Math.abs((k % N) - ti), dz = Math.abs(Math.floor(k / N) - tj);
      return (Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz)) * CELL;
    };
    // 이진 힙(f가 작은 칸부터)
    const heap: number[] = [], hf: number[] = [];
    const push = (k: number, f: number) => {
      let i = heap.length;
      heap.push(k); hf.push(f);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hf[p] <= f) break;
        heap[i] = heap[p]; hf[i] = hf[p]; i = p;
      }
      heap[i] = k; hf[i] = f;
    };
    const pop = () => {
      const top = heap[0], k = heap.pop()!, f = hf.pop()!;
      if (heap.length) {
        let i = 0;
        for (;;) {
          let c = i * 2 + 1;
          if (c >= heap.length) break;
          if (c + 1 < heap.length && hf[c + 1] < hf[c]) c++;
          if (hf[c] >= f) break;
          heap[i] = heap[c]; hf[i] = hf[c]; i = c;
        }
        heap[i] = k; hf[i] = f;
      }
      return top;
    };

    stamp[s] = gen; g[s] = 0; from[s] = -1;
    push(s, h(s));
    let best = s, bestH = h(s), found = -1, expanded = 0;
    while (heap.length && expanded < MAX_EXPAND) {
      const k = pop();
      if (closed[k] === gen) continue;
      closed[k] = gen;
      expanded++;
      if (k === t) { found = k; break; }
      const hk = h(k);
      if (hk < bestH) { bestH = hk; best = k; }
      const i = k % N, j = Math.floor(k / N);
      for (const [di, dj] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (closed[nk] === gen || !ok(nk)) continue;
        // 모서리를 비스듬히 질러가지 않는다(몸이 막힌 곳에 걸린다)
        if (di && dj && (!ok(j * N + ni) || !ok(nj * N + i))) continue;
        const ng = g[k] + (di && dj ? SQ2 : 1) * CELL;
        if (stamp[nk] === gen && ng >= g[nk]) continue;
        stamp[nk] = gen; g[nk] = ng; from[nk] = k;
        push(nk, ng + h(nk));
      }
    }

    const end = found >= 0 ? found : best;
    const cells: PathPoint[] = [];
    for (let k = end; k !== -1 && k !== s; k = from[k]) cells.push({ x: cx(k), z: cz(k) });
    cells.reverse();
    if (found >= 0) cells[cells.length - 1] = { x: tx, z: tz };
    // 곧장 갈 수 있는 점은 건너뛰어 꺾이는 곳만 남긴다
    const pts: PathPoint[] = [];
    let ax = sx, az = sz, i = 0;
    while (i < cells.length) {
      let j = i;
      while (j + 1 < cells.length && clear(ax, az, cells[j + 1].x, cells[j + 1].z)) j++;
      pts.push(cells[j]);
      ax = cells[j].x; az = cells[j].z;
      i = j + 1;
    }
    if (found < 0) pts.push({ x: tx, z: tz }); // 못 닿아도 가장 가까운 곳까지 간 뒤 남은 길은 곧장 걸어 본다
    return { pts, reached: found >= 0 };
  }

  // 칸 판정을 프레임마다 조금씩(ms 안에서) 미리 해 둔다. 처음 먼 곳을 탭할 때 판정을 몰아서 하느라 멈칫하지 않게
  let warmAt = 0;
  function warm(ms: number) {
    if (warmAt >= N * N) return;
    const end = performance.now() + ms;
    while (warmAt < N * N) {
      for (let i = 0; i < 8 && warmAt < N * N; i++) ok(warmAt++);
      if (performance.now() > end) break;
    }
  }

  return { find, warm };
}
