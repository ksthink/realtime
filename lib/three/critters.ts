import * as THREE from "three";
import { WATER_Y, WORLD, rng, terrainY } from "../terrain";
import { WIND_DIR } from "./petals";

// ── 작은 동물들: 나비와 물고기 ──
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
  splash: (x: number, z: number, yaw: number) => void;
  light: boolean; // 휴대폰이면 수를 줄인다
  feeding: () => { x: number; z: number }[]; // 나무지기가 지금 먹이를 주는 물고기 터 가운데들
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
  const eye = part(root, new THREE.SphereGeometry(0.013, 10, 8), n, 2, { color: "#2f2a36", roughness: 0.35 });
  const shine = part(root, new THREE.SphereGeometry(0.0045, 6, 5), n, 2, { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6 });
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
          put(eye, i, k, base, s * 0.0135, 0.0375, 0.0808);
          put(shine, i, k, base, s * 0.0125, 0.043, 0.093);
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
const FB = [0.11, 0.1, 0.15] as const;
const _f = new THREE.Vector3();
const onFish = (x: number, y: number, z: number, lift: number) => {
  _f.set(x, y, z).normalize();
  const t = 1 / Math.hypot(_f.x / FB[0], _f.y / FB[1], _f.z / FB[2]);
  const n = new THREE.Vector3(_f.x / FB[0] ** 2, _f.y / FB[1] ** 2, _f.z / FB[2] ** 2).normalize();
  return _f.multiplyScalar(t).addScaledVector(n, lift).clone();
};

// 물고기 터: 깊이 0.6~2.5m인 물에서 시드로 고르고 서로 12m 넘게 떨어뜨린다. 한 곳에 2~3마리(휴대폰 1~2마리). 먹이를 주면 무리 지어 모인다
const PONDS = 26;
export function fishPonds(light: boolean) {
  const r = rng(7702), homes: Home[] = [];
  for (let k = 0; k < 30000 && homes.length < PONDS; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (WORLD - 4), x = Math.cos(a) * d, z = Math.sin(a) * d, depth = depthAt(x, z), n = 2 + Math.floor(r() * 2);
    if (depth > 0.6 && depth < 2.5 && homes.every((h) => Math.hypot(h.x - x, h.z - z) > 12)) homes.push({ x, z, r: 5, n: light ? n - 1 : n, members: [] });
  }
  return homes;
}

function makeFish(root: THREE.Object3D, n: number, env: CritterEnv) {
  const S = 0.65; // 실제 물고기 크기쯤
  const body = part(root, new THREE.SphereGeometry(1, 16, 12), n, 1);
  const tail = part(root, new THREE.SphereGeometry(1, 14, 10).translate(0, 0, -1), n, 1); // 둥근 부채꼴 꼬리. 앞 끝이 원점(몸 쪽)
  const fin = part(root, new THREE.SphereGeometry(1, 10, 8), n, 1);
  const eye = part(root, new THREE.SphereGeometry(0.024, 10, 8), n, 2, { color: "#2f2a36", roughness: 0.35 });
  const shine = part(root, new THREE.SphereGeometry(0.008, 6, 5), n, 2, { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6 });
  const blush = part(root, new THREE.SphereGeometry(0.02, 8, 6), n, 2, { color: "#ff9fb2", roughness: 0.9 });

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
    tint(body, i, pastel(h, 0.75, 0.74)); tint(tail, i, pastel(h + 0.05, 0.7, 0.66)); tint(fin, i, pastel(h + 0.05, 0.7, 0.68));
    colorsDirty = true;
  };
  const base = new THREE.Matrix4(), parts = [body, tail, fin, eye, shine, blush];
  const assign = makeAssigner(fishPonds(env.light), list, spawn, (i) => { for (const p of parts) hide(p, i); });

  return {
    update(dt: number, player: THREE.Vector3, now: number) {
      assign(dt, player);
      const feed = env.feeding();
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
          if (u >= 1) { f.jump = -1; f.pitch = 0; env.splash(f.p.x, f.p.z, f.yaw); f.nextJump = feed.some((p) => Math.hypot(p.x - f.p.x, p.z - f.p.z) < 10) ? rand(2, 6) : rand(8, 25); }
        } else {
          // 헤엄: 가끔 방향을 바꾸고, 앞이 얕거나 물 밖이면 돌아선다
          // 근처(10m)에서 먹이를 주면 그리로 모여 둘레를 맴돌고, 자주 뛰어오른다
          const food = feed.find((p) => Math.hypot(p.x - f.p.x, p.z - f.p.z) < 10);
          if (Math.random() < dt * 0.4) f.turn = rand(-0.9, 0.9);
          const ax = f.p.x + Math.sin(f.yaw) * 1.2, az = f.p.z + Math.cos(f.yaw) * 1.2;
          if (!fishOk(ax, az)) f.turn = 2.2 * Math.sign(f.turn || 1);
          else if (food) {
            const d = Math.hypot(food.x - f.p.x, food.z - f.p.z);
            const want = Math.atan2(food.x - f.p.x, food.z - f.p.z) + (d < 0.9 ? 1.4 : 0); // 가까우면 옆으로 돌아 맴돈다
            f.turn = THREE.MathUtils.clamp(angleTo(f.yaw, want) * 2.5, -2.5, 2.5);
            if (f.nextJump > 6) f.nextJump = rand(1.5, 5);
          } else if (Math.hypot(f.p.x - home.x, f.p.z - home.z) > home.r) f.turn = 1.5 * Math.sign(angleTo(f.yaw, Math.atan2(home.x - f.p.x, home.z - f.p.z)) || 1); // 제 터로 돌아온다
          f.yaw += f.turn * dt;
          const sp = FISH_SPEED * (food ? 1.6 : 0.8 + 0.3 * Math.sin(now * 1.3 + f.seed));
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
        put(tail, i, 0, base, 0, 0, -0.12, 0, wag * 0.55, 0, 0.022, 0.085, 0.07);
        put(fin, i, 0, base, 0, 0.095, -0.03, -0.5, 0, 0, 0.01, 0.03, 0.055);
        for (const s of [-1, 1]) {
          const k = s < 0 ? 0 : 1;
          const e = onFish(s * 0.55, 0.3, 0.78, 0.004), h = onFish(s * 0.5, 0.42, 0.78, 0.022), c = onFish(s * 0.82, -0.12, 0.56, 0.002);
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

export function makeCritters(root: THREE.Object3D, env: CritterEnv) {
  // 한꺼번에 움직이는 최대 수(풀). 가까운 사는 곳부터 채운다
  const flies = makeButterflies(root, env.light ? 8 : 14, env);
  const fish = makeFish(root, env.light ? 4 : 8, env);
  let now = 0;
  return {
    update(dt: number, player: THREE.Vector3) {
      now += dt;
      flies.update(dt, player, now);
      fish.update(dt, player, now);
    },
  };
}
