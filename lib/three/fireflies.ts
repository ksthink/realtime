import * as THREE from "three";
import { WATER_Y, WORLD, isWater, rng, terrainY, waterDistance } from "../terrain";

// ── 반딧불이: 어두워지면 물가와 풀숲에서 은은하게 깜빡이며 떠다닌다 ──
// 사는 곳은 세계 곳곳에 시드로 정해 두어 모든 접속자에게 같다(덤불·꽃밭·물가).
// 실제로 움직이는 건 내 캐릭터 가까이 있는 사는 곳의 반딧불이뿐이다(풀 크기가 상한).
// 한 마리 = 점 하나. THREE.Points 하나로 그려 그리기 호출은 한 번, 진짜 빛은 쓰지 않는다

const ACTIVE = 35; // 사는 곳이 이 거리 안이면 나타난다(m)
const LEAVE = ACTIVE + 8; // 이보다 멀어지면 거둔다
const FADE_FAR = [24, 38] as const; // 이 거리에서 흐려져 없어진다. 안개와 상관없이 직접 줄인다
const SIZE = 0.18; // 빛무리 반지름(m). 가운데 점은 이보다 훨씬 작다
const ALT = [0.3, 2.5] as const; // 나는 높이(땅·수면 위, m)
const SPEED = [0.25, 0.55] as const;
const NIGHT = [0.3, 0.85] as const; // night가 이 사이에서 0→1로 나타난다
const GLOW = "0.78, 0.95, 0.42", CORE = "1.0, 1.0, 0.78"; // 연두빛 노랑 빛무리, 거의 흰 가운데(화면에 보일 색)

type Env = {
  perches: { x: number; y: number; z: number; kind: "tree" | "bush" | "wood" }[];
  flowers: { x: number; z: number; top: number }[];
  light: boolean; // 휴대폰이면 수를 줄인다
};
// 사는 곳: 가운데, 반경, 사는 수, 지금 나와 있는 수, 앉을 자리(x, y, z 이어 붙임)
type Home = { x: number; z: number; r: number; n: number; count: number; rest: number[]; ready: boolean };
type Fly = {
  home: Home | null; x: number; y: number; z: number; yaw: number; sp: number; alt: number; altT: number;
  mode: 0 | 1 | 2; // 0 날기, 1 앉으러 가기, 2 앉아 쉬기
  t: number; // 지금 하는 일의 남은 시간(초)
  rx: number; ry: number; rz: number; // 앉을 자리
  ph: number; per: number; // 깜빡임 위상과 주기(초)
  w1: number; w2: number; seed: number; fade: number; // 굽이 위상, 밤 깊이에 따라 나오는 순서(0~1), 나타나기(0~1)
  gy: number; gt: number; // 발밑 높이와 다시 잴 때까지 남은 시간(지형 계산을 매 프레임 하지 않는다)
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const angleTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const ground = (x: number, z: number) => Math.max(terrainY(x, z), WATER_Y);
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// 사는 곳: 물가 → 덤불 → 꽃 순으로 시드로 고르고 서로 9m 넘게 떨어뜨린다
function habitats(env: Env) {
  const r = rng(7707), homes: Home[] = [], light = env.light;
  const far = (x: number, z: number) => homes.every((h) => Math.hypot(h.x - x, h.z - z) > 9);
  const add = (x: number, z: number, rr: number, n: number) => homes.push({ x, z, r: rr, n: light ? Math.ceil(n / 2) : n, count: 0, rest: [], ready: false });
  // 물가: 마른 땅이면서 4m 안에 물이 있는 곳
  for (let k = 0, got = 0; k < 4000 && got < 24; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (WORLD - 4), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (isWater(x, z) || terrainY(x, z) > WATER_Y + 1.5 || !far(x, z) || waterDistance(x, z, 4) > 4) continue;
    add(x, z, 6, 5 + Math.floor(r() * 3)); got++;
  }
  const bushes = env.perches.filter((p) => p.kind === "bush");
  for (let k = 0, got = 0; k < 600 && got < 22 && bushes.length; k++) {
    const b = bushes[Math.floor(r() * bushes.length)];
    if (far(b.x, b.z)) { add(b.x, b.z, 5, 3 + Math.floor(r() * 3)); got++; }
  }
  for (let k = 0, got = 0; k < 600 && got < 18 && env.flowers.length; k++) {
    const f = env.flowers[Math.floor(r() * env.flowers.length)];
    if (far(f.x, f.z)) { add(f.x, f.z, 5, 3 + Math.floor(r() * 3)); got++; }
  }
  return { homes, bushes };
}
// 앉을 자리: 둘레의 덤불 위·꽃송이 위, 그리고 풀(땅 조금 위). 처음 나타날 때 한 번만 찾는다(시드라 늘 같다)
function restSpots(h: Home, env: Env, bushes: Env["perches"]) {
  const near = (x: number, z: number) => (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r, r = rng(Math.floor(h.x * 131 + h.z * 17));
  for (const b of bushes) if (h.rest.length < 36 && near(b.x, b.z)) h.rest.push(b.x, b.y + 0.02, b.z);
  for (const f of env.flowers) if (h.rest.length < 72 && near(f.x, f.z)) h.rest.push(f.x, f.top + 0.02, f.z);
  for (let k = 0; k < 20 && h.rest.length < 90; k++) {
    const a = r() * Math.PI * 2, d = r() * h.r, x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
    if (!isWater(x, z)) h.rest.push(x, terrainY(x, z) + 0.12, z);
  }
  h.ready = true;
}

export function makeFireflies(root: THREE.Object3D, env: Env) {
  const N = env.light ? 25 : 60; // 한꺼번에 나와 있는 최대 수
  const { homes, bushes } = habitats(env);
  const pos = new Float32Array(N * 3), glow = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), aGlow = new THREE.BufferAttribute(glow, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", aPos);
  geo.setAttribute("aGlow", aGlow);
  const uniforms = { uPx: { value: 1000 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: `
      uniform float uPx;
      attribute float aGlow;
      varying float vA;
      varying float vCore;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float far = smoothstep(${FADE_FAR[1].toFixed(1)}, ${FADE_FAR[0].toFixed(1)}, -mv.z) * smoothstep(0.3, 1.0, -mv.z);
        vA = aGlow * far;
        if (vA < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        gl_Position = projectionMatrix * mv;
        // 밝을 때 빛무리가 조금 커진다. 멀어도 2px보다 작아지지 않게
        float px = uPx * projectionMatrix[1][1] * ${SIZE.toFixed(3)} * (0.7 + 0.45 * aGlow) / -mv.z;
        gl_PointSize = clamp(px, 2.0, uPx * 0.12);
        vA *= min(1.0, px / 2.0); // 아주 작아지면 덜 밝게(멀리서 반짝거리지 않게)
        vCore = max(0.11, 1.4 / gl_PointSize); // 가운데 점은 적어도 1px 남짓
      }`,
    fragmentShader: `
      varying float vA;
      varying float vCore;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float halo = exp(-d * d * 3.5) * (1.0 - d); // 가장자리에서 0이 되는 부드러운 빛무리
        float core = smoothstep(vCore, vCore * 0.35, d);
        vec3 c = vec3(${GLOW}) * halo * 0.6 + vec3(${CORE}) * core * 0.9;
        gl_FragColor = vec4(c, vA);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // 내 둘레에만 있으므로 거르지 않는다
  points.renderOrder = 2; // 물·꽃잎 다음에 그린다
  points.visible = false;
  const size = new THREE.Vector2();
  points.onBeforeRender = (renderer) => { uniforms.uPx.value = renderer.getDrawingBufferSize(size).y; };
  root.add(points);

  const list: Fly[] = Array.from({ length: N }, (_, i) => ({
    home: null, x: 0, y: 0, z: 0, yaw: 0, sp: 0.4, alt: 1, altT: 1, mode: 0, t: 0, rx: 0, ry: 0, rz: 0,
    ph: Math.random() * 6.283, per: 2, w1: Math.random() * 100, w2: Math.random() * 100, seed: (i * 0.618034) % 1, fade: 0, gy: 0, gt: 0,
  }));
  const takeOff = (f: Fly) => { f.mode = 0; f.t = rand(5, 15); f.altT = ALT[0] + Math.pow(Math.random(), 1.6) * (ALT[1] - ALT[0]); f.sp = rand(SPEED[0], SPEED[1]); };
  const spawn = (f: Fly, h: Home) => {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * h.r;
    if (!h.ready) restSpots(h, env, bushes);
    f.home = h; f.x = h.x + Math.cos(a) * d; f.z = h.z + Math.sin(a) * d;
    f.alt = rand(0.4, 1.6); f.y = ground(f.x, f.z) + f.alt; f.yaw = Math.random() * 6.283;
    f.per = rand(2, 3.6); f.fade = 0; f.gt = 0;
    takeOff(f); f.t = rand(1, 12);
  };

  // 0.5초마다: 멀어진 사는 곳의 반딧불이는 거두고, 가까운 사는 곳부터 빈자리를 채운다
  const order = homes.slice(), dist = new Map<Home, number>(homes.map((h) => [h, 0]));
  const byDist = (a: Home, b: Home) => dist.get(a)! - dist.get(b)!;
  let wait = 0;
  const assign = (player: THREE.Vector3) => {
    for (const h of homes) dist.set(h, Math.hypot(h.x - player.x, h.z - player.z));
    for (const f of list) if (f.home && dist.get(f.home)! > LEAVE) { f.home.count--; f.home = null; }
    order.sort(byDist);
    let free = 0;
    for (const h of order) {
      if (dist.get(h)! > ACTIVE) break;
      while (h.count < h.n) {
        while (free < N && list[free].home) free++;
        if (free >= N) return;
        spawn(list[free], h); h.count++;
      }
    }
  };

  let now = 0;
  return {
    points,
    // lantern: 내 랜턴 자리(없으면 null). 호기심 많은 몇 마리가 둘레로 살짝 모여들어 맴돈다
    update(dt: number, player: THREE.Vector3, night: number, lantern: THREE.Vector3 | null = null) {
      const k = smooth(NIGHT[0], NIGHT[1], night);
      if (k <= 0) { points.visible = false; return; } // 낮에는 아무것도 하지 않는다
      points.visible = true;
      now += dt;
      if ((wait -= dt) <= 0) { wait = 0.5; assign(player); }
      for (let i = 0; i < N; i++) {
        const f = list[i], h = f.home;
        if (!h) { glow[i] = 0; continue; }
        const px = f.x - player.x, pz = f.z - player.z, pd = Math.sqrt(px * px + pz * pz);
        if (f.mode === 2) {
          // 앉아 쉬기: 자리에 붙어 천천히 깜빡인다. 캐릭터가 아주 가까이 오면 날아오른다
          f.x += (f.rx - f.x) * Math.min(1, dt * 4); f.y += (f.ry - f.y) * Math.min(1, dt * 4); f.z += (f.rz - f.z) * Math.min(1, dt * 4);
          if ((f.t -= dt) <= 0 || pd < 0.9) { takeOff(f); f.alt = f.y - ground(f.x, f.z); }
        } else {
          if ((f.gt -= dt) <= 0) { f.gt = 0.3; f.gy = ground(f.x, f.z); }
          const g = f.gy;
          let want = f.yaw;
          if (f.mode === 0) {
            // 날기: 느리게 굽이굽이. 두 사인파를 섞어 도는 방향이 천천히 바뀐다
            f.yaw += (Math.sin(now * 0.53 + f.w1) * 0.8 + Math.sin(now * 0.21 + f.w2) * 0.6) * dt;
            want = f.yaw;
            if ((f.x - h.x) ** 2 + (f.z - h.z) ** 2 > h.r * h.r) want = Math.atan2(h.x - f.x, h.z - f.z); // 제 터로 돌아온다
            if (pd < 1.6) want = Math.atan2(px, pz); // 캐릭터를 살짝 비켜 간다
            // 랜턴: 네 마리 중 한 마리꼴로, 5m 안이면 랜턴 둘레 0.6~1m를 천천히 돈다(제 터를 벗어나도 따라온다)
            if (lantern && f.seed < 0.25 && (f.x - lantern.x) ** 2 + (f.z - lantern.z) ** 2 < 25) {
              const a = now * 0.35 + f.w1 * 6, r = 0.6 + (f.w2 % 1) * 0.4;
              want = Math.atan2(lantern.x + Math.sin(a) * r - f.x, lantern.z + Math.cos(a) * r - f.z);
              f.altT = Math.max(0.3, lantern.y - g + Math.sin(now * 0.8 + f.w2) * 0.3);
              f.t = Math.max(f.t, 1); // 맴도는 동안은 앉으러 가지 않는다
            }
            if (Math.random() < dt * 0.15) f.altT = ALT[0] + Math.pow(Math.random(), 1.6) * (ALT[1] - ALT[0]);
            if ((f.t -= dt) <= 0) {
              // 앉을 자리를 고른다(캐릭터 바로 옆은 피한다)
              const j = Math.floor(Math.random() * (h.rest.length / 3)) * 3;
              if (h.rest.length && Math.hypot(h.rest[j] - player.x, h.rest[j + 2] - player.z) > 1.5) {
                f.rx = h.rest[j]; f.ry = h.rest[j + 1]; f.rz = h.rest[j + 2]; f.mode = 1; f.t = 15;
              } else f.t = rand(2, 5);
            }
          } else {
            // 앉으러 가기: 자리 쪽으로 돌며 내려간다
            const dx = f.rx - f.x, dz = f.rz - f.z, hd = Math.sqrt(dx * dx + dz * dz);
            want = Math.atan2(dx, dz);
            f.altT = Math.max(0, f.ry - g) + Math.min(hd * 0.5, 1.2);
            if (hd < 0.6) { f.sp = Math.max(0.12, hd * 0.6); }
            if (hd < 0.12 && Math.abs(f.ry - f.y) < 0.12) { f.mode = 2; f.t = rand(3, 9); }
            else if ((f.t -= dt) <= 0 || pd < 1.2) takeOff(f);
          }
          f.yaw += angleTo(f.yaw, want) * Math.min(1, dt * (f.mode === 1 ? 3 : 1.2));
          f.x += Math.sin(f.yaw) * f.sp * dt; f.z += Math.cos(f.yaw) * f.sp * dt;
          f.alt += (f.altT - f.alt) * Math.min(1, dt * (f.mode === 1 ? 1.5 : 0.35));
          const bob = f.mode === 0 ? Math.sin(now * 1.3 + f.w1) * 0.12 : 0;
          const ty = Math.max(g + (f.mode === 1 ? 0.03 : ALT[0] * 0.6), g + f.alt + bob);
          f.y += (ty - f.y) * Math.min(1, dt * (f.mode === 1 ? 4 : 2));
        }
        // 깜빡임: 1~3초에 걸쳐 천천히 밝아졌다 어두워진다. 쉬는 동안은 더 느리고 조금 흐리게
        f.ph += (dt / (f.per * (f.mode === 2 ? 1.6 : 1))) * 6.283;
        const s = 0.5 - 0.5 * Math.cos(f.ph), b = 0.06 + 0.94 * s * s;
        f.fade = Math.min(1, f.fade + dt * 0.6);
        // 해 질 녘엔 몇 마리만, 밤이 깊을수록 다 나온다
        const show = Math.min(1, Math.max(0, (k - f.seed * 0.6) / 0.4));
        glow[i] = b * (f.mode === 2 ? 0.8 : 1) * f.fade * show;
        pos[i * 3] = f.x; pos[i * 3 + 1] = f.y; pos[i * 3 + 2] = f.z;
      }
      aPos.needsUpdate = true; aGlow.needsUpdate = true;
    },
    dispose() {
      root.remove(points);
      geo.dispose();
      mat.dispose();
    },
  };
}
