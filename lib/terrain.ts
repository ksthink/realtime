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

export const WORLD = 80; // 걸을 수 있는 반경
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
const BRIDGES = [
  { x: -1, river: 0 }, { x: 22, river: 0 }, { x: -26, river: 0 }, { x: 50, river: 0 },
  { x: 4, river: 1 }, { x: -40, river: 1 }, { x: 38, river: 1 },
];

export function terrainY(x: number, z: number) {
  const r = Math.hypot(x, z);
  let h = fbm(x * 0.04, z * 0.04) * 6.5 + fbm(x * 0.16 + 3, z * 0.16 + 8) * 0.7;
  const dvs = RIVERS.map((f) => z - f(x));
  for (const dv of dvs) h += -3.4 * Math.exp(-(dv * dv) / (5.2 * 5.2)); // 계곡
  const flat = clamp((r - 3) / 6, 0, 1);
  h *= flat * flat * (3 - 2 * flat); // 시작 지점은 평평하게
  if (r > WORLD - 6) h += Math.pow((r - (WORLD - 6)) / 6, 2) * 7; // 가장자리 산
  for (const b of BRIDGES) if (Math.abs(x - b.x) < 1.6 && Math.abs(dvs[b.river]) < 6.5) h = Math.max(h, WATER_Y + 0.45); // 돌다리
  return h;
}
export const isWater = (x: number, z: number) => terrainY(x, z) < WATER_Y + 0.12;
