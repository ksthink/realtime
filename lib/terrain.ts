// 지형은 순수 함수. 캐릭터·돌·탑·카메라가 전부 같은 함수로 땅 높이를 구한다.
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const WORLD = 120; // 걸을 수 있는 반경
export const WATER_Y = -1.55; // 개울 수면 높이

const hashN = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hashN(xi, yi), hashN(xi + 1, yi), u), lerp(hashN(xi, yi + 1), hashN(xi + 1, yi + 1), u), v);
}
const fbm = (x: number, y: number) =>
  (vnoise(x, y) * 0.5 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.25 + vnoise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.125) / 0.875 - 0.5;

const RIVERS = [
  (x: number) => 11 + 5.5 * Math.sin(x * 0.085) + 2.5 * Math.sin(x * 0.23 + 1.2),
  (x: number) => -34 + 7 * Math.sin(x * 0.06 + 2) + 3 * Math.sin(x * 0.19),
];
// minus·plus: 강 중심에서 z- 쪽, z+ 쪽으로 뻗는 길이. 강 옆 웅덩이나 습지까지 지나 땅에 닿게 한다
const BRIDGES = [
  { x: -1, river: 0, minus: 6.5, plus: 6.5 }, { x: 22, river: 0, minus: 6.5, plus: 24 },
  { x: -26, river: 0, minus: 6.5, plus: 6.5 }, { x: 50, river: 0, minus: 6.5, plus: 6.5 },
  { x: 4, river: 1, minus: 7.5, plus: 19 }, { x: -40, river: 1, minus: 19.5, plus: 7 },
  { x: 38, river: 1, minus: 11.5, plus: 7.5 },
];

// 동산: 꼭대기(plateauR 안)가 topY로 평평한 언덕. stairs는 꼭대기에서 계단이 뻗는 방향(라디안).
// 반경 r 밖에서는 땅이 그대로이고, 비탈은 계단으로만 오르내린다
export const HILL = { x: 28, z: -12, r: 18, plateauR: 6.5, topY: 7.5, stairs: [2.74, -0.4], stairHalf: 0.6 };
// 계단: 디딤판 깊이·반폭, 가운데 줄에서 난간까지, 디딤판 밑 땅을 그릴 때 낮추는 깊이. 디딤판은 꼭대기 가장자리 0.3m 안쪽에서 시작한다
export const STAIR = { tread: 0.22, half: 1.3, rail: 1.4, dip: 0.14, d0: HILL.plateauR - 0.3 };
const STAIR_END = Math.floor((HILL.r - 0.7 - STAIR.d0) / STAIR.tread) * STAIR.tread + STAIR.d0; // 마지막 디딤판 앞 끝
// 계단 길 높이(0~1): 고른 경사로 오르고 양 끝 1.2m쯤은 둥글게 꺾어 땅 격자에서 모서리가 뭉개지지 않게 한다
const EASE = 0.11;
const stairLine = (t: number) => {
  const v = 1 / (1 - EASE);
  return t < EASE ? (v * t * t) / (2 * EASE) : t > 1 - EASE ? 1 - (v * (1 - t) * (1 - t)) / (2 * EASE) : v * (t - EASE / 2);
};
// 비탈은 부드럽게 오르고, 계단 길은 고르게 올라 마지막 디딤판에서 땅에 닿는다. 길 옆 2.2~4m에서 둘을 섞는다
const hillW = (x: number, z: number) => {
  const dx = x - HILL.x, dz = z - HILL.z, d = Math.hypot(dx, dz);
  const t = clamp((HILL.r - d) / (HILL.r - HILL.plateauR), 0, 1), line = stairLine(clamp((STAIR_END - d) / (STAIR_END - HILL.plateauR), 0, 1));
  let w = t * t * (3 - 2 * t);
  for (const a of HILL.stairs) {
    if (dx * Math.cos(a) + dz * Math.sin(a) <= 0) continue;
    const k = clamp((Math.abs(dz * Math.cos(a) - dx * Math.sin(a)) - 2.2) / 1.8, 0, 1);
    w += (line - w) * (1 - k * k * (3 - 2 * k));
  }
  return w;
};

// 다리 옆이 마른 땅이나 얕은 물이면 판 가장자리에서 BANK m에 걸쳐 둑으로 이어 붙인다. 깊은 물 위는 그대로 다리 옆면이 선다
const BANK = 1.6;
// 다리 옆 수면 높이의 얕은 습지를 마른 풀밭으로 메운다: [x0, x1, z0, z1] 안은 수면보다 FILL_Y 위, 바깥 FILL_EDGE m에 걸쳐 원래 땅으로
const FILLS = [[-2.6, 2.6, -18.2, -7.6], [-44.8, -41.6, -57.5, -49]], FILL_Y = 0.22, FILL_EDGE = 1.2;
const ease01 = (u: number) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

// 가장자리 산줄기: WORLD - 6부터 솟아 r 127쯤에서 8~16m 봉우리가 되고, 그 너머는 낮아져 땅 끝이 능선 뒤로 숨는다.
// 봉우리 높이는 방향(각도)과 잡음으로 들쭉날쭉하다. 너무 높으면 먼 산 배경을 가린다
export function rimY(x: number, z: number) {
  const r = Math.hypot(x, z);
  if (r <= WORLD - 6) return 0;
  const a = Math.atan2(z, x);
  const peak = 12 + 2.5 * Math.sin(3 * a + 1.3) + 1.5 * Math.sin(7 * a + 0.4) + fbm(x * 0.05 + 11, z * 0.05 + 4) * 3;
  const up = ease01((r - (WORLD - 6)) / 13), down = 1 - 0.7 * ease01((r - 127) / 14);
  return (peak + fbm(x * 0.14 + 7, z * 0.14 + 2) * 2) * up * down;
}

// 동산을 얹기 전 땅. banks가 false면 둑·습지 메우기 전(예전 식생 자리를 고를 때 쓴다)
export function baseTerrainY(x: number, z: number, banks = true) {
  const r = Math.hypot(x, z);
  let h = fbm(x * 0.04, z * 0.04) * 6.5 + fbm(x * 0.16 + 3, z * 0.16 + 8) * 0.7;
  const dvs = RIVERS.map((f) => z - f(x));
  for (const dv of dvs) h += -3.4 * Math.exp(-(dv * dv) / (5.2 * 5.2)); // 계곡
  const flat = clamp((r - 3) / 6, 0, 1);
  h *= flat * flat * (3 - 2 * flat); // 시작 지점은 평평하게
  h += rimY(x, z); // 가장자리 산
  if (banks) {
    for (const [x0, x1, z0, z1] of FILLS) {
      const w = ease01((FILL_EDGE - Math.max(x0 - x, x - x1, 0)) / FILL_EDGE) * ease01((FILL_EDGE - Math.max(z0 - z, z - z1, 0)) / FILL_EDGE);
      if (w > 0) h = Math.max(h, h + (WATER_Y + FILL_Y - h) * w);
    }
    for (const b of BRIDGES) {
      const dv = dvs[b.river], side = Math.abs(x - b.x) - 1.6, end = Math.max(-b.minus - dv, dv - b.plus);
      const d = Math.hypot(Math.max(side, 0), Math.max(end, 0));
      // 수면 0.4m보다 깊은 물에는 둑을 쌓지 않는다. 그 경계는 물속이라 걸어서 닿지 않고, 걸어 들어갈 수 있는 곳은 늘 둑이 된다
      if (d >= BANK || h < WATER_Y - 0.4) continue;
      h = Math.max(h, h + (WATER_Y + 0.45 - h) * (1 - ease01(d / BANK)));
    }
  }
  for (const b of BRIDGES) if (Math.abs(x - b.x) < 1.6 && dvs[b.river] > -b.minus && dvs[b.river] < b.plus) h = Math.max(h, WATER_Y + 0.45); // 돌다리
  return h;
}
export function terrainY(x: number, z: number) {
  const h = baseTerrainY(x, z), w = hillW(x, z);
  return w > 0 ? h + (HILL.topY - h) * w : h;
}
// 동산 비탈과 꼭대기 나무 밑동이면 true. 꼭대기 울타리 안, 계단 위, 높이가 거의 없는 산자락은 걸을 수 있다.
// 몸통(중심에서 0.73m)이 나무·울타리·난간을 뚫지 않게 그만큼 안쪽에서 막는다
export function hillBlocked(x: number, z: number) {
  const dx = x - HILL.x, dz = z - HILL.z, d = Math.hypot(dx, dz);
  if (d < 1.45) return true;
  if (d < HILL.plateauR - 0.75 || hillW(x, z) < 0.06) return false;
  return !HILL.stairs.some((a) => dx * Math.cos(a) + dz * Math.sin(a) > 0 && Math.abs(dz * Math.cos(a) - dx * Math.sin(a)) < HILL.stairHalf);
}
export const isWater = (x: number, z: number) => terrainY(x, z) < WATER_Y + 0.12;

const stairFrame = (x: number, z: number, a: number) => {
  const dx = x - HILL.x, dz = z - HILL.z;
  return { along: dx * Math.cos(a) + dz * Math.sin(a), lat: dz * Math.cos(a) - dx * Math.sin(a) };
};
const stairAt = (a: number, along: number, lat: number) => [HILL.x + Math.cos(a) * along - Math.sin(a) * lat, HILL.z + Math.sin(a) * along + Math.cos(a) * lat] as const;
// 디딤판 밑 땅은 그려지는 높이를 조금 낮춰 풀이 판을 뚫고 나오지 않게 한다. 계단 발치에서는 땅과 같아진다
export function stairDip(x: number, z: number) {
  let k = 0;
  for (const a of HILL.stairs) {
    const { along, lat } = stairFrame(x, z, a);
    if (along < HILL.plateauR - 0.4 || along > STAIR_END) continue;
    const ends = clamp((along - HILL.plateauR + 0.4) / 0.7, 0, 1) * clamp((STAIR_END - along) / 1.2, 0, 1);
    const side = 1 - clamp((Math.abs(lat) - STAIR.half - 0.1) / 1.2, 0, 1);
    k = Math.max(k, ends * side * side * (3 - 2 * side));
  }
  return STAIR.dip * k;
}
// 계단마다 디딤판 윗면 높이. 가운데 땅보다 살짝 위, 옆으로 기운 땅도 덮는다
export const TREADS = HILL.stairs.map((a) => {
  const n = Math.round((STAIR_END - STAIR.d0) / STAIR.tread), tops: number[] = [];
  const g = (along: number, lat: number) => { const [x, z] = stairAt(a, along, lat); return terrainY(x, z) - stairDip(x, z); };
  for (let i = 0; i < n; i++) {
    const d = STAIR.d0 + STAIR.tread * (i + 0.5), back = d - STAIR.tread / 2;
    tops.push(Math.max(terrainY(...stairAt(a, d, 0)) + 0.02, g(back, -STAIR.half) + 0.09, g(back, STAIR.half) + 0.09));
  }
  return tops;
});
// 디딤판 위면 그 높이, 아니면 null. 턱 근처와 판 옆 가장자리에서는 부드럽게 넘어가고, 처음과 끝은 땅과 잇는다
function treadY(x: number, z: number) {
  const ease = (u: number) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  for (let s = 0; s < HILL.stairs.length; s++) {
    const { along, lat } = stairFrame(x, z, HILL.stairs[s]), tops = TREADS[s], last = tops.length - 1;
    if (Math.abs(lat) > STAIR.half || along < STAIR.d0 || along > STAIR_END + STAIR.tread) continue;
    const ground = terrainY(x, z) - stairDip(x, z), f = (along - STAIR.d0) / STAIR.tread - 0.5, i = Math.floor(f);
    const y = i < 0 ? ground + (tops[0] - ground) * ease((f + 0.45) / 0.4)
      : i >= last ? tops[last] + (ground - tops[last]) * ease((f - last - 0.1) / 1.4) // 마지막 판에서 땅으로는 조금 길게 내려선다
      : tops[i] + (tops[i + 1] - tops[i]) * ease((f - i - 0.1) / 0.8);
    return y + (ground - y) * ease((Math.abs(lat) - STAIR.half + 0.25) / 0.25);
  }
  return null;
}
// 계단 디딤판이나 그 둘레(땅을 낮춘 곳)면 true. 돌을 놓지 않는다
export const onStairs = (x: number, z: number) => stairDip(x, z) > 0 || treadY(x, z) !== null;

// 얕은 물웅덩이(가장 깊은 곳 0.51m 이하, 강·호수는 0.96m 이상). 이 원 안의 물은 걸어서 지나갈 수 있다.
// [x, z, 반경] — 지형을 바꾸면 물의 덩어리별 최대 깊이로 다시 골라야 한다
const PUDDLES = [
  [-91.5, -13.3, 1.5], [-87.2, -50.3, 2.6], [-84.3, -15.6, 2.3], [-75.4, -3.3, 1.7], [-56.3, -18.0, 10.5], [-50.1, -76.9, 3.5],
  [-43.0, -54.6, 3.7], [-25.4, 91.7, 5.5], [-17.5, 20.7, 2.5], [6.2, 102.6, 14.4], [11.5, 90.8, 2.5], [28.4, 106.1, 1.0],
  [52.0, -93.9, 13.2], [56.5, -19.1, 6.5], [73.7, -71.5, 13.8], [88.3, -50.6, 0.7], [92.8, -44.5, 3.8], [102.2, -45.5, 12.5],
];
// 걸어서 지나갈 수 있는 물: 웅덩이 전체와, 강·호수라도 깊이 WADE_DEPTH 미만인 물가·습지.
// 수면과 거의 같은 높이라 물인지 잘 보이지 않는 땅에서 막히지 않게 한다
export const WADE_DEPTH = 0.25;
export const canWade = (x: number, z: number) => {
  const y = terrainY(x, z);
  return y < WATER_Y + 0.12 && (y > WATER_Y - WADE_DEPTH || PUDDLES.some(([px, pz, r]) => (x - px) ** 2 + (z - pz) ** 2 < r * r));
};
// 캐릭터가 딛는 높이. 웅덩이에서는 발목만 잠기게 물 바닥 대신 수면 바로 아래를 딛는다
// 계단에서는 디딤판을, 계단 둘레에서는 낮춰 그린 땅을 딛는다
export const walkY = (x: number, z: number) => {
  const t = treadY(x, z);
  if (t !== null) return t;
  const y = terrainY(x, z);
  return y < WATER_Y - 0.1 && canWade(x, z) ? WATER_Y - 0.1 : y - stairDip(x, z);
};

// 가장 가까운 물까지의 대략적인 거리(미터). 주변을 고리 모양으로 살핀다. 범위 안에 없으면 Infinity
export function waterDistance(x: number, z: number, range = 24) {
  if (isWater(x, z)) return 0;
  for (let r = 2; r <= range; r += 2) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return r;
    }
  }
  return Infinity;
}
