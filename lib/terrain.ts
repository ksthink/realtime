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
export const HILL = { x: 28, z: -12, r: 18, plateauR: 6.5, topY: 7.5, stairs: [2.74, -0.4], stairHalf: 0.55 };
// 비탈은 부드럽게 오르고, 계단 길은 고른 경사로 곧게 오른다. 길 옆 1.6~3.4m에서 둘을 섞는다
const hillW = (x: number, z: number) => {
  const dx = x - HILL.x, dz = z - HILL.z;
  const t = clamp((HILL.r - Math.hypot(dx, dz)) / (HILL.r - HILL.plateauR), 0, 1);
  let w = t * t * (3 - 2 * t);
  for (const a of HILL.stairs) {
    if (dx * Math.cos(a) + dz * Math.sin(a) <= 0) continue;
    const k = clamp((Math.abs(dz * Math.cos(a) - dx * Math.sin(a)) - 1.6) / 1.8, 0, 1);
    w += (t - w) * (1 - k * k * (3 - 2 * k));
  }
  return w;
};

// 동산을 얹기 전 땅
export function baseTerrainY(x: number, z: number) {
  const r = Math.hypot(x, z);
  let h = fbm(x * 0.04, z * 0.04) * 6.5 + fbm(x * 0.16 + 3, z * 0.16 + 8) * 0.7;
  const dvs = RIVERS.map((f) => z - f(x));
  for (const dv of dvs) h += -3.4 * Math.exp(-(dv * dv) / (5.2 * 5.2)); // 계곡
  const flat = clamp((r - 3) / 6, 0, 1);
  h *= flat * flat * (3 - 2 * flat); // 시작 지점은 평평하게
  if (r > WORLD - 6) h += Math.pow((r - (WORLD - 6)) / 6, 2) * 7; // 가장자리 산
  for (const b of BRIDGES) if (Math.abs(x - b.x) < 1.6 && dvs[b.river] > -b.minus && dvs[b.river] < b.plus) h = Math.max(h, WATER_Y + 0.45); // 돌다리
  return h;
}
export function terrainY(x: number, z: number) {
  const h = baseTerrainY(x, z), w = hillW(x, z);
  return w > 0 ? h + (HILL.topY - h) * w : h;
}
// 동산 비탈과 꼭대기 나무 밑동이면 true. 꼭대기 울타리 안, 계단 위, 높이가 거의 없는 산자락은 걸을 수 있다
export function hillBlocked(x: number, z: number) {
  const dx = x - HILL.x, dz = z - HILL.z, d = Math.hypot(dx, dz);
  if (d < 1.1) return true;
  if (d < HILL.plateauR - 0.45 || hillW(x, z) < 0.06) return false;
  return !HILL.stairs.some((a) => dx * Math.cos(a) + dz * Math.sin(a) > 0 && Math.abs(dz * Math.cos(a) - dx * Math.sin(a)) < HILL.stairHalf);
}
export const isWater = (x: number, z: number) => terrainY(x, z) < WATER_Y + 0.12;

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
