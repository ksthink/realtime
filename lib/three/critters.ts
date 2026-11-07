import * as THREE from "three";
import { WATER_Y, WORLD, rng, terrainY, walkY } from "../terrain";
import { WIND_DIR } from "./petals";

// ── 작은 동물들: 나비, 물고기, 작은 새 ──
// 사는 곳(꽃밭·물웅덩이)은 세계 곳곳에 시드로 정해 두어 모든 접속자에게 같다. 동물이 많은 곳과 없는 곳이 생긴다.
// 실제로 움직이는 건 내 캐릭터 가까이(ACTIVE) 있는 사는 곳의 동물뿐이고, 움직임은 접속자끼리 맞추지 않는다.
// 부위마다 InstancedMesh 하나로 그려 그리기 호출은 부위 수만큼이다. 모양은 단순하게, 대신 귀엽게:
// 큰 머리·큰 눈과 반짝임, 볼 홍조, 파스텔색, 통통 튀는 움직임

const ACTIVE = 35; // 사는 곳이 이 거리 안이면 동물이 나타나 움직인다(m)
const LEAVE = ACTIVE + 8; // 이보다 멀어지면 사라진다. 경계에서 깜빡이지 않게 조금 넉넉히
const FLY_SPEED = 1.1, FISH_SPEED = 0.6;

export type CritterEnv = {
  flowers: { x: number; z: number; top: number }[]; // 꽃송이 자리와 윗면 높이
  meadows: { x: number; z: number; r: number }[]; // 꽃 군락지: 나비가 여럿 산다
  perches: { x: number; y: number; z: number; kind: "tree" | "bush" | "wood" }[]; // 새가 앉는 자리
  splash: (x: number, z: number, yaw: number) => void;
  light: boolean; // 휴대폰이면 수를 줄인다
};

// ── 부위: 지오메트리 하나 = InstancedMesh 하나. 생물마다 per개씩 쓴다 ──
type Part = { mesh: THREE.InstancedMesh; per: number };
function part(root: THREE.Object3D, geo: THREE.BufferGeometry, n: number, per: number, opts: THREE.MeshStandardMaterialParameters = {}, flat = false): Part {
  // flat: 빛을 받지 않는 재질. 얇은 날개는 뒷면이 어둡게 칠해지지 않도록 이걸 쓴다
  const mat = flat ? new THREE.MeshBasicMaterial({ vertexColors: opts.vertexColors, side: opts.side }) : new THREE.MeshStandardMaterial({ roughness: 0.75, ...opts });
  const mesh = new THREE.InstancedMesh(geo, mat, n * per);
  mesh.frustumCulled = false; // 내 둘레에만 있으므로 거르지 않는다
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // 부위 색은 인스턴스 색으로 칠한다. 처음 그리기 전에 만들어 둬야 셰이더가 인스턴스 색을 쓴다
  for (let i = 0; i < n * per; i++) { mesh.setMatrixAt(i, ZERO); mesh.setColorAt(i, WHITE); }
  root.add(mesh);
  return { mesh, per };
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), WHITE = new THREE.Color(1, 1, 1);
const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
// base(생물의 자리·방향) × 부위의 자리·회전·크기
function put(p: Part, i: number, k: number, base: THREE.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _l.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  p.mesh.setMatrixAt(i * p.per + k, _m.multiplyMatrices(base, _l));
}
function hide(p: Part, i: number) { for (let k = 0; k < p.per; k++) p.mesh.setMatrixAt(i * p.per + k, ZERO); }
function tint(p: Part, i: number, c: THREE.Color) { for (let k = 0; k < p.per; k++) p.mesh.setColorAt(i * p.per + k, c); }
const pastel = (h: number, s = 0.6, l = 0.8) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const angleTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// ── 사는 곳 ──
// x, z, 반경 r, 사는 수 n. members는 지금 그곳에 나타나 있는 동물 번호
type Home = { x: number; z: number; r: number; n: number; members: number[] };
type Dweller = { on: boolean; home: Home | null };
// 0.5초마다: 멀어진 사는 곳의 동물은 거두고, 가까운 사는 곳부터 빈 동물을 채운다(풀 크기가 상한)
function makeAssigner<T extends Dweller>(homes: Home[], list: T[], spawn: (c: T, i: number, h: Home) => void, hide: (i: number) => void) {
  let wait = 0;
  return (dt: number, player: THREE.Vector3) => {
    if ((wait -= dt) > 0) return;
    wait = 0.5;
    const dist = (h: Home) => Math.hypot(h.x - player.x, h.z - player.z);
    for (const h of homes) {
      if (!h.members.length || dist(h) < LEAVE) continue;
      for (const i of h.members) { list[i].on = false; list[i].home = null; hide(i); }
      h.members = [];
    }
    const near = homes.filter((h) => h.members.length < h.n && dist(h) < ACTIVE).sort((a, b) => dist(a) - dist(b));
    let free = 0;
    for (const h of near) {
      while (h.members.length < h.n) {
        while (free < list.length && list[free].on) free++;
        if (free >= list.length) return;
        list[free].on = true; list[free].home = h;
        h.members.push(free);
        spawn(list[free], free, h);
      }
    }
  };
}

// ── 나비 ──
// 앞이 +z, 위가 +y. 날개는 몸통 축(z)을 경첩으로 위아래로 친다
function wingGeometry() {
  const g = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2).translate(1, 0, 0); // 경첩이 x=0
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i) - 1, pos.getZ(i)); // 날개 가운데에서의 거리(0~1)
    const v = 0.78 + 0.22 * d * d; // 가운데는 조금 진하고 가장자리는 밝게
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

type Butterfly = Dweller & {
  p: THREE.Vector3; yaw: number; bank: number; rest: boolean; t: number; flap: number;
  target: { x: number; z: number; top: number } | null; seed: number;
  flee: number; // 남은 달아나기 시간(초). 0보다 크면 캐릭터 반대쪽으로 높이 날아간다
};
const FLEE_NEAR = 2.5; // 캐릭터가 이만큼 다가오면 달아난다(m)

// 꽃밭: 꽃 자리 중에서 시드로 고르고 서로 14m 넘게 떨어뜨린다. 한 곳에 2~3마리(휴대폰은 1~2마리)
const FIELDS = 32;
function flowerFields(env: CritterEnv) {
  const r = rng(7701);
  // 꽃 군락지에는 나비가 5마리(휴대폰 3마리)씩
  const homes: Home[] = env.meadows.map((m) => ({ x: m.x, z: m.z, r: m.r + 1, n: env.light ? 3 : 5, members: [] }));
  for (let k = 0; k < 4000 && homes.length < FIELDS && env.flowers.length; k++) {
    const f = env.flowers[Math.floor(r() * env.flowers.length)], n = 2 + Math.floor(r() * 2);
    if (homes.every((h) => Math.hypot(h.x - f.x, h.z - f.z) > 14)) homes.push({ x: f.x, z: f.z, r: 6, n: env.light ? Math.ceil(n / 2) : n, members: [] });
  }
  return homes;
}

function makeButterflies(root: THREE.Object3D, n: number, env: CritterEnv) {
  const S = 1.05; // 게임 카메라에서 보이도록 실제보다 조금 크게
  const body = part(root, new THREE.CapsuleGeometry(0.018, 0.045, 4, 8).rotateX(Math.PI / 2), n, 1);
  const head = part(root, new THREE.SphereGeometry(0.034, 12, 10), n, 1);
  const eye = part(root, new THREE.SphereGeometry(0.0095, 10, 8), n, 2, { color: "#2f2a36", roughness: 0.35 });
  const shine = part(root, new THREE.SphereGeometry(0.0033, 6, 5), n, 2, { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6 });
  // 더듬이는 짧고 가늘게, 머리와 같은 색으로 해서 눈에 덜 띄게
  const stalk = part(root, new THREE.CylinderGeometry(0.002, 0.002, 0.045, 4).translate(0, 0.0225, 0), n, 2);
  const knob = part(root, new THREE.SphereGeometry(0.007, 8, 6), n, 2);
  const wingGeo = wingGeometry();
  const upper = part(root, wingGeo, n, 2, { vertexColors: true, side: THREE.DoubleSide }, true);
  const lower = part(root, wingGeo, n, 2, { vertexColors: true, side: THREE.DoubleSide }, true);

  // 꽃 찾기: 8m 칸으로 나눠 둔다
  const CELL = 8, grid = new Map<string, number[]>();
  env.flowers.forEach((f, i) => { const k = `${Math.floor(f.x / CELL)},${Math.floor(f.z / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const flowerNear = (x: number, z: number, r: number) => {
    const out: number[] = [];
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++)
        for (const i of grid.get(`${cx},${cz}`) ?? []) if (Math.hypot(env.flowers[i].x - x, env.flowers[i].z - z) < r) out.push(i);
    return out.length ? env.flowers[out[Math.floor(Math.random() * out.length)]] : null;
  };
  const top = (f: { top: number }) => f.top + 0.02; // 꽃송이 위
  // (x, z) 둘레 r 안의 꽃 중 캐릭터에서 FLEE_NEAR보다 넉넉히 떨어진 것. 다가갔다 놀라 달아나기를 되풀이하지 않게
  const flowerAway = (x: number, z: number, r: number, player: THREE.Vector3) => {
    for (let k = 0; k < 5; k++) {
      const f = flowerNear(x, z, r);
      if (f && Math.hypot(f.x - player.x, f.z - player.z) > FLEE_NEAR + 1.5) return f;
    }
    return null;
  };

  const list: Butterfly[] = Array.from({ length: n }, (_, i) => ({ on: false, home: null, p: new THREE.Vector3(), yaw: 0, bank: 0, rest: false, t: 0, flap: 0, target: null, seed: i * 1.37, flee: 0 }));
  const homes = flowerFields(env);
  const spawn = (b: Butterfly, i: number, home: Home) => {
    const f = flowerNear(home.x, home.z, home.r) ?? { x: home.x, z: home.z, top: terrainY(home.x, home.z) + 0.35 };
    b.rest = false; b.target = f; b.t = 0; b.flee = 0;
    b.p.set(f.x + rand(-3, 3), top(f) + rand(0.6, 1.4), f.z + rand(-3, 3));
    b.yaw = Math.random() * Math.PI * 2;
    const h = Math.random(), wing = pastel(h, 0.8, 0.7);
    tint(upper, i, wing); tint(lower, i, pastel(h + 0.08, 0.75, 0.76));
    tint(body, i, pastel(h + 0.5, 0.25, 0.45)); tint(head, i, pastel(h + 0.5, 0.25, 0.5)); tint(stalk, i, pastel(h + 0.5, 0.25, 0.5)); tint(knob, i, pastel(h + 0.5, 0.3, 0.6));
  };
  let colorsDirty = true;
  const base = new THREE.Matrix4(), parts = [body, head, eye, shine, stalk, knob, upper, lower];
  const assign = makeAssigner(homes, list, (b, i, h) => { spawn(b, i, h); colorsDirty = true; }, (i) => { for (const p of parts) hide(p, i); });

  return {
    update(dt: number, player: THREE.Vector3, now: number) {
      assign(dt, player);
      list.forEach((b, i) => {
        if (!b.on) return;
        const h = b.home!;
        b.t += dt;
        // 캐릭터가 다가오면 앉아 있든 날고 있든 놀라 달아난다
        if (b.flee <= 0 && Math.hypot(b.p.x - player.x, b.p.z - player.z) < FLEE_NEAR) { b.flee = rand(1.8, 2.6); b.rest = false; b.t = 0; }
        const f = b.target!;
        if (b.flee > 0) {
          // 캐릭터 반대쪽으로 빠르게, 위로 솟아오르며. 다 달아나면 그쪽 멀리 있는 꽃을 새로 찾는다
          b.flee -= dt;
          b.flap = Math.sin(now * 24 + b.seed) * 1.0;
          const want = Math.atan2(b.p.x - player.x, b.p.z - player.z) + Math.sin(now * 3 + b.seed) * 0.3;
          const turn = angleTo(b.yaw, want);
          b.yaw += turn * Math.min(1, dt * 6);
          b.bank += (THREE.MathUtils.clamp(turn, -0.6, 0.6) - b.bank) * Math.min(1, dt * 4);
          b.p.x += Math.sin(b.yaw) * FLY_SPEED * 2 * dt;
          b.p.z += Math.cos(b.yaw) * FLY_SPEED * 2 * dt;
          b.p.y += (terrainY(b.p.x, b.p.z) + 2.2 - b.p.y) * Math.min(1, dt * 2);
          if (b.flee <= 0) {
            b.target = flowerAway(h.x, h.z, h.r, player) ?? flowerNear(h.x, h.z, h.r) ?? f; // 제 꽃밭으로 돌아간다
            b.t = 0;
          }
        } else if (b.rest) {
          // 꽃에 앉아 날개를 천천히 접었다 편다. 가까이 오거나 쉴 만큼 쉬면 날아오른다
          b.flap = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(now * 2 + b.seed));
          b.bank *= 0.9;
          if (b.t > 0) {
            b.rest = false; b.t = 0;
            b.target = flowerAway(h.x, h.z, h.r, player) ?? f;
            b.p.y += 0.05;
          }
        } else {
          // 꽃 쪽으로 팔랑팔랑. 높이는 통통 튀듯 오르내리고, 가까워지면 내려앉는다
          b.flap = Math.sin(now * 16 + b.seed) * 0.9;
          const dx = f.x - b.p.x, dz = f.z - b.p.z, d = Math.hypot(dx, dz);
          const want = Math.atan2(dx, dz) + Math.sin(now * 1.7 + b.seed * 3) * Math.min(1, d / 2) * 0.9; // 멀 땐 갈지자로
          const turn = angleTo(b.yaw, want);
          b.yaw += turn * Math.min(1, dt * 2.5);
          b.bank += (THREE.MathUtils.clamp(turn, -0.6, 0.6) - b.bank) * Math.min(1, dt * 4);
          const sp = FLY_SPEED * Math.min(1, d / 0.6 + 0.2);
          b.p.x += Math.sin(b.yaw) * sp * dt + WIND_DIR[0] * 0.12 * dt;
          b.p.z += Math.cos(b.yaw) * sp * dt + WIND_DIR[1] * 0.12 * dt;
          const cruise = top(f) + (d > 1.2 ? 0.7 : d * 0.5) + Math.abs(Math.sin(now * 5 + b.seed)) * 0.12;
          b.p.y += (cruise - b.p.y) * Math.min(1, dt * 2.5);
          if (b.t > 0.6 && d < 0.08 && Math.abs(b.p.y - top(f)) < 0.12) { b.rest = true; b.t = -rand(2, 6); b.p.set(f.x, top(f), f.z); }
          if (b.t > 14) { b.target = flowerAway(h.x, h.z, h.r, player) ?? f; b.t = 0; } // 오래 헤매면 다른 꽃으로
        }
        base.compose(b.p, _q.setFromEuler(_e.set(0, b.yaw, b.bank, "YXZ")), _s.setScalar(S));
        put(body, i, 0, base, 0, 0.02, 0);
        put(head, i, 0, base, 0, 0.03, 0.055);
        for (const s of [-1, 1]) {
          const k = s < 0 ? 0 : 1;
          // 큰 눈을 얼굴 앞쪽에, 위쪽에 작은 흰 반짝임
          put(eye, i, k, base, s * 0.0135, 0.0375, 0.084);
          put(shine, i, k, base, s * 0.013, 0.041, 0.093);
          put(stalk, i, k, base, s * 0.009, 0.058, 0.062, 0.5, 0, -s * 0.35);
          put(knob, i, k, base, s * 0.024, 0.095, 0.082);
          // 오른쪽(+x) 날개는 +flap만큼, 왼쪽은 거울로
          put(upper, i, k, base, 0, 0.03, 0.015, 0, -s * 0.35, s * b.flap, s * 0.095, 1, 0.08);
          put(lower, i, k, base, 0, 0.025, -0.025, 0, s * 0.45, s * b.flap * 0.9, s * 0.07, 1, 0.06);
        }
      });
      for (const p of parts) {
        p.mesh.instanceMatrix.needsUpdate = true;
        if (colorsDirty && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
      colorsDirty = false;
    },
  };
}

// ── 물고기 ──
// 앞이 +z. 통통한 몸, 큰 눈과 반짝임, 볼 홍조, 살랑이는 꼬리. 물속을 헤엄치다 가끔 물 위로 뛰어오른다
type Fish = Dweller & { p: THREE.Vector3; yaw: number; turn: number; t: number; jump: number; nextJump: number; pitch: number; seed: number };
const depthAt = (x: number, z: number) => WATER_Y - terrainY(x, z);
const fishOk = (x: number, z: number) => { const d = depthAt(x, z); return d > 0.45 && d < 3; };

// 몸통 타원체 반지름과, 몸 겉면 위의 점(방향 → 겉면 + lift)
const FB = [0.07, 0.095, 0.165] as const; // 옆으로 납작하고 앞뒤로 긴 몸(둥글면 올챙이처럼 보인다)
const _f = new THREE.Vector3();
const onFish = (x: number, y: number, z: number, lift: number) => {
  _f.set(x, y, z).normalize();
  const t = 1 / Math.hypot(_f.x / FB[0], _f.y / FB[1], _f.z / FB[2]);
  const n = new THREE.Vector3(_f.x / FB[0] ** 2, _f.y / FB[1] ** 2, _f.z / FB[2] ** 2).normalize();
  return _f.multiplyScalar(t).addScaledVector(n, lift).clone();
};

// 물고기 터: 깊이 0.6~2.5m인 물에서 시드로 고르고 서로 12m 넘게 떨어뜨린다. 한 곳에 1~2마리
const PONDS = 26;
function fishPonds(light: boolean) {
  const r = rng(7702), homes: Home[] = [];
  for (let k = 0; k < 30000 && homes.length < PONDS; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (WORLD - 4), x = Math.cos(a) * d, z = Math.sin(a) * d, depth = depthAt(x, z), n = 1 + Math.floor(r() * 2);
    if (depth > 0.6 && depth < 2.5 && homes.every((h) => Math.hypot(h.x - x, h.z - z) > 12)) homes.push({ x, z, r: 5, n: light ? 1 : n, members: [] });
  }
  return homes;
}

function makeFish(root: THREE.Object3D, n: number, env: CritterEnv) {
  const S = 0.65; // 실제 물고기 크기쯤
  const body = part(root, new THREE.SphereGeometry(1, 16, 12), n, 1);
  // 꼬리는 위아래로 갈라진 두 갈래(V자). 갈래마다 앞 끝이 원점(몸 쪽)
  const tail = part(root, new THREE.SphereGeometry(1, 12, 8).translate(0, 0, -1), n, 2);
  const fin = part(root, new THREE.SphereGeometry(1, 10, 8), n, 1);
  const pect = part(root, new THREE.SphereGeometry(1, 8, 6).translate(0, 0, -1), n, 2); // 옆지느러미
  const eye = part(root, new THREE.SphereGeometry(0.016, 10, 8), n, 2, { color: "#2f2a36", roughness: 0.35 });
  const shine = part(root, new THREE.SphereGeometry(0.0055, 6, 5), n, 2, { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6 });
  const blush = part(root, new THREE.SphereGeometry(0.016, 8, 6), n, 2, { color: "#ff9fb2", roughness: 0.9 });

  const list: Fish[] = Array.from({ length: n }, (_, i) => ({ on: false, home: null, p: new THREE.Vector3(), yaw: 0, turn: 0, t: 0, jump: -1, nextJump: 0, pitch: 0, seed: i * 2.1 }));
  let colorsDirty = false;
  const spawn = (f: Fish, i: number, home: Home) => {
    let x = home.x, z = home.z;
    for (let k = 0; k < 8; k++) { // 터 안의 물속 아무 자리
      const a = Math.random() * Math.PI * 2, d = Math.random() * home.r, tx = home.x + Math.cos(a) * d, tz = home.z + Math.sin(a) * d;
      if (fishOk(tx, tz)) { x = tx; z = tz; break; }
    }
    f.p.set(x, 0, z); f.yaw = Math.random() * Math.PI * 2; f.turn = 0; f.jump = -1; f.nextJump = rand(6, 20);
    const h = [0.03, 0.08, 0.13, 0.92, 0.75, 0.55][Math.floor(Math.random() * 6)] + rand(-0.02, 0.02);
    tint(body, i, pastel(h, 0.75, 0.74)); tint(tail, i, pastel(h + 0.05, 0.7, 0.66)); tint(fin, i, pastel(h + 0.05, 0.7, 0.68)); tint(pect, i, pastel(h + 0.05, 0.7, 0.7));
    colorsDirty = true;
  };
  const base = new THREE.Matrix4(), parts = [body, tail, fin, pect, eye, shine, blush];
  const assign = makeAssigner(fishPonds(env.light), list, spawn, (i) => { for (const p of parts) hide(p, i); });

  return {
    update(dt: number, player: THREE.Vector3, now: number) {
      assign(dt, player);
      list.forEach((f, i) => {
        if (!f.on) return;
        const home = f.home!;
        f.t += dt;
        let y: number;
        if (f.jump >= 0) {
          // 뛰어오르기: 0.9초 동안 포물선, 코를 들었다가 숙인다. 나갈 때와 들어갈 때 물이 튄다
          f.jump += dt / 0.9;
          const u = Math.min(1, f.jump);
          f.p.x += Math.sin(f.yaw) * 1.4 * dt; f.p.z += Math.cos(f.yaw) * 1.4 * dt;
          y = WATER_Y - 0.15 + 0.75 * Math.sin(Math.PI * u);
          f.pitch = -(0.5 - u) * 2.2;
          if (u >= 1) { f.jump = -1; f.pitch = 0; env.splash(f.p.x, f.p.z, f.yaw); f.nextJump = rand(8, 25); }
        } else {
          // 헤엄: 가끔 방향을 바꾸고, 앞이 얕거나 물 밖이면 돌아선다
          if (Math.random() < dt * 0.4) f.turn = rand(-0.9, 0.9);
          const ax = f.p.x + Math.sin(f.yaw) * 1.2, az = f.p.z + Math.cos(f.yaw) * 1.2;
          if (!fishOk(ax, az)) f.turn = 2.2 * Math.sign(f.turn || 1);
          else if (Math.hypot(f.p.x - home.x, f.p.z - home.z) > home.r) f.turn = 1.5 * Math.sign(angleTo(f.yaw, Math.atan2(home.x - f.p.x, home.z - f.p.z)) || 1); // 제 터로 돌아온다
          f.yaw += f.turn * dt;
          const sp = FISH_SPEED * (0.8 + 0.3 * Math.sin(now * 1.3 + f.seed));
          const nx = f.p.x + Math.sin(f.yaw) * sp * dt, nz = f.p.z + Math.cos(f.yaw) * sp * dt;
          if (fishOk(nx, nz)) { f.p.x = nx; f.p.z = nz; }
          y = Math.max(terrainY(f.p.x, f.p.z) + 0.15, WATER_Y - 0.3) + Math.sin(now * 1.1 + f.seed) * 0.04;
          f.pitch *= 0.9;
          // 튀어 오를 차례: 앞쪽 착지 자리도 물이어야 한다
          if ((f.nextJump -= dt) <= 0 && fishOk(f.p.x + Math.sin(f.yaw) * 1.3, f.p.z + Math.cos(f.yaw) * 1.3)) { f.jump = 0; env.splash(f.p.x, f.p.z, f.yaw); }
        }
        const wag = Math.sin(now * (f.jump >= 0 ? 18 : 9) + f.seed);
        base.compose(_v.set(f.p.x, y, f.p.z), _q.setFromEuler(_e.set(f.pitch, f.yaw + wag * 0.08, 0, "YXZ")), _s.setScalar(S));
        put(body, i, 0, base, 0, 0, 0, 0, 0, 0, FB[0], FB[1], FB[2]);
        put(fin, i, 0, base, 0, 0.088, -0.02, -0.55, 0, 0, 0.008, 0.035, 0.06);
        for (const s of [-1, 1]) {
          const k = s < 0 ? 0 : 1;
          put(tail, i, k, base, 0, s * 0.012, -0.15, s * 0.6, wag * 0.55, 0, 0.012, 0.03, 0.075); // 위(+)·아래(-) 갈래
          put(pect, i, k, base, s * 0.06, -0.03, 0.03, 0.3, s * 0.7 + wag * 0.25, 0, 0.006, 0.022, 0.045);
          const e = onFish(s * 0.45, 0.32, 0.84, 0.003), h = onFish(s * 0.4, 0.42, 0.84, 0.013), c = onFish(s * 0.8, -0.18, 0.56, 0.001);
          put(eye, i, k, base, e.x, e.y, e.z);
          put(shine, i, k, base, h.x, h.y, h.z);
          put(blush, i, k, base, c.x, c.y, c.z, 0, s * 1.0, 0, 1, 0.65, 0.35);
        }
      });
      for (const p of parts) {
        p.mesh.instanceMatrix.needsUpdate = true;
        if (colorsDirty && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
      colorsDirty = false;
    },
  };
}

// ── 작은 새 ──
// 참새만 한 새. 앞이 +z, 위가 +y, 원점은 발끝. 큰 머리·작은 눈과 반짝임·볼 홍조로 귀엽게.
// 잎덩이 꼭대기·덤불·계단 나무·땅에 앉아 두리번거리고 콩콩 뛰고 쪼다가, 날아서 다른 자리로 가거나 하늘을 높게·낮게 마음대로 돌아다닌다.
// 날 때는 참새처럼 몇 번 날갯짓하고 날개를 접어 잠깐 미끄러지기를 되풀이한다(물결 모양으로 난다)
type PerchKind = "tree" | "bush" | "wood" | "ground";
type Perch = { x: number; y: number; z: number; kind: PerchKind };
type Bird = Dweller & {
  p: THREE.Vector3; v: THREE.Vector3; yaw: number; pitch: number; roll: number;
  fly: boolean; t: number; // 앉아 있으면 남은 쉬는 시간, 날고 있으면 난 시간(초)
  roam: number; // 남은 자유 비행 시간(초). 0이면 앉을 자리(perch)로 간다
  cruise: number; // 앉을 자리로 갈 때 얼마나 높이 떠서 가는지(m)
  perch: Perch; goal: THREE.Vector3;
  act: number; hop: number; hopFrom: THREE.Vector3; hopTo: THREE.Vector3;
  head: number; headTo: number; peck: number; tail: number;
  phase: number; flapT: number; glide: number; fold: number; seed: number;
};
const BIRD_SPEED = 4;
const SCARE: Record<PerchKind, number> = { ground: 3, bush: 2.6, wood: 2.4, tree: 1.3 }; // 캐릭터가 이만큼(수평 거리) 다가오면 날아간다
const REST: Record<PerchKind, [number, number]> = { ground: [4, 10], bush: [5, 14], wood: [6, 18], tree: [6, 22] };
// 새 둥지: 나무 꼭대기 중에서 시드로 고르고 서로 16m 넘게 떨어뜨린다. 한 곳에 2~3마리(휴대폰은 1~2마리)
const NESTS = 40;
function birdNests(env: CritterEnv) {
  const r = rng(8801), trees = env.perches.filter((p) => p.kind === "tree"), homes: Home[] = [];
  const wood = env.perches.find((p) => p.kind === "wood");
  if (wood) homes.push({ x: wood.x, z: wood.z, r: 12, n: env.light ? 2 : 3, members: [] }); // 동산 계단 둘레
  for (let k = 0; k < 4000 && homes.length < NESTS && trees.length; k++) {
    const t = trees[Math.floor(r() * trees.length)], n = 2 + Math.floor(r() * 2);
    if (homes.every((h) => Math.hypot(h.x - t.x, h.z - t.z) > 16)) homes.push({ x: t.x, z: t.z, r: 14, n: env.light ? n - 1 : n, members: [] });
  }
  return homes;
}
const BIRD_COLORS = [
  // [등, 배] 참새 갈색이 가장 흔하고, 파스텔 몇 가지가 섞인다
  ["#b48662", "#f4e8d6"], ["#b48662", "#f4e8d6"], ["#a97c5c", "#f1e4cf"], ["#bf9470", "#f6ecdc"],
  ["#93aac6", "#f5efe2"], ["#e4c36c", "#fbf2d2"], ["#d79d92", "#f8e7e0"], ["#a8b07d", "#f1efd8"],
] as const;

function makeBirds(root: THREE.Object3D, n: number, env: CritterEnv) {
  const S = 1.25; // 게임 카메라에서 보이도록 참새보다 조금 크게(몸길이 15cm쯤)
  const ell = (w: number, h: number, d: number) => new THREE.SphereGeometry(1, 12, 9).scale(w, h, d);
  const body = part(root, ell(0.04, 0.038, 0.058), n, 1);
  const belly = part(root, ell(0.034, 0.03, 0.044), n, 1);
  const head = part(root, new THREE.SphereGeometry(0.034, 12, 10), n, 1);
  const beak = part(root, new THREE.ConeGeometry(0.008, 0.018, 6).translate(0, 0.009, 0).rotateX(Math.PI / 2), n, 1, { color: "#e3a25e" });
  const eye = part(root, new THREE.SphereGeometry(0.0065, 8, 6), n, 2, { color: "#2f2a36", roughness: 0.35 });
  const shine = part(root, new THREE.SphereGeometry(0.0022, 6, 4), n, 2, { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6 });
  const blush = part(root, new THREE.SphereGeometry(0.008, 8, 6), n, 2, { color: "#f4a6a6", roughness: 0.9 });
  const wing = part(root, new THREE.SphereGeometry(1, 14, 8).translate(1, 0, 0), n, 2); // 경첩이 x=0
  const tail = part(root, new THREE.SphereGeometry(1, 8, 6).translate(0, 0, -1), n, 1); // 경첩이 z=0
  const leg = part(root, new THREE.CylinderGeometry(0.0025, 0.0025, 0.02, 4).translate(0, -0.01, 0), n, 2, { color: "#d49a6a" });
  const parts = [body, belly, head, beak, eye, shine, blush, wing, tail, leg];

  // 앉을 자리 찾기: 8m 칸으로 나눠 둔다
  const CELL = 8, grid = new Map<string, Perch[]>();
  for (const p of env.perches) { const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(p); }
  const perchNear = (x: number, z: number, r: number): Perch | null => {
    const out: Perch[] = [];
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++)
        for (const p of grid.get(`${cx},${cz}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < r) out.push(p);
    return out.length ? out[Math.floor(Math.random() * out.length)] : null;
  };
  const groundOk = (x: number, z: number) => Math.hypot(x, z) < WORLD && terrainY(x, z) > WATER_Y + 0.25;
  const groundNear = (x: number, z: number, r: number): Perch | null => {
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r, gx = x + Math.cos(a) * d, gz = z + Math.sin(a) * d;
      if (groundOk(gx, gz)) return { x: gx, y: walkY(gx, gz), z: gz, kind: "ground" };
    }
    return null;
  };
  // 둥지 둘레에서 앉을 자리. 캐릭터에서 넉넉히 떨어진 곳을 먼저 고른다
  const choosePerch = (h: Home, player: THREE.Vector3): Perch => {
    let any: Perch | null = null;
    for (let k = 0; k < 8; k++) {
      const c = Math.random() < 0.25 ? groundNear(h.x, h.z, h.r) : perchNear(h.x, h.z, h.r);
      if (!c) continue;
      any = c;
      if (Math.hypot(c.x - player.x, c.z - player.z) > 6) return c;
    }
    return any ?? { x: h.x, y: walkY(h.x, h.z), z: h.z, kind: "ground" };
  };
  // 자유 비행의 다음 목표: 낮게(풀 위), 중간(나무 위), 높게(하늘) 중 하나
  const roamPoint = (b: Bird, h: Home) => {
    const a = Math.random() * Math.PI * 2, d = rand(3, h.r * 1.7), r = Math.random();
    const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
    const alt = r < 0.35 ? rand(1.2, 3) : r < 0.75 ? rand(4, 10) : rand(12, 26);
    b.goal.set(x, Math.max(terrainY(x, z), WATER_Y) + alt, z);
  };
  const setPerch = (b: Bird, p: Perch) => { b.perch = p; b.goal.set(p.x, p.y, p.z); };
  const takeOff = (b: Bird, player: THREE.Vector3, scared: boolean) => {
    const h = b.home!;
    b.fly = true; b.t = 0; b.hop = 0; b.peck = 0; b.head = b.headTo = 0;
    b.roam = !scared && Math.random() < 0.35 ? rand(5, 16) : 0;
    b.cruise = Math.random() < 0.3 ? rand(5, 10) : rand(1.5, 4);
    const away = scared ? Math.atan2(b.p.x - player.x, b.p.z - player.z) : b.yaw;
    b.v.set(Math.sin(away) * (scared ? 2.5 : 1.2), scared ? 2.8 : 2, Math.cos(away) * (scared ? 2.5 : 1.2));
    b.flapT = rand(0.6, 1.1); b.glide = 0;
    if (b.roam > 0) roamPoint(b, h); else setPerch(b, choosePerch(h, player));
  };
  const land = (b: Bird) => {
    b.fly = false; b.p.copy(b.goal); b.v.set(0, 0, 0); b.pitch = b.roll = 0;
    const [lo, hi] = REST[b.perch.kind];
    b.t = rand(lo, hi); b.act = rand(0.3, 1.2);
  };

  const list: Bird[] = Array.from({ length: n }, (_, i) => ({
    on: false, home: null, p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, fly: false, t: 0, roam: 0, cruise: 2,
    perch: { x: 0, y: 0, z: 0, kind: "ground" }, goal: new THREE.Vector3(), act: 0, hop: 0, hopFrom: new THREE.Vector3(), hopTo: new THREE.Vector3(),
    head: 0, headTo: 0, peck: 0, tail: 0, phase: i * 2.1, flapT: 0, glide: 0, fold: 1, seed: i * 1.37,
  }));
  const homes = birdNests(env), far = new THREE.Vector3(1e6, 0, 1e6), col = new THREE.Color();
  const spawn = (b: Bird, i: number, h: Home) => {
    setPerch(b, choosePerch(h, far));
    land(b);
    b.t = rand(1, 12); b.fold = 1; b.yaw = Math.random() * Math.PI * 2;
    const [back, front] = BIRD_COLORS[Math.floor(Math.random() * BIRD_COLORS.length)];
    for (const p of [body, head, wing, tail]) tint(p, i, col.set(back).offsetHSL(0, 0, (Math.random() - 0.5) * 0.04));
    tint(head, i, col.set(back).offsetHSL(0, -0.05, 0.04)); // 머리는 등보다 살짝 밝게
    tint(wing, i, col.set(back).offsetHSL(0, 0, -0.06)); // 날개는 살짝 진하게
    tint(belly, i, col.set(front));
  };
  let colorsDirty = true;
  const assign = makeAssigner(homes, list, (b, i, h) => { spawn(b, i, h); colorsDirty = true; }, (i) => { for (const p of parts) hide(p, i); });
  const base = new THREE.Matrix4(), hm = new THREE.Matrix4(), _hq = new THREE.Quaternion(), _he = new THREE.Euler(), _hv = new THREE.Vector3(), _hs = new THREE.Vector3(1, 1, 1);

  return {
    update(dt: number, player: THREE.Vector3, now: number) {
      assign(dt, player);
      list.forEach((b, i) => {
        if (!b.on) return;
        const h = b.home!;
        let bodyPitch = 0, headPitch = 0;
        if (!b.fly) {
          b.t -= dt;
          const kind = b.perch.kind;
          if (Math.hypot(b.p.x - player.x, b.p.z - player.z) < SCARE[kind] || b.t <= 0) takeOff(b, player, b.t > 0);
          else {
            // 앉아서: 두리번거리기, 콩콩 뛰기(땅), 쪼기(땅), 제자리에서 돌아앉기, 꽁지 까딱
            if (b.hop <= 0 && (b.act -= dt) <= 0) {
              const r = Math.random();
              if (kind === "ground" && r < 0.4) {
                const a = b.yaw + rand(-1.2, 1.2), d = rand(0.18, 0.4);
                let x = b.p.x + Math.sin(a) * d, z = b.p.z + Math.cos(a) * d;
                if (Math.hypot(x - h.x, z - h.z) > h.r * 1.3 || !groundOk(x, z)) { x = b.p.x; z = b.p.z; } // 둥지에서 너무 멀거나 물이면 제자리에서
                b.hopFrom.copy(b.p); b.hopTo.set(x, walkY(x, z), z); b.hop = 1;
                if (x !== b.p.x) b.yaw = a;
                b.act = rand(0.15, 0.6); // 콩, 콩 이어서 뛰기도 한다
              } else if (kind === "ground" && r < 0.7) { b.peck = 0.7; b.act = rand(0.8, 1.8); }
              else if (r < 0.82) { b.hopFrom.copy(b.p); b.hopTo.copy(b.p); b.hop = 1; b.yaw += rand(-1.4, 1.4); b.act = rand(0.6, 1.6); }
              else { b.headTo = rand(-1.1, 1.1); b.act = rand(0.4, 1.5); if (Math.random() < 0.4) b.tail = 1; }
            }
            if (b.hop > 0) {
              b.hop = Math.max(0, b.hop - dt / 0.2);
              const s = 1 - b.hop;
              b.p.lerpVectors(b.hopFrom, b.hopTo, s);
              b.p.y += 4 * 0.05 * s * (1 - s);
              if (b.hop === 0) b.perch = { ...b.perch, x: b.hopTo.x, y: b.hopTo.y, z: b.hopTo.z };
            }
            if (b.peck > 0) {
              b.peck = Math.max(0, b.peck - dt);
              const k = Math.abs(Math.sin(b.peck * 13)); // 콕콕콕
              headPitch = 0.4 + 0.6 * k; bodyPitch = 0.35;
              b.headTo = 0;
            }
            b.fold += (1 - b.fold) * Math.min(1, dt * 12);
          }
        }
        if (b.fly) {
          b.t += dt;
          const g = b.goal, dx = g.x - b.p.x, dz = g.z - b.p.z, dh = Math.hypot(dx, dz);
          const landing = b.roam <= 0;
          if (!landing) {
            b.roam -= dt;
            if (b.roam <= 0) setPerch(b, choosePerch(h, player));
            else if (dh < 2 && Math.abs(g.y - b.p.y) < 2) roamPoint(b, h);
          } else if (b.t > 30) { setPerch(b, choosePerch(h, player)); b.t = 0; } // 못 내려앉고 헤매면 다른 자리로
          const near = landing && dh < 1.5;
          // 앉을 자리로 갈 땐 멀리서는 높이 떠 가다가 가까워지며 내려온다
          let wantY = landing ? g.y + Math.min(dh * 0.45, b.cruise) : g.y;
          const ground = Math.max(terrainY(b.p.x, b.p.z), WATER_Y);
          wantY = Math.max(wantY, ground + (landing && dh < 2.5 ? 0.05 : 1));
          const sp = landing ? Math.min(BIRD_SPEED, 0.7 + dh * 1.5) : BIRD_SPEED * 1.15;
          // 자유 비행은 살짝 굽이치며 난다
          const wob = landing ? Math.sin(now * 1.3 + b.seed) * Math.min(1, dh / 6) * 0.35 : Math.sin(now * 0.7 + b.seed) * 0.6;
          const a = Math.atan2(dx, dz) + wob;
          const dvx = dh > 0.01 ? Math.sin(a) * sp : 0, dvz = dh > 0.01 ? Math.cos(a) * sp : 0;
          const dvy = THREE.MathUtils.clamp((wantY - b.p.y) * (near ? 3 : 1.6), -2.5, 2.5);
          const k = Math.min(1, dt * (near ? 6 : 2.2));
          b.v.x += (dvx - b.v.x) * k; b.v.z += (dvz - b.v.z) * k; b.v.y += (dvy - b.v.y) * k;
          // 날갯짓 몇 번, 날개 접고 미끄러지기. 내려앉을 땐 계속 퍼덕인다
          if (b.glide > 0) {
            b.glide -= dt; b.v.y -= 1.6 * dt;
            if (b.glide <= 0 || near) { b.glide = 0; b.flapT = rand(0.35, 0.9); }
          } else if ((b.flapT -= dt) <= 0 && !near && b.t > 0.6) b.glide = rand(0.18, 0.4);
          b.phase += dt * Math.PI * 2 * (near ? 16 : 13);
          b.fold += ((b.glide > 0 ? 0.85 : 0) - b.fold) * Math.min(1, dt * 14);
          b.p.addScaledVector(b.v, dt);
          b.p.y = Math.max(b.p.y, ground + 0.02);
          const hs = Math.hypot(b.v.x, b.v.z);
          if (hs > 0.3) {
            const turn = angleTo(b.yaw, Math.atan2(b.v.x, b.v.z));
            b.yaw += turn * Math.min(1, dt * 8);
            b.roll += (THREE.MathUtils.clamp(turn * 1.5, -0.7, 0.7) - b.roll) * Math.min(1, dt * 5);
          }
          b.pitch += (THREE.MathUtils.clamp(-Math.atan2(b.v.y, hs + 0.5) * 0.7, -0.6, 0.6) - b.pitch) * Math.min(1, dt * 6);
          if (landing && b.p.distanceTo(g) < (dh < 0.3 ? 0.15 : 0.08)) land(b);
        }
        b.head += (b.headTo - b.head) * Math.min(1, dt * 10);
        b.tail = Math.max(0, b.tail - dt * 4);

        base.compose(b.p, _q.setFromEuler(_e.set(b.fly ? b.pitch : bodyPitch, b.yaw, b.fly ? b.roll : 0, "YXZ")), _s.setScalar(S));
        put(body, i, 0, base, 0, 0.055, 0);
        put(belly, i, 0, base, 0, 0.047, 0.014);
        put(tail, i, 0, base, 0, 0.06, -0.045, (b.fly ? 0.05 : 0.35) + Math.sin(b.tail * Math.PI) * 0.4, 0, 0, 0.026, 0.006, 0.042);
        // 머리: 목(0, 0.082, 0.028)을 축으로 두리번거리고 쫀다. 날 때는 앞을 본다
        hm.multiplyMatrices(base, _l.compose(_hv.set(0, 0.082, 0.028), _hq.setFromEuler(_he.set(b.fly ? -b.pitch * 0.5 : headPitch, b.head, 0, "YXZ")), _hs));
        put(head, i, 0, hm, 0, 0.016, 0.016);
        put(beak, i, 0, hm, 0, 0.0126, 0.0497);
        const flap = 0.25 + Math.sin(b.phase) * 0.95; // 위로 1.2, 아래로 0.7
        for (const s of [-1, 1]) {
          const k = s < 0 ? 0 : 1;
          put(eye, i, k, hm, s * 0.0194, 0.022, 0.043);
          put(shine, i, k, hm, s * 0.0215, 0.0253, 0.0479);
          put(blush, i, k, hm, s * 0.0255, 0.0075, 0.0364, 0, s * 0.9, 0, 1, 0.7, 0.35);
          // 날개: 펴면 옆으로 뻗어 위아래로 치고(fold 0), 접으면 몸 옆에 세워 뒤로 붙인다(fold 1)
          const w = b.fold, rz = b.fly ? s * flap * (1 - w) - s * 0.15 * w : -s * 0.15;
          _e.set(w * 1.35, s * w * (Math.PI / 2 + 0.06), rz, "YXZ");
          _l.compose(_v.set(s * 0.032, 0.07, 0.012), _q.setFromEuler(_e), _s.set(s * 0.058 * (1 - 0.22 * w), 0.009, 0.03)); // 접으면 조금 짧게(꽁지 끝을 넘지 않게)
          wing.mesh.setMatrixAt(i * 2 + k, _m.multiplyMatrices(base, _l));
          if (b.fly) put(leg, i, k, base, 0, 0, 0, 0, 0, 0, 0, 0, 0);
          else put(leg, i, k, base, s * 0.012, 0.024, 0.004);
        }
      });
      for (const p of parts) {
        p.mesh.instanceMatrix.needsUpdate = true;
        if (colorsDirty && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
      colorsDirty = false;
    },
  };
}

export function makeCritters(root: THREE.Object3D, env: CritterEnv) {
  // 한꺼번에 움직이는 최대 수(풀). 가까운 사는 곳부터 채운다
  const flies = makeButterflies(root, env.light ? 8 : 14, env);
  const fish = makeFish(root, env.light ? 3 : 6, env);
  const birds = makeBirds(root, env.light ? 6 : 12, env);
  let now = 0;
  return {
    update(dt: number, player: THREE.Vector3) {
      now += dt;
      flies.update(dt, player, now);
      fish.update(dt, player, now);
      birds.update(dt, player, now);
    },
  };
}
