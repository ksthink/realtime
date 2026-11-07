import * as THREE from "three";
import { clamp, lerp, rng } from "../terrain";

// 마을 너머 멀리 어렴풋이 보이는 산줄기. 카메라를 따라다녀 늘 지평선에 걸려 있고, 먼저 그리며 깊이를 쓰지 않아 마을의 모든 것이 그 앞에 그려진다.
// 안개를 받지 않고 대신 꼭짓점 색을 하늘색 쪽으로 섞는다. 밑동은 하늘색과 같아 땅 끝·안개와 이음매가 없다.
// 하늘색은 시간에 따라 바뀌므로 산 색(미리 덜어 둔 몫)과 하늘색을 섞는 비율(haze)을 따로 담고, 그릴 때 지금 하늘색을 더한다

const HAZE = "#d9e3ef"; // 낮 하늘·안개색
const R = 200; // 그리는 반경. 카메라 far(260)보다 안쪽이면 된다
const COLS = 360; // 둘레 칸 수(1°)
const BASE = -0.3; // 밑동 높이(눈높이 기준, tan 단위). 하늘에서 내려다봐도 빈틈이 없게 충분히 내린다
// 줄마다 밑동에서 능선까지의 높이 비율. 맨 위가 능선이다
const ROWS = [0, 0.42, 0.62, 0.8, 0.92, 1];
const SUN = new THREE.Vector2(0.8, 0.6); // 해가 오는 쪽(x, z). game.ts SUN_OFF와 같은 방향

// 멀수록 옅고 푸르다. lo·amp: 능선 높이(눈높이 위 tan), mix: 하늘색에 섞는 정도, k: 잡음 촘촘함
type Layer = { seed: number; color: string; mix: number; lo: number; amp: number; k: number };
const LAYERS: Layer[] = [
  { seed: 11, color: "#8394b4", mix: 0.8, lo: 0.1, amp: 0.13, k: 7 },
  { seed: 23, color: "#7e91ab", mix: 0.72, lo: 0.08, amp: 0.11, k: 9 },
  { seed: 37, color: "#7d8f9d", mix: 0.64, lo: 0.06, amp: 0.085, k: 12 },
];

// 이름난 산: 방향(라디안, atan2(z, x)), 반폭(라디안), 높이(tan), 놓을 층
const HALLA = { a: -1.95, w: 0.62, h: 0.19, layer: 1 }; // 한라산: 낮고 길게 퍼진 순상 화산, 꼭대기에 작은 분화구
const BAEKDU = { a: 1.05, w: 0.42, h: 0.235, layer: 0 }; // 백두산: 넓은 덩어리 위 들쭉날쭉한 분화구 테두리

// 둘레를 따라 이어지는(끝과 처음이 맞는) 1차원 값 잡음. 직선으로 이어 능선이 각지게 꺾인다
function ring(seed: number, n: number) {
  const r = rng(seed), v = Array.from({ length: n }, r);
  return (u: number) => {
    const x = (((u % 1) + 1) % 1) * n, i = Math.floor(x);
    return lerp(v[i % n], v[(i + 1) % n], x - i);
  };
}

const ridged = (v: number) => { const t = 1 - Math.abs(v * 2 - 1); return t * t; };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
// 산 가운데 1, 반폭의 1.3배 밖에서 0
const near01 = (a: number, m: { a: number; w: number }) => { const u = clamp(1 - Math.abs(wrap(a - m.a)) / (m.w * 1.3), 0, 1); return u * u * (3 - 2 * u); };

function halla(a: number) {
  const u = wrap(a - HALLA.a) / HALLA.w;
  if (Math.abs(u) >= 1) return 0;
  // 완만한 긴 자락 + 꼭대기의 평평한 정수리 - 분화구(백록담) 오목함
  const top = clamp((0.18 - Math.abs(u)) / 0.1, 0, 1), crater = clamp((0.06 - Math.abs(u)) / 0.03, 0, 1);
  return HALLA.h * (0.88 * (1 - u * u) ** 1.7 + 0.12 * top * top * (3 - 2 * top) - 0.025 * crater);
}

const baekduJag = [ring(71, 200), ring(72, 45)];
function baekdu(a: number) {
  const u = wrap(a - BAEKDU.a) / BAEKDU.w;
  if (Math.abs(u) >= 1) return 0;
  const body = (1 - u ** 4) ** 2.2; // 어깨가 넓고 위가 평평한 덩어리
  const rim = clamp(1.4 - Math.abs(u) * 2.4, 0, 1); // 꼭대기 테두리 구간
  const t = a / (Math.PI * 2), jag = (ridged(baekduJag[0](t)) - 0.3) * (0.04 + 0.1 * baekduJag[1](t)) * rim; // 크기가 고르지 않은 뾰족한 봉우리들
  const crater = 0.06 * Math.max(0, 1 - Math.abs(u + 0.06) / 0.1); // 천지 자리 오목함
  return BAEKDU.h * (0.86 * body + jag - crater);
}

function layerHeights(l: Layer, idx: number) {
  const n = [1, 2.3, 5.1, 11.3].map((m, j) => ring(l.seed + j, Math.round(l.k * m))), env = ring(l.seed + 7, 6);
  const h = new Float32Array(COLS + 1);
  for (let i = 0; i <= COLS; i++) {
    const u = i / COLS, a = u * Math.PI * 2;
    // 큰 굴곡: 산맥이 높아졌다 낮아졌다 한다. 이름난 산 둘레는 낮춰 그 산이 홀로 서 보이게 한다
    const near = Math.max(near01(a, HALLA), near01(a, BAEKDU));
    const e = (0.45 + 0.75 * env(u)) * (1 - 0.55 * near);
    let y = l.lo + l.amp * e * (ridged(n[0](u)) * 0.55 + ridged(n[1](u)) * 0.27 + ridged(n[2](u)) * 0.12 + n[3](u) * 0.06);
    if (idx === HALLA.layer) y = Math.max(y, halla(a));
    if (idx === BAEKDU.layer) y = Math.max(y, baekdu(a));
    h[i] = y;
  }
  return h;
}

export function makeSkyline() {
  const haze = new THREE.Color(HAZE), c = new THREE.Color(), snow = new THREE.Color("#f4f7fb");
  const per = (COLS + 1) * ROWS.length;
  const pos = new Float32Array(per * LAYERS.length * 3), col = new Float32Array(per * LAYERS.length * 3), hz = new Float32Array(per * LAYERS.length);
  const index: number[] = [];
  LAYERS.forEach((l, li) => {
    const h = layerHeights(l, li), base = new THREE.Color(l.color), o = li * per;
    for (let i = 0; i <= COLS; i++) {
      const a = (i / COLS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      // 해 쪽을 향한 비탈과 해를 등진 면(해가 카메라 뒤에 있을 때)을 조금 밝힌다
      const slope = (h[(i + 1) % COLS] - h[(i + COLS - 1) % COLS]) / ((2 * Math.PI * 2) / COLS);
      const tx = -sa, tz = ca; // 둘레 접선
      const lit = clamp(0.5 - slope * 2.2 * (tx * SUN.x + tz * SUN.y) + 0.15 * (-ca * SUN.x - sa * SUN.y), 0, 1);
      for (let k = 0; k < ROWS.length; k++) {
        const top = k === ROWS.length - 1;
        const y = lerp(BASE, h[i], ROWS[k]);
        const v = o + i * ROWS.length + k;
        pos.set([ca * R, y * R, sa * R], v * 3);
        // 눈높이 아래는 하늘색으로 녹이고, 위로 갈수록 산 색이 드러난다
        const fade = clamp((y + 0.005) / (h[i] * 0.75 + 0.01), 0, 1);
        c.copy(base).multiplyScalar(0.92 + 0.16 * lit);
        if (top && h[i] > 0.19) c.lerp(snow, clamp((h[i] - 0.19) / 0.03, 0, 1) * 0.45); // 가장 높은 봉우리만 희끗하게
        const m = 1 - (1 - l.mix) * fade * fade;
        c.multiplyScalar(1 - m);
        col.set([c.r, c.g, c.b], v * 3);
        hz[v] = m;
      }
      if (i === COLS) continue;
      for (let k = 0; k < ROWS.length - 1; k++) {
        const a0 = o + i * ROWS.length + k, b0 = a0 + ROWS.length;
        index.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("haze", new THREE.BufferAttribute(hz, 1));
  geo.setIndex(index); // 먼 층부터 쌓여 있어 차례대로 그리면 가까운 층이 위에 온다
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
  const uHaze = { value: haze };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uHaze = uHaze;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nattribute float haze;\nvarying float vHaze;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvHaze = haze;");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uHaze;\nvarying float vHaze;").replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb += vHaze * uHaze;");
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -100; // 맨 먼저 그린다. 깊이를 쓰지 않으니 마을이 늘 그 위에 그려진다
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;

  return {
    mesh,
    // 카메라 자리로 옮긴다. 높이도 따라가 지평선이 늘 눈높이에 있다(아주 먼 산처럼)
    update(cam: THREE.Camera) {
      mesh.position.copy(cam.position);
      mesh.updateMatrix();
    },
    // 지금 하늘색(밑동·먼 산이 녹아드는 색)과 산 색에 곱할 빛깔(밤에는 푸르고 어둡게)
    tint(sky: THREE.Color, mountain: THREE.Color) {
      haze.copy(sky);
      mat.color.copy(mountain);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
