import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HILL, STAIR, TREADS, WATER_Y, WORLD, baseTerrainY, clamp, rimY, rng, stairDip, terrainY, vnoise } from "../terrain";
import { buildBigTree } from "./bigtree";
import { WIND_DIR } from "./petals";
import { stoneGeometry } from "./stone";
import { tickWater, waterMaterial } from "./water";

// 바람 세기. 값은 최대 흔들림(m)이고, 0이면 그 부위가 멈춘다. RIPPLE은 수관 표면 일렁임(반지름 비율)
const SWAY_CANOPY = 0.035, SWAY_BUSH = 0.03, SWAY_FLOWER = 0.05, RIPPLE = 0.012;

const f = (v: number) => v.toFixed(4);

// 여러 사인을 겹쳐 규칙적으로 보이지 않게 하고, 위치에 따라 위상을 천천히 바꿔 바람이 번져 가게 한다
const WIND_GLSL = `
uniform float uWindTime;
vec2 windAt(vec2 p) {
  float gust = 0.65 + 0.35 * sin(uWindTime * 0.21 + p.x * 0.04 + p.y * 0.06);
  float a = sin(uWindTime * 0.9 + dot(p, vec2(0.31, 0.23)));
  float b = sin(uWindTime * 1.6 + dot(p, vec2(-0.47, 0.71)));
  vec2 dir = vec2(${f(WIND_DIR[0])}, ${f(WIND_DIR[1])});
  return gust * (dir * (0.7 * a + 0.3 * b) + vec2(-dir.y, dir.x) * 0.25 * b);
}
`;

// 인스턴스 메시 재질의 정점 셰이더에 바람을 넣는다. body에서 wind(-1~1)로 transformed를 옮긴다
// fade를 주면 카메라에서 fade.x~fade.y m 사이에서 인스턴스를 줄여 없앤다(멀리 있는 작은 꽃)
function sway<M extends THREE.Material>(mat: M, time: { value: number }, key: string, body: string, fade?: { value: THREE.Vector2 }) {
  mat.customProgramCacheKey = () => `wind-${key}`; // 없으면 소스가 같은 onBeforeCompile끼리 프로그램을 나눠 쓴다
  mat.onBeforeCompile = (s) => {
    s.uniforms.uWindTime = time;
    if (fade) s.uniforms.uFade = fade;
    s.vertexShader = (fade ? "uniform vec2 uFade;\n" : "") + WIND_GLSL + s.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      ${fade ? "transformed *= 1.0 - smoothstep(uFade.x, uFade.y, distance(cameraPosition, (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz));" : ""}
      vec2 wind = windAt(instanceMatrix[3].xz);
      ${body}`,
    );
  };
  return mat;
}

type Item = { x: number; y: number; z: number; r: () => number; hide?: boolean };

// 넓히기 전 반경. 그 안의 식생은 예전 자리와 모양 그대로 둔다
const OLD_WORLD = 80;
// 식생을 나누는 격자 칸(m). 인덱스가 많은 것은 잘게, 적은 것은 크게 나눠 그리기 호출을 줄인다.
// 꽃은 안개 시작 거리 × FLOWER_FADE 사이에서 사라진다. 땅은 GROUND_CHUNK칸씩 나눈다
const TILE = { trunk: 48, canopy: 24, bush: 32, flower: 24, rock: 48 }, FLOWER_FADE = [0.94, 1.35], GROUND_CHUNK = 62;
// 넓히기 전 땅(동산·다리 둑 없음, 가장자리 산이 OLD_WORLD - 6부터). 예전 식생 자리를 고를 때만 쓴다
const oldGround = (x: number, z: number) => {
  const r = Math.hypot(x, z), h = baseTerrainY(x, z, false);
  return r > OLD_WORLD - 6 ? h + Math.pow((r - (OLD_WORLD - 6)) / 6, 2) * 7 : h;
};

// ── 나무·꽃 모양. 모든 인스턴스가 함께 쓰므로 정점을 늘려도 한 벌뿐이다 ──
// 다른 것들(캐릭터·땅·바위)처럼 명암을 따로 넣지 않고 빛만 받게 둔다
// 잎덩이: 살짝 울퉁불퉁한 공(뭉친 잎). 윤곽만 조금 부드럽게 흔들리는 정도
function canopyGeometry() {
  const g = mergeVertices(new THREE.SphereGeometry(1, 18, 12).deleteAttribute("normal").deleteAttribute("uv")); // 이음매·극점 정점을 합쳐 매끈하게
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.045 * Math.sin(3.1 * x + 1.3) * Math.sin(2.7 * y + 0.4) * Math.sin(3.3 * z + 2.1) + 0.02 * Math.sin(5.3 * x - 4.7 * z + 2.2 * y);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}
// 줄기: 밑동이 살짝 퍼지고 위로 가늘어진다. 높이 1(가운데가 원점)
function trunkGeometry() {
  const g = new THREE.LatheGeometry([0.22, 0.16, 0.13, 0.1, 0.08].map((r, i) => new THREE.Vector2(r, [0, 0.06, 0.25, 0.6, 1][i])), 7);
  return g.deleteAttribute("uv").translate(0, -0.5, 0);
}
// 꽃 줄기 + 작은 잎 한 장. 높이 0.3(가운데가 원점)
function stemGeometry() {
  const leaf = new THREE.SphereGeometry(1, 6, 4).scale(0.045, 0.012, 0.022).translate(0.04, 0, 0).rotateZ(0.5).translate(0, -0.03, 0);
  return mergeGeometries([new THREE.CylinderGeometry(0.009, 0.012, 0.3, 5), leaf].map((x) => x.deleteAttribute("uv")))!;
}
// 꽃송이: 둥근 꽃잎 n장과 노란 꽃술. aCenter(1이면 꽃술)로 꽃술만 노랗게 칠한다
function flowerHeadGeometry(n: number) {
  const parts: THREE.BufferGeometry[] = [];
  const w = 0.032 * (5 / n) ** 0.6; // 꽃잎이 많을수록 조금 좁게
  for (let k = 0; k < n; k++) parts.push(new THREE.SphereGeometry(1, 5, 3).scale(0.05, 0.016, w).translate(0.045, 0, 0).rotateY((k / n) * Math.PI * 2));
  parts.push(new THREE.SphereGeometry(0.028, 6, 4).scale(1, 0.6, 1).translate(0, 0.008, 0));
  const g = mergeGeometries(parts.map((x) => x.deleteAttribute("uv")))!; // 정점을 나눠 쓰는(인덱스) 채로 합친다
  const center = new Float32Array(g.attributes.position.count);
  center.fill(1, g.attributes.position.count - parts[n].attributes.position.count);
  g.setAttribute("aCenter", new THREE.BufferAttribute(center, 1));
  return g;
}
// 꽃 한 송이의 모양: 줄기 길이·기운 방향과 각도·꽃송이가 숙인 정도·꽃잎 수·색. 줄기와 꽃송이가 같은 값을 쓴다
type Bloom = { len: number; yaw: number; lean: THREE.Quaternion; head: THREE.Quaternion; tip: THREE.Vector3; petals: number; size: number; hue: number; sat: number; light: number };
// 꽃 색: 파스텔 열두 가지 [색조, 채도, 밝기]. 무리·군락마다 하나씩 고르고 송이마다 조금씩 흔든다.
// 화면 톤매핑이 옅은 색을 더 바래게 하므로 채도를 조금 높게 잡는다
const FLOWER_PALETTE = [
  [0.98, 0.75, 0.7], // 산호 분홍
  [0.06, 0.8, 0.72], // 복숭아
  [0.08, 0.85, 0.64], // 셔벗 주황
  [0.13, 0.85, 0.66], // 버터 노랑
  [0.12, 0.45, 0.86], // 크림
  [0.6, 0.12, 0.92], // 하양
  [0.75, 0.55, 0.74], // 라벤더
  [0.79, 0.6, 0.66], // 보라
  [0.9, 0.65, 0.72], // 꽃분홍
  [0.99, 0.62, 0.62], // 장미
  [0.56, 0.7, 0.7], // 하늘
  [0.65, 0.6, 0.72], // 페리윙클
];
function bloom(r: () => number, color: number): Bloom {
  const len = 0.7 + r() * 0.65, yaw = r() * Math.PI * 2, d = r() * Math.PI * 2, tilt = r() * 0.3, droop = 0.25 + r() * 0.45;
  const axis = new THREE.Vector3(Math.cos(d), 0, -Math.sin(d)); // +y를 d 방향으로 눕히는 축
  const lean = new THREE.Quaternion().setFromAxisAngle(axis, tilt);
  return {
    len, yaw, lean,
    head: new THREE.Quaternion().setFromAxisAngle(axis, tilt + droop).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2)),
    tip: new THREE.Vector3(0, 0.3 * len, 0).applyQuaternion(lean),
    petals: r() < 0.55 ? 5 : 6, size: 0.8 + r() * 0.45,
    hue: FLOWER_PALETTE[color][0] + (r() - 0.5) * 0.04, sat: FLOWER_PALETTE[color][1] + (r() - 0.5) * 0.14, light: FLOWER_PALETTE[color][2] + (r() - 0.5) * 0.08,
  };
}
// 꽃 군락지: 평평한 풀밭 몇 곳에 꽃이 130송이쯤(1m²에 3송이 남짓) 빽빽하게 핀다. 군락마다 세 가지 색으로 어울리게
const MEADOWS = 6;
function meadowFlowers(seed: number, onLand: (x: number, y: number, z: number, slope: number) => boolean) {
  const r = rng(seed), centers: { x: number; z: number; r: number }[] = [], out: (Item & { b: Bloom })[] = [];
  const slopeAt = (x: number, z: number) => Math.hypot(terrainY(x + 0.4, z) - terrainY(x - 0.4, z), terrainY(x, z + 0.4) - terrainY(x, z - 0.4));
  for (let k = 0; k < 3000 && centers.length < MEADOWS; k++) {
    const a = r() * Math.PI * 2, d = 15 + Math.sqrt(r()) * (WORLD - 30), x = Math.cos(a) * d, z = Math.sin(a) * d, R = 3 + r();
    if (Math.hypot(x - HILL.x, z - HILL.z) < HILL.r + 6 || centers.some((c) => Math.hypot(c.x - x, c.z - z) < 40)) continue;
    // 군락 전체가 마른 땅이고 너무 기울지 않아야 한다
    let flat = true;
    for (let i = 0; i < 9 && flat; i++) {
      const px = x + Math.cos(i * 0.7) * R * (i / 8), pz = z + Math.sin(i * 0.7) * R * (i / 8), y = terrainY(px, pz);
      flat = y > WATER_Y + 0.8 && y < 4 && slopeAt(px, pz) < 0.35;
    }
    if (!flat) continue;
    centers.push({ x, z, r: R });
    const pick = () => Math.floor(r() * FLOWER_PALETTE.length), theme = [pick(), pick(), pick()];
    for (let n = 0; n < 130; n++) {
      const fa = r() * Math.PI * 2, fd = Math.sqrt(r()) * R, fx = x + Math.cos(fa) * fd, fz = z + Math.sin(fa) * fd, fy = terrainY(fx, fz);
      if (!onLand(fx, fy, fz, slopeAt(fx, fz))) continue;
      const b = bloom(r, theme[n % 3]);
      b.size *= 1.15;
      out.push({ x: fx, y: fy, z: fz, r, b });
    }
  }
  return { centers, flowers: out };
}

// 꽃 무리: 가운데 꽃마다 같은 색 계열 꽃을 per-1송이 더 둘레에 피운다
function clusterFlowers(centers: Item[], per: number, seed: number, ok: (x: number, y: number, z: number, slope: number) => boolean, ground = terrainY) {
  const r = rng(seed), out: (Item & { b: Bloom })[] = [];
  for (const c of centers) {
    const color = Math.floor(r() * FLOWER_PALETTE.length);
    out.push({ ...c, b: bloom(r, color) });
    for (let k = 1; k < per; k++) {
      const a = r() * Math.PI * 2, d = 0.25 + r() * 0.5, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, y = ground(x, z);
      const slope = Math.hypot(ground(x + 0.4, z) - ground(x - 0.4, z), ground(x, z + 0.4) - ground(x, z - 0.4));
      if (ok(x, y, z, slope)) out.push({ x, y: ground === terrainY ? y : terrainY(x, z), z, r: c.r, b: bloom(r, color) });
    }
  }
  return out;
}

// ground로 자리를 고르고 높이는 지금 땅에 맞춘다
function scatter(count: number, seed: number, rMin: number, rMax: number, ok: (x: number, y: number, z: number, slope: number) => boolean, ground = terrainY) {
  const r = rng(seed), out: Item[] = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 20) {
    const a = r() * Math.PI * 2, d = rMin + Math.sqrt(r()) * (rMax - rMin);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, y = ground(x, z);
    const slope = Math.hypot(ground(x + 0.4, z) - ground(x - 0.4, z), ground(x, z + 0.4) - ground(x, z - 0.4));
    if (ok(x, y, z, slope)) out.push({ x, y: ground === terrainY ? y : terrainY(x, z), z, r });
  }
  return out;
}
// 예전 식생 + 바깥 고리. 예전 것은 산이 있던 자리와 동산 꼭대기·계단 위만 숨긴다(난수 순서는 그대로)
function widen<T extends Item>(old: T[], ring: T[], tall = Infinity) {
  for (const it of old) {
    const dx = it.x - HILL.x, dz = it.z - HILL.z, d = Math.hypot(dx, dz);
    it.hide = Math.hypot(it.x, it.z) > OLD_WORLD - 6 || d < HILL.plateauR + 0.6 || it.y - baseTerrainY(it.x, it.z) > tall
      || d < HILL.r + 0.5 && HILL.stairs.some((a) => dx * Math.cos(a) + dz * Math.sin(a) > 0 && Math.abs(dz * Math.cos(a) - dx * Math.sin(a)) < STAIR.half + 1.2);
  }
  return old.concat(ring);
}

// hide인 것도 place는 불러 난수를 똑같이 쓰고, 그리지만 않는다.
// tile(m)을 주면 그 격자 칸마다 메시를 따로 만든다. 칸마다 경계구가 작아져 화면·그림자 카메라 밖 칸은 three가 그리지 않는다
// 꽃송이의 꽃술(aCenter=1)만 노랗게. sway가 바꾼 셰이더에 덧붙인다
function withCenter<M extends THREE.Material>(mat: M) {
  const prev = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (s, r) => {
    prev(s, r);
    s.vertexShader = "attribute float aCenter;\nvarying float vCenter;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvCenter = aCenter;");
    s.fragmentShader = "varying float vCenter;\n" + s.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.84, 0.38), vCenter);");
  };
  return mat;
}

function instanced<T extends { x: number; y: number; z: number; hide?: boolean }>(
  root: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, items: T[],
  place: (it: T, o: THREE.Object3D, c: THREE.Color) => void, tile = 0,
) {
  const o = new THREE.Object3D(), c = new THREE.Color(), cells = new Map<string, [THREE.Matrix4, THREE.Color][]>();
  for (const it of items) {
    o.position.set(it.x, it.y, it.z);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
    place(it, o, c);
    if (it.hide) continue;
    o.updateMatrix();
    const k = tile ? `${Math.floor(it.x / tile)},${Math.floor(it.z / tile)}` : "";
    let cell = cells.get(k);
    if (!cell) cells.set(k, (cell = []));
    cell.push([o.matrix.clone(), c.clone()]);
  }
  return [...cells.values()].map((cell) => {
    const m = new THREE.InstancedMesh(geo, mat, cell.length);
    cell.forEach(([mm, cc], i) => { m.setMatrixAt(i, mm); m.setColorAt(i, cc); });
    m.castShadow = m.receiveShadow = true;
    m.computeBoundingSphere();
    m.boundingSphere!.radius += 0.1; // 바람에 흔들리는 만큼
    root.add(m);
    return m;
  });
}

// 땅 꼭짓점 높이·색은 꼭짓점마다 지형을 여섯 번 구해 무겁다. 처음 한 번만 구하고 인트로와 게임이 같이 쓴다
let groundCache: { pos: Float32Array; col: Float32Array; normal: Float32Array } | null = null;
// 격자 간격을 예전(반경 94, 260칸)과 같게 둬 예전 땅의 꼭짓점이 같은 자리에 온다
const SEG = 372, S = ((OLD_WORLD + 14) * SEG) / 260;

// 눈에 보이는 땅(삼각형 메시) 위의 높이. 지형 함수는 다리 옆면처럼 급한 곳에서 메시와 어긋나므로,
// 땅에 놓이는 것(돌, 탑, 캐릭터)은 이 높이에 맞춰야 떠 보이거나 묻히지 않는다. 땅을 만들기 전에는 지형 함수를 쓴다
export function groundAt(x: number, z: number) {
  if (!groundCache) return terrainY(x, z) - stairDip(x, z);
  const h = (2 * S) / SEG, fx = clamp((x + S) / h, 0, SEG - 1e-6), fz = clamp((z + S) / h, 0, SEG - 1e-6);
  const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, p = groundCache.pos;
  const y = (i: number, k: number) => p[(k * (SEG + 1) + i) * 3 + 1];
  const a = y(ix, iz), b = y(ix, iz + 1), c = y(ix + 1, iz + 1), d = y(ix + 1, iz);
  // PlaneGeometry는 칸마다 (a, b, d)와 (b, c, d) 두 삼각형으로 나눈다
  return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
}

const _soil = new THREE.Color();

export function buildWorld(root: THREE.Object3D) {
  // 땅: 높이·경사에 따라 색이 변한다
  const geo = new THREE.PlaneGeometry(S * 2, S * 2, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  if (groundCache) {
    (pos.array as Float32Array).set(groundCache.pos);
    col.set(groundCache.col);
    (geo.attributes.normal.array as Float32Array).set(groundCache.normal);
  } else {
    // 흙: 풀빛과 어울리는 옅은 황토. 몇 m 크기의 얼룩으로 드문드문 드러나고 가장자리는 풀과 부드럽게 섞인다
    const soil = new THREE.Color("#c6b38e"), soil2 = new THREE.Color("#b8a27e");
    const grass = new THREE.Color("#b9cf9d"), grass2 = new THREE.Color("#9fbf86"), sand = new THREE.Color("#e3d7b8"), lakebed = new THREE.Color("#a2a184"), rock = new THREE.Color("#aaa6a8"), snow = new THREE.Color("#f1f0f4");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = terrainY(x, z);
      pos.setY(i, y - stairDip(x, z));
      // 바위색·눈은 동산을 뺀 땅으로 정해 동산은 풀빛으로 남는다
      // 가장자리 산줄기는 기울기를 반만 쳐서 대부분 풀빛 산자락으로 두고 아주 가파른 곳만 바위색을 띤다
      const rocky = (px: number, pz: number) => baseTerrainY(px, pz) - rimY(px, pz) * 0.5;
      const by = baseTerrainY(x, z), slope = Math.hypot(rocky(x + 0.5, z) - rocky(x - 0.5, z), rocky(x, z + 0.5) - rocky(x, z - 0.5));
      c.copy(grass).lerp(grass2, vnoise(x * 0.3, z * 0.3));
      const patch = vnoise(x * 0.11 + 3.7, z * 0.11 + 1.9) * 0.65 + vnoise(x * 0.37 + 8.1, z * 0.37 + 5.3) * 0.35; // 큰 얼룩 + 들쭉날쭉한 가장자리
      const bare = clamp((patch - 0.6) / 0.16, 0, 1);
      if (bare > 0) c.lerp(_soil.copy(soil).lerp(soil2, vnoise(x * 0.8, z * 0.8)), bare * bare * (3 - 2 * bare) * 0.55);
      if (y < WATER_Y + 0.6) c.lerp(sand, clamp((WATER_Y + 0.6 - y) / 0.6, 0, 1));
      if (y < WATER_Y) c.lerp(lakebed, clamp((WATER_Y - y) / 2.5, 0, 1)); // 호수 바닥: 깊을수록 모래가 조금 어두워진다
      if (slope > 0.7) c.lerp(rock, clamp((slope - 0.7) / 0.8, 0, 1));
      const sy = by - rimY(x, z); // 가장자리 산줄기에는 눈을 얹지 않는다
      if (sy > 5.5) c.lerp(snow, clamp((sy - 5.5) / 2, 0, 1));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.computeVertexNormals();
    groundCache = { pos: (pos.array as Float32Array).slice(), col: col.slice(), normal: (geo.attributes.normal.array as Float32Array).slice() };
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  // 땅은 꼭짓점을 같이 쓰는 GROUND_CHUNK칸 조각으로 나눠 그린다. 화면 밖 조각은 three가 거른다
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), cull: [THREE.Object3D, THREE.Sphere, boolean][] = [];
  const index = geo.index!.array, box = new THREE.Box3(), v = new THREE.Vector3();
  for (let cy = 0; cy < SEG; cy += GROUND_CHUNK) for (let cx = 0; cx < SEG; cx += GROUND_CHUNK) {
    // PlaneGeometry는 칸 (ix, iy)마다 인덱스 6개를 줄 순서로 둔다
    const w = Math.min(GROUND_CHUNK, SEG - cx), h = Math.min(GROUND_CHUNK, SEG - cy), part = new Uint32Array(w * h * 6);
    for (let iy = cy; iy < cy + h; iy++) part.set(index.subarray((iy * SEG + cx) * 6, (iy * SEG + cx + w) * 6), (iy - cy) * w * 6);
    box.makeEmpty();
    for (let iy = cy; iy <= cy + h; iy++) for (let ix = cx; ix <= cx + w; ix++) box.expandByPoint(v.fromBufferAttribute(pos, iy * (SEG + 1) + ix));
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
    g.setIndex(new THREE.BufferAttribute(part, 1));
    g.boundingBox = box.clone();
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const ground = new THREE.Mesh(g, groundMat);
    ground.receiveShadow = true;
    root.add(ground);
    cull.push([ground, g.boundingSphere, false]);
  }

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(S * 2, S * 2),
    waterMaterial(pos, SEG + 1, S, WATER_Y),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  water.onBeforeRender = tickWater;
  root.add(water);

  // 식생: 전부 인스턴싱
  const windTime = { value: 0 };
  buildBigTree(root, HILL.x, HILL.z, windTime);
  // 식생 칸들. 꽃은 작아서 멀리서는 줄여 없애고(flowerFade, 셰이더) 다 사라진 칸은 아예 끈다
  const flowerFade = { value: new THREE.Vector2(1e9, 2e9) };
  const tiled = (ms: THREE.InstancedMesh[], depth?: THREE.Material, flower = false) => {
    for (const m of ms) {
      if (depth) m.customDepthMaterial = depth;
      cull.push([m, m.boundingSphere!, flower]);
    }
  };
  const canopyWind = `
    transformed.xz += wind * ${f(SWAY_CANOPY)} * (0.75 + 0.25 * position.y);
    transformed *= 1.0 + ${f(RIPPLE)} * sin(uWindTime * 2.1 + dot(position, vec3(2.3, 3.1, 1.7)) + instanceMatrix[3].x);`;
  const bushWind = `transformed.xz += wind * ${f(SWAY_BUSH)} * (0.5 + 0.5 * position.y);`; // 밑동은 땅에 붙어 있다
  const onLand = (_x: number, y: number, _z: number, slope: number) => y > WATER_Y + 0.5 && slope < 0.9;
  // 바깥 고리는 예전과 같은 밀도가 되게 수를 정했다
  const treeOk = (x: number, y: number, z: number, s: number) => onLand(x, y, z, s) && y < 5;
  const trees: (Item & { h?: number })[] = widen(scatter(620, 11, 8, OLD_WORLD + 3, treeOk, oldGround), scatter(860, 111, OLD_WORLD - 6, WORLD + 3, treeOk), 3);
  tiled(instanced(root, trunkGeometry(), new THREE.MeshStandardMaterial({ roughness: 1 }), trees, (t, o, col) => {
    const h = (t.h = 0.9 + t.r() * 0.8); // 잎덩이도 이 높이에 얹는다
    o.position.y += h / 2;
    o.scale.set(1, h, 1);
    col.set("#8b6a52").offsetHSL(0, 0, (t.r() - 0.5) * 0.1);
  }, TILE.trunk));
  const canopy: { x: number; y: number; z: number; s: number; hue: number; l: number; hide?: boolean }[] = [];
  for (const t of trees) {
    // 잎덩이는 줄기 높이(t.h)에 얹는다. 예전엔 높이를 따로 뽑아 잎덩이가 줄기 위에 떠 있곤 했다.
    // 뽑던 난수는 그대로 하나 버려서 다른 나무들의 모양·색은 바뀌지 않게 한다
    t.r();
    const h = t.h!, k = 2 + Math.floor(t.r() * 2), hue = 0.25 + t.r() * 0.12, l = 0.5 + t.r() * 0.15;
    for (let i = 0; i < k; i++) canopy.push({ x: t.x + (t.r() - 0.5) * 0.5, y: t.y + h + 0.3 + i * 0.45 * (t.r() + 0.5), z: t.z + (t.r() - 0.5) * 0.5, s: 0.55 + t.r() * 0.5, hue, l, hide: t.hide });
  }
  // 수관과 덤불은 그림자도 같이 흔든다. 어긋나면 표면이 제 그림자 안으로 들어가 얼룩이 생길 수 있다
  tiled(instanced(root, canopyGeometry(), sway(new THREE.MeshStandardMaterial({ roughness: 0.95 }), windTime, "canopy", canopyWind), canopy, (t, o, col) => {
    o.scale.set(t.s * 1.1, t.s * 0.9, t.s * 1.1);
    col.setHSL(t.hue, 0.45, t.l);
  }, TILE.canopy), sway(new THREE.MeshDepthMaterial(), windTime, "canopy", canopyWind));
  tiled(instanced(root, new THREE.SphereGeometry(1, 10, 8), sway(new THREE.MeshStandardMaterial({ roughness: 1 }), windTime, "bush", bushWind), widen(scatter(420, 23, 5, OLD_WORLD + 1, onLand, oldGround), scatter(680, 123, OLD_WORLD - 6, WORLD + 1, onLand)), (t, o, col) => {
    const s = 0.35 + t.r() * 0.45;
    o.position.y += s * 0.5;
    o.scale.set(s * 1.3, s * 0.8, s * 1.2);
    col.setHSL(0.28 + t.r() * 0.08, 0.4, 0.5 + t.r() * 0.12);
  }, TILE.bush), sway(new THREE.MeshDepthMaterial(), windTime, "bush", bushWind));
  // 같은 색 꽃이 4송이쯤 모여 핀다(무리 수 × 4 ≈ 예전 꽃 수)
  const meadows = meadowFlowers(4242, onLand);
  const flowers = widen(
    clusterFlowers(scatter(450, 37, 3.5, OLD_WORLD - 1, onLand, oldGround), 4, 38, onLand, oldGround),
    clusterFlowers(scatter(700, 137, OLD_WORLD - 6, WORLD - 1, onLand), 4, 138, onLand),
  ).concat(meadows.flowers);
  // 꽃은 바람에 살랑인다: 줄기는 밑동에서 휘고 꽃송이는 줄기 끝을 따라간다. 송이마다 조금씩 다른 박자로 흔들린다.
  // 줄기와 꽃송이는 서로 다르게 돌려 놓은 인스턴스라, 흔들림을 세계 방향으로 구해 각자의 공간으로 되돌려 더한다(그래야 꽃송이가 줄기 끝에 붙어 있다)
  // 그림자는 너무 작아 흔들지 않는다
  const flowerWind = (k: string) => `
    vec2 fp = instanceMatrix[3].xz;
    float flutter = 0.7 + 0.5 * sin(uWindTime * 2.6 + fp.x * 0.9 + fp.y * 1.3);
    transformed += inverse(mat3(instanceMatrix)) * vec3(wind.x, 0.0, wind.y) * ${f(SWAY_FLOWER)} * flutter * (${k});`;
  const stemWind = flowerWind("pow((position.y + 0.15) / 0.32, 2.0)");
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  tiled(instanced(root, stemGeometry(), sway(new THREE.MeshStandardMaterial({ roughness: 1 }), windTime, "stem", stemWind, flowerFade), flowers, (t, o, col) => {
    // 줄기는 꽃마다 길이와 기운 방향이 다르고, 잎이 붙은 쪽도 돌려 놓는다
    o.position.add(new THREE.Vector3(0, 0.15 * t.b.len, 0).applyQuaternion(t.b.lean));
    o.quaternion.copy(t.b.lean).multiply(q.setFromAxisAngle(up, t.b.yaw));
    o.scale.set(1, t.b.len, 1);
    col.set("#88b57a");
  }, TILE.flower), undefined, true);
  // 꽃송이: 줄기 끝에서 기운 쪽으로 더 숙인다. 꽃잎 수(5·6)마다 메시가 따로다
  for (const n of [5, 6]) {
    tiled(instanced(root, flowerHeadGeometry(n), withCenter(sway(new THREE.MeshStandardMaterial({ roughness: 0.9 }), windTime, `bud${n}`, flowerWind("0.88"), flowerFade)), flowers.filter((t) => t.b.petals === n), (t, o, col) => {
      o.position.add(t.b.tip);
      o.quaternion.copy(t.b.head);
      o.scale.setScalar(t.b.size);
      col.setHSL(t.b.hue, t.b.sat, t.b.light);
    }, TILE.flower), undefined, true);
  }
  const rockOk = (_x: number, y: number) => y > WATER_Y + 0.2;
  // 주울 수 없는 큰 바위. 줍는 돌과 구별되도록 한참 크다
  tiled(instanced(root, stoneGeometry(3), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), widen(scatter(90, 71, 7, OLD_WORLD + 4, rockOk, oldGround), scatter(140, 171, OLD_WORLD - 6, WORLD + 4, rockOk)), (t, o, col) => {
    const s = 0.9 + t.r() * 1.3;
    o.scale.set(s * 1.4, s, s * 1.2);
    o.rotation.set((t.r() - 0.5) * 0.4, t.r() * 6, 0);
    o.position.y += s * 0.25;
    col.setHSL(0.09, 0.06, 0.55 + t.r() * 0.15);
  }, TILE.rock));

  hillStairs(root);

  const sph = new THREE.Sphere(), fwd = new THREE.Vector3(), to = new THREE.Vector3();
  return {
    // 보이는 작은 나무 밑동 자리(NPC가 찾아간다)
    trees: trees.filter((t) => !t.hide).map((t) => ({ x: t.x, z: t.z })),
    // 보이는 꽃송이 자리와 그 윗면 높이(나비가 앉는다)
    flowers: flowers.filter((t) => !t.hide).map((t) => ({ x: t.x + t.b.tip.x, z: t.z + t.b.tip.z, top: t.y + t.b.tip.y + 0.03 })),
    // 꽃 군락지 가운데와 반지름(나비가 많이 산다)
    meadows: meadows.centers,
    // cam·fog를 주면 칸을 거른다. 안개 끝(시선 깊이)보다 먼 칸은 안개색뿐이라 끄고, 꽃은 안개가 시작하는 거리 근처에서 줄여 없앤다
    update(dt: number, cam?: THREE.Camera, fog?: THREE.Fog) {
      windTime.value += dt;
      if (!cam || !fog) return;
      flowerFade.value.set(fog.near * FLOWER_FADE[0], fog.near * FLOWER_FADE[1]);
      cam.getWorldDirection(fwd);
      for (const [o, s, flower] of cull) {
        sph.copy(s).applyMatrix4(o.matrixWorld);
        to.subVectors(sph.center, cam.position);
        o.visible = to.dot(fwd) - sph.radius < fog.far && (!flower || to.length() - sph.radius < flowerFade.value.y);
      }
    },
  };
}

// 동산 계단과 난간, 꼭대기 울타리. 디딤판 높이는 걷는 높이와 같은 TREADS를 쓴다
function hillStairs(root: THREE.Object3D) {
  const { tread: TREAD, half: HALF, rail: RAIL } = STAIR, POST_H = 0.85, GAP = 1.6;
  const r = rng(501), wood = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const steps: { x: number; y: number; z: number; h: number; yaw: number }[] = [];
  const posts: { x: number; y: number; z: number }[] = [];
  const rails: { x: number; y: number; z: number; to: THREE.Vector3 }[] = [];
  const post = (x: number, z: number) => {
    const p = { x, y: terrainY(x, z), z };
    posts.push(p);
    return new THREE.Vector3(x, p.y + POST_H, z);
  };
  const rail = (a: THREE.Vector3, b: THREE.Vector3) => {
    for (const dy of [0, -0.4]) rails.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + dy, z: (a.z + b.z) / 2, to: new THREE.Vector3(b.x, b.y + dy, b.z) });
  };
  const top = HILL.plateauR, edge = Math.sqrt(top * top - RAIL * RAIL);
  HILL.stairs.forEach((a, s) => {
    const ux = Math.cos(a), uz = Math.sin(a);
    const at = (d: number, lat: number) => [HILL.x + ux * d - uz * lat, HILL.z + uz * d + ux * lat] as const;
    const yAt = (d: number, lat: number) => { const [x, z] = at(d, lat); return terrainY(x, z) - stairDip(x, z); };
    TREADS[s].forEach((hi, i) => {
      const d = STAIR.d0 + TREAD * (i + 0.5);
      const lo = Math.min(yAt(d + TREAD / 2, -HALF), yAt(d + TREAD / 2, HALF), yAt(d + TREAD / 2, 0));
      const [x, z] = at(d, 0);
      steps.push({ x, y: hi, z, h: hi - lo + 0.2, yaw: Math.atan2(ux, uz) });
    });
    // 난간은 발치 쪽 railEnd까지. 그 너머는 걸어 들어오는 입구가 벌어진다
    const end = STAIR.railEnd;
    const n = Math.ceil((end - edge) / GAP);
    for (const side of [-1, 1]) {
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= n; i++) {
        const p = post(...at(edge + ((end - edge) * i) / n, side * RAIL));
        if (prev) rail(prev, p);
        prev = p;
      }
    }
  });
  // 꼭대기 테두리: 계단 입구 사이를 잇는다
  const open = Math.asin(RAIL / top), sorted = [...HILL.stairs].sort((p, q) => p - q);
  sorted.forEach((a, i) => {
    const from = a + open, to = (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2) - open;
    const n = Math.ceil(((to - from) * top) / GAP);
    let prev: THREE.Vector3 | null = null;
    for (let k = 0; k <= n; k++) {
      const t = from + ((to - from) * k) / n;
      const p = new THREE.Vector3(HILL.x + Math.cos(t) * top, HILL.topY + POST_H, HILL.z + Math.sin(t) * top);
      if (k > 0 && k < n) posts.push({ x: p.x, y: HILL.topY, z: p.z }); // 양 끝은 계단 기둥과 같은 자리
      if (prev) rail(prev, p);
      prev = p;
    }
  });
  const woodCol = (c: THREE.Color, v = 0.06) => c.set("#9a7452").offsetHSL((r() - 0.5) * 0.02, 0, (r() - 0.5) * v);
  instanced(root, new THREE.BoxGeometry(1, 1, 1), wood, steps, (s, o, c) => {
    o.position.y -= s.h / 2;
    o.rotation.y = s.yaw;
    o.scale.set(HALF * 2, s.h, TREAD + 0.01);
    woodCol(c, 0.1);
  });
  // 기둥은 0.3m 땅에 박는다
  instanced(root, new THREE.BoxGeometry(0.11, POST_H + 0.35, 0.11), wood, posts, (_p, o, c) => {
    o.position.y += (POST_H + 0.35) / 2 - 0.3;
    woodCol(c);
  });
  instanced(root, new THREE.BoxGeometry(0.07, 0.07, 1), wood, rails, (l, o, c) => {
    o.lookAt(l.to);
    o.scale.z = o.position.distanceTo(l.to) * 2 + 0.06;
    woodCol(c);
  });
}
