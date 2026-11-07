import * as THREE from "three";

// 서울의 실제 해·달 자리와 그에 따른 하늘빛. 모든 사람이 같은 순간(UTC)을 보므로 기기 시간대와 상관없이 같은 하늘이다.
// 방위: 북쪽은 산줄기의 백두산 쪽(atan2(z, x) = NORTH), 동쪽은 위에서 내려다볼 때 북쪽에서 시계 방향으로 90°.
// 시험용: ?time=19:30(한국 시각, 멈춤), ?date=2026-06-21, ?speed=600(그 시각부터 600배로 흐름)

const LAT = 37.5665, LON = 126.978, RAD = Math.PI / 180;
const NORTH = 0.75; // 북쪽 방향(라디안, atan2(z, x)). skyline.ts의 백두산(1.05)·한라산(-1.95)과 맞춘다
export const N_AXIS = new THREE.Vector3(Math.cos(NORTH), 0, Math.sin(NORTH));
export const E_AXIS = new THREE.Vector3(-Math.sin(NORTH), 0, Math.cos(NORTH));
// 그림자 빛의 높이를 이만큼 아래로는 내리지 않는다. 아침·저녁 해는 낮게 둬 그림자가 길게 늘어지고, 달은 높게 둬 밤이 어수선하지 않게 한다
const SHADOW_MIN = Math.sin(9 * RAD), SHADOW_MIN_MOON = Math.sin(18 * RAD);

// ───────── 시계 ─────────
function makeClock() {
  const q = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
  const time = q.get("time"), date = q.get("date");
  if (!time && !date) return () => Date.now();
  const kst = new Date(Date.now() + 9 * 3600e3); // 한국 날짜·시각을 UTC 필드로 읽는다
  const [y, m, d] = date ? date.split("-").map(Number) : [kst.getUTCFullYear(), kst.getUTCMonth() + 1, kst.getUTCDate()];
  const [hh, mm] = time ? time.split(":").map(Number) : [kst.getUTCHours(), kst.getUTCMinutes()];
  const base = Date.UTC(y, m - 1, d, hh - 9, mm || 0), t0 = performance.now();
  const speed = Number(q.get("speed") ?? (time ? 0 : 1));
  return () => base + (performance.now() - t0) * speed;
}

// ───────── 천체 위치(Schlyter의 간단한 식, 1° 안쪽) ─────────
const sinD = (a: number) => Math.sin(a * RAD), cosD = (a: number) => Math.cos(a * RAD);
const rev = (a: number) => a - Math.floor(a / 360) * 360;

// 적도좌표(적경·적위, 도) → 서울 하늘의 월드 방향. lst: 지방 항성시(도)
const _m = new THREE.Matrix4();
export function skyBasis(lst: number, out: THREE.Matrix4) {
  const sl = sinD(lst), cl = cosD(lst), sp = sinD(LAT), cp = cosD(LAT), E = E_AXIS, N = N_AXIS;
  // 적도 X(춘분점)·Y·Z(천구 북극)가 가리키는 월드 방향을 열로 둔다
  return out.set(
    -sl * E.x - sp * cl * N.x, cl * E.x - sp * sl * N.x, cp * N.x, 0,
    cp * cl, cp * sl, sp, 0,
    -sl * E.z - sp * cl * N.z, cl * E.z - sp * sl * N.z, cp * N.z, 0,
    0, 0, 0, 1,
  );
}
function eqDir(ra: number, dec: number, out: THREE.Vector3) {
  return out.set(cosD(dec) * cosD(ra), cosD(dec) * sinD(ra), sinD(dec)).applyMatrix4(_m);
}
// 황도좌표(도) → 적도좌표 → 월드 방향
function eclDir(lon: number, lat: number, ecl: number, out: THREE.Vector3) {
  const x = cosD(lat) * cosD(lon), y0 = cosD(lat) * sinD(lon), z0 = sinD(lat);
  const y = y0 * cosD(ecl) - z0 * sinD(ecl), z = y0 * sinD(ecl) + z0 * cosD(ecl);
  return eqDir(Math.atan2(y, x) / RAD, Math.asin(z) / RAD, out);
}

// ───────── 하늘빛 열쇠 ─────────
// 해 높이(도)마다 하나. 아침(해가 동쪽)과 저녁(서쪽)을 따로 둬 새벽과 황혼의 빛깔이 다르다. 24° 위는 오늘의 낮 그대로
type Key = { h: number; night: number; zen: string; hor: string; hs: string; hg: string; hi: number; lc: string; li: number; mtn: string; wc: string; wk: number; gc: string; gk: number; sc: string };
// 해가 낮을수록 곧은 빛(lc·li)은 따뜻하고 세게, 하늘빛(hs·hi)은 푸르스름하고 약하게 둬서 빛 받는 쪽과 그늘 쪽의 빛깔이 갈린다
const NIGHT: Omit<Key, "h"> = { night: 1, zen: "#1f2d55", hor: "#3a4b74", hs: "#9aa8dc", hg: "#76809e", hi: 0.92, lc: "#b8c6f4", li: 0.7, mtn: "#56648e", wc: "#3c4c7a", wk: 0.38, gc: "#8a94c4", gk: 0, sc: "#ffe6b8" };
const DAY: Omit<Key, "h"> = { night: 0, zen: "#d9e3ef", hor: "#d9e3ef", hs: "#f3ecdf", hg: "#b9c9b4", hi: 1.6, lc: "#ffe9c9", li: 3, mtn: "#ffffff", wc: "#d9e3ef", wk: 0, gc: "#ffffff", gk: 0, sc: "#fff4d6" };
const MORNING: Key[] = [
  { h: -12, ...NIGHT },
  { h: -8, night: 0.8, zen: "#3e4f84", hor: "#6f7aa8", hs: "#aab2e2", hg: "#848aa8", hi: 1.0, lc: "#c8c4ee", li: 0.55, mtn: "#7c86b2", wc: "#5e6c9e", wk: 0.28, gc: "#c9b5d6", gk: 0.2, sc: "#ffe2b0" }, // 새벽
  { h: -3, night: 0.55, zen: "#9ba7d4", hor: "#dbc6d8", hs: "#c6c4ea", hg: "#a49cb4", hi: 1.15, lc: "#f4c4cc", li: 0.75, mtn: "#bcb6d2", wc: "#aaa4cc", wk: 0.22, gc: "#f3c4c0", gk: 0.5, sc: "#ffd8a6" },
  { h: 1, night: 0.35, zen: "#b6c1e2", hor: "#f2cfc2", hs: "#cdd0ee", hg: "#c4b4ac", hi: 1.18, lc: "#ffbea2", li: 3.0, mtn: "#dccbd8", wc: "#f0bcaa", wk: 0.18, gc: "#ffc29a", gk: 0.7, sc: "#ffd29c" }, // 일출
  { h: 6, night: 0.15, zen: "#c5d1ea", hor: "#f0ddd0", hs: "#d8dcf0", hg: "#c6bfae", hi: 1.25, lc: "#ffcca6", li: 3.6, mtn: "#f0dfe0", wc: "#f2cbb6", wk: 0.1, gc: "#ffd1aa", gk: 0.45, sc: "#ffe2b2" },
  { h: 14, night: 0, zen: "#d2def0", hor: "#e2e6ec", hs: "#e8e6e6", hg: "#bcc6b2", hi: 1.45, lc: "#ffdcb8", li: 3.3, mtn: "#f8f5f2", wc: "#e6ddd6", wk: 0.04, gc: "#ffe3c4", gk: 0.15, sc: "#fff0d0" }, // 아침
  { h: 24, ...DAY },
];
const EVENING: Key[] = [
  { h: -12, ...NIGHT },
  { h: -8, night: 0.8, zen: "#38487e", hor: "#6a73a4", hs: "#a8aee2", hg: "#8a86a8", hi: 1.0, lc: "#d0bce8", li: 0.55, mtn: "#767fae", wc: "#56649a", wk: 0.3, gc: "#bba8d3", gk: 0.18, sc: "#ffd8a0" }, // 저녁
  { h: -3, night: 0.55, zen: "#9097cd", hor: "#d3b8d1", hs: "#c2bce8", hg: "#a898b0", hi: 1.15, lc: "#f8b8c0", li: 0.8, mtn: "#b3aacc", wc: "#a098c6", wk: 0.25, gc: "#f2b6b8", gk: 0.5, sc: "#ffc890" },
  { h: 1, night: 0.35, zen: "#b3b8dd", hor: "#f2c5ba", hs: "#cbc9ec", hg: "#c8b0a4", hi: 1.2, lc: "#ffae88", li: 3.2, mtn: "#d9bfcf", wc: "#eeb1a0", wk: 0.22, gc: "#ffb08c", gk: 0.8, sc: "#ffc48e" }, // 황혼
  { h: 6, night: 0.15, zen: "#c8cfe6", hor: "#f3d7c2", hs: "#d6d8ee", hg: "#cabaa4", hi: 1.25, lc: "#ffbf8e", li: 3.7, mtn: "#f0d8d2", wc: "#f4c4a2", wk: 0.13, gc: "#ffc792", gk: 0.55, sc: "#ffd89e" },
  { h: 14, night: 0, zen: "#d4dcec", hor: "#e8e2dc", hs: "#e8e4e4", hg: "#bec6ae", hi: 1.45, lc: "#ffd6aa", li: 3.35, mtn: "#f8f0ea", wc: "#eedcca", wk: 0.06, gc: "#ffd8b0", gk: 0.2, sc: "#fff0cc" },
  { h: 24, ...DAY },
];
const COLS = ["zen", "hor", "hs", "hg", "lc", "mtn", "wc", "gc", "sc"] as const;
const NUMS = ["night", "hi", "li", "wk", "gk"] as const;
type Col = (typeof COLS)[number];
const parse = (ks: Key[]) => ks.map((k) => ({ ...k, c: Object.fromEntries(COLS.map((n) => [n, new THREE.Color(k[n])])) as Record<Col, THREE.Color> }));
const KEYS = [parse(MORNING), parse(EVENING)];
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export type DayState = ReturnType<typeof makeDaytime>;

export function makeDaytime() {
  const clock = makeClock();
  const _c = new THREE.Color(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const col = Object.fromEntries(COLS.map((n) => [n, new THREE.Color()])) as Record<Col, THREE.Color>;
  const num = Object.fromEntries(NUMS.map((n) => [n, 0])) as Record<(typeof NUMS)[number], number>;
  const s = {
    ms: 0,
    hourKST: 0, // 한국 시각(0~24)
    sunAlt: 0, moonAlt: 0, // 높이(도)
    sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), // 하늘에서 보이는 방향(단위 벡터, 월드)
    moonLit: 0, // 달이 빛나는 비율(0 그믐 ~ 1 보름)
    lightDir: new THREE.Vector3(0, 1, 0), // 그림자 빛이 오는 방향(낮은 해, 밤은 달)
    starBasis: new THREE.Matrix4(), // 적도좌표 → 월드 회전(별자리용)
    night: 0, // 0 한낮 ~ 1 깊은 밤. 저녁·새벽 무렵 0.5 남짓
    sky: col.zen, horizon: col.hor, hemiSky: col.hs, hemiGround: col.hg, light: col.lc, mountain: col.mtn, water: col.wc, glow: col.gc, sunColor: col.sc,
    hemiI: 0, lightI: 0, waterK: 0, glowK: 0, starAlpha: 0,
    update() {
      const ms = (s.ms = clock());
      s.hourKST = (((ms / 3600e3 + 9) % 24) + 24) % 24;
      const d = ms / 864e5 + 2440587.5 - 2451543.5; // 2000-01-00 0h UT부터 날 수
      // 해
      const ws = 282.9404 + 4.70935e-5 * d, Ms = rev(356.047 + 0.9856002585 * d), ecl = 23.4393 - 3.563e-7 * d;
      const Es = Ms + (0.016709 / RAD) * sinD(Ms) * (1 + 0.016709 * cosD(Ms));
      const sunLon = rev(Math.atan2(Math.sqrt(1 - 0.016709 ** 2) * sinD(Es), cosD(Es) - 0.016709) / RAD + ws);
      const lst = rev(280.46061837 + 360.98564736629 * (d - 1.5) + LON);
      skyBasis(lst, _m);
      s.starBasis.copy(_m);
      eclDir(sunLon, 0, ecl, s.sunDir);
      // 달(큰 섭동항만)
      const Nm = 125.1228 - 0.0529538083 * d, wm = 318.0634 + 0.1643573223 * d, Mm = rev(115.3654 + 13.0649929509 * d), e = 0.0549, i = 5.1454;
      let E = Mm + (e / RAD) * sinD(Mm) * (1 + e * cosD(Mm));
      E -= (E - (e / RAD) * sinD(E) - Mm) / (1 - e * cosD(E));
      const xv = cosD(E) - e, yv = Math.sqrt(1 - e * e) * sinD(E), v = Math.atan2(yv, xv) / RAD, u = v + wm;
      const xh = cosD(Nm) * cosD(u) - sinD(Nm) * sinD(u) * cosD(i), yh = sinD(Nm) * cosD(u) + cosD(Nm) * sinD(u) * cosD(i), zh = sinD(u) * sinD(i);
      const Ls = Ms + ws, Lm = Mm + wm + Nm, D = Lm - Ls, F = Lm - Nm;
      const lon = Math.atan2(yh, xh) / RAD - 1.274 * sinD(Mm - 2 * D) + 0.658 * sinD(2 * D) - 0.186 * sinD(Ms) - 0.059 * sinD(2 * Mm - 2 * D) - 0.057 * sinD(Mm - 2 * D + Ms)
        + 0.053 * sinD(Mm + 2 * D) + 0.046 * sinD(2 * D - Ms) + 0.041 * sinD(Mm - Ms) - 0.035 * sinD(D) - 0.031 * sinD(Mm + Ms);
      const lat = Math.atan2(zh, Math.hypot(xh, yh)) / RAD - 0.173 * sinD(F - 2 * D) - 0.055 * sinD(Mm - F - 2 * D) - 0.046 * sinD(Mm + F - 2 * D) + 0.033 * sinD(F + 2 * D);
      eclDir(lon, lat, ecl, s.moonDir);
      s.moonLit = (1 - cosD(lat) * cosD(lon - sunLon)) / 2;
      s.moonDir.y -= 0.0166 * Math.sqrt(1 - s.moonDir.y ** 2); // 시차: 땅 위에서 보면 1° 남짓 낮다
      s.moonDir.normalize();
      s.sunAlt = Math.asin(s.sunDir.y) / RAD;
      s.moonAlt = Math.asin(s.moonDir.y) / RAD;

      // 해 높이로 열쇠를 고르고, 해가 동쪽이면 아침, 서쪽이면 저녁 쪽을 쓴다(한낮·한밤은 둘이 같아 이음매가 없다)
      const east = s.sunDir.dot(E_AXIS) / Math.max(0.05, Math.hypot(s.sunDir.x, s.sunDir.z));
      const w = smooth(-0.25, 0.25, east), h = s.sunAlt;
      for (const n of COLS) col[n].setRGB(0, 0, 0);
      for (const n of NUMS) num[n] = 0;
      for (let side = 0; side < 2; side++) {
        const ks = KEYS[side], k = side === 0 ? w : 1 - w;
        if (k <= 0) continue;
        let j = 0;
        while (j < ks.length - 2 && h > ks[j + 1].h) j++;
        const a = ks[j], b = ks[j + 1], t = smooth(a.h, b.h, h);
        for (const n of COLS) col[n].add(_c.copy(a.c[n]).lerp(b.c[n], t).multiplyScalar(k));
        for (const n of NUMS) num[n] += (a[n] + (b[n] - a[n]) * t) * k;
      }
      s.night = num.night; s.hemiI = num.hi; s.waterK = num.wk; s.glowK = num.gk;
      s.starAlpha = smooth(0.45, 0.95, s.night);

      // 그림자 빛: 낮은 해, 밤은 달(지면 아래면 하늘 위쪽의 은은한 빛). 해가 질 무렵 빛이 약할 때 서서히 넘어간다
      const moonUp = smooth(-2, 6, s.moonAlt);
      clampUp(_b.copy(s.moonDir).lerp(_a.set(0.2, 1, 0.3), 1 - moonUp), SHADOW_MIN_MOON);
      clampUp(_a.copy(s.sunDir));
      s.lightDir.copy(_b).lerp(_a, smooth(-6, 2, h)).normalize();
      s.lightI = num.li * (1 - s.night * (0.45 - 0.45 * moonUp * (0.3 + 0.7 * s.moonLit)));
      return s;
    },
  };
  return s;
}

// 그림자가 지나치게 길어지지 않게 빛의 높이를 min 위로 올린다
function clampUp(v: THREE.Vector3, min = SHADOW_MIN) {
  v.normalize();
  if (v.y >= min) return v;
  const hl = Math.hypot(v.x, v.z) || 1, c = Math.sqrt(1 - min ** 2);
  return v.set((v.x / hl) * c, min, (v.z / hl) * c);
}
