import * as THREE from "three";
import { HILL, STAIR, TREADS, WATER_Y, WORLD, baseTerrainY, clamp, rimY, rng, stairDip, terrainY, vnoise } from "../terrain";
import { buildBigTree } from "./bigtree";
import { WIND_DIR } from "./petals";
import { stoneGeometry } from "./stone";
import { tickWater, waterMaterial } from "./water";

// 바람 세기. 값은 최대 흔들림(m)이고, 0이면 그 부위가 멈춘다. RIPPLE은 수관 표면 일렁임(반지름 비율)
const SWAY_CANOPY = 0.035, SWAY_BUSH = 0.03, SWAY_FLOWER = 0.02, RIPPLE = 0.012;

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
function widen(old: Item[], ring: Item[], tall = Infinity) {
  for (const it of old) {
    const dx = it.x - HILL.x, dz = it.z - HILL.z, d = Math.hypot(dx, dz);
    it.hide = Math.hypot(it.x, it.z) > OLD_WORLD - 6 || d < HILL.plateauR + 0.6 || it.y - baseTerrainY(it.x, it.z) > tall
      || d < HILL.r + 0.5 && HILL.stairs.some((a) => dx * Math.cos(a) + dz * Math.sin(a) > 0 && Math.abs(dz * Math.cos(a) - dx * Math.sin(a)) < STAIR.half + 1.2);
  }
  return old.concat(ring);
}

// hide인 것도 place는 불러 난수를 똑같이 쓰고, 그리지만 않는다.
// tile(m)을 주면 그 격자 칸마다 메시를 따로 만든다. 칸마다 경계구가 작아져 화면·그림자 카메라 밖 칸은 three가 그리지 않는다
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
    const grass = new THREE.Color("#b9cf9d"), grass2 = new THREE.Color("#9fbf86"), sand = new THREE.Color("#e3d7b8"), lakebed = new THREE.Color("#a2a184"), rock = new THREE.Color("#aaa6a8"), snow = new THREE.Color("#f1f0f4");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = terrainY(x, z);
      pos.setY(i, y - stairDip(x, z));
      // 바위색·눈은 동산을 뺀 땅으로 정해 동산은 풀빛으로 남는다
      // 가장자리 산줄기는 기울기를 반만 쳐서 대부분 풀빛 산자락으로 두고 아주 가파른 곳만 바위색을 띤다
      const rocky = (px: number, pz: number) => baseTerrainY(px, pz) - rimY(px, pz) * 0.5;
      const by = baseTerrainY(x, z), slope = Math.hypot(rocky(x + 0.5, z) - rocky(x - 0.5, z), rocky(x, z + 0.5) - rocky(x, z - 0.5));
      c.copy(grass).lerp(grass2, vnoise(x * 0.3, z * 0.3));
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
  const trees = widen(scatter(620, 11, 8, OLD_WORLD + 3, treeOk, oldGround), scatter(860, 111, OLD_WORLD - 6, WORLD + 3, treeOk), 3);
  tiled(instanced(root, new THREE.CylinderGeometry(0.1, 0.17, 1, 7), new THREE.MeshStandardMaterial({ roughness: 1 }), trees, (t, o, col) => {
    const h = 0.9 + t.r() * 0.8;
    o.position.y += h / 2;
    o.scale.set(1, h, 1);
    col.set("#8b6a52").offsetHSL(0, 0, (t.r() - 0.5) * 0.1);
  }, TILE.trunk));
  const canopy: { x: number; y: number; z: number; s: number; hue: number; l: number; hide?: boolean }[] = [];
  for (const t of trees) {
    const h = 0.9 + t.r() * 0.8, k = 2 + Math.floor(t.r() * 2), hue = 0.25 + t.r() * 0.12, l = 0.5 + t.r() * 0.15;
    for (let i = 0; i < k; i++) canopy.push({ x: t.x + (t.r() - 0.5) * 0.5, y: t.y + h + 0.3 + i * 0.45 * (t.r() + 0.5), z: t.z + (t.r() - 0.5) * 0.5, s: 0.55 + t.r() * 0.5, hue, l, hide: t.hide });
  }
  // 수관과 덤불은 그림자도 같이 흔든다. 어긋나면 표면이 제 그림자 안으로 들어가 얼룩이 생길 수 있다
  tiled(instanced(root, new THREE.SphereGeometry(1, 12, 9), sway(new THREE.MeshStandardMaterial({ roughness: 0.95 }), windTime, "canopy", canopyWind), canopy, (t, o, col) => {
    o.scale.set(t.s * 1.1, t.s * 0.9, t.s * 1.1);
    col.setHSL(t.hue, 0.45, t.l);
  }, TILE.canopy), sway(new THREE.MeshDepthMaterial(), windTime, "canopy", canopyWind));
  tiled(instanced(root, new THREE.SphereGeometry(1, 10, 8), sway(new THREE.MeshStandardMaterial({ roughness: 1 }), windTime, "bush", bushWind), widen(scatter(420, 23, 5, OLD_WORLD + 1, onLand, oldGround), scatter(680, 123, OLD_WORLD - 6, WORLD + 1, onLand)), (t, o, col) => {
    const s = 0.35 + t.r() * 0.45;
    o.position.y += s * 0.5;
    o.scale.set(s * 1.3, s * 0.8, s * 1.2);
    col.setHSL(0.28 + t.r() * 0.08, 0.4, 0.5 + t.r() * 0.12);
  }, TILE.bush), sway(new THREE.MeshDepthMaterial(), windTime, "bush", bushWind));
  const flowers = widen(scatter(1800, 37, 3.5, OLD_WORLD - 1, onLand, oldGround), scatter(2790, 137, OLD_WORLD - 6, WORLD - 1, onLand));
  // 꽃 줄기는 밑동에서 휘고 봉오리는 줄기 끝을 따라간다. 그림자는 너무 작아 그대로 둔다
  const stemWind = `float bend = (position.y + 0.15) / 0.32; transformed.xz += wind * ${f(SWAY_FLOWER)} * bend * bend;`;
  tiled(instanced(root, new THREE.CylinderGeometry(0.018, 0.022, 0.3, 5), sway(new THREE.MeshStandardMaterial({ roughness: 1 }), windTime, "stem", stemWind, flowerFade), flowers, (_t, o, col) => {
    o.position.y += 0.15;
    col.set("#88b57a");
  }, TILE.flower), undefined, true);
  tiled(instanced(root, new THREE.SphereGeometry(0.09, 8, 6), sway(new THREE.MeshStandardMaterial({ roughness: 0.9 }), windTime, "bud", `transformed.xz += wind * ${f(SWAY_FLOWER)};`, flowerFade), flowers, (t, o, col) => {
    o.position.y += 0.32;
    o.scale.set(1, 0.55, 1);
    col.setHSL([0, 0.08, 0.14, 0.78, 0.9, 0.55][Math.floor(t.r() * 6)], 0.6, 0.72);
  }, TILE.flower), undefined, true);
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
