import * as THREE from "three";
import { WATER_Y, terrainY } from "../terrain";
import { WIND_DIR } from "./petals";

// ── 작은 동물들: 나비와 물고기 ──
// 배경 생물이라 접속자끼리 맞추지 않는다. 내 캐릭터 둘레(RANGE)에서만 생기고, 멀어지면 다시 가까이에서 생긴다.
// 부위마다 InstancedMesh 하나로 그려 그리기 호출은 부위 수만큼이다. 모양은 단순하게, 대신 귀엽게:
// 큰 머리·큰 눈과 반짝임, 볼 홍조, 파스텔색, 통통 튀는 움직임

const RANGE = 30; // 이 반경 안에서 생긴다(m)
const FAR = 40; // 이보다 멀어지면 가까이로 옮긴다(m)
const FLY_SPEED = 1.1, FISH_SPEED = 0.6;

export type CritterEnv = {
  flowers: { x: number; y: number; z: number }[]; // 꽃 밑동 자리
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

type Butterfly = {
  on: boolean; p: THREE.Vector3; yaw: number; bank: number; rest: boolean; t: number; flap: number;
  target: { x: number; y: number; z: number } | null; seed: number;
};

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
  const top = (f: { y: number }) => f.y + 0.38; // 꽃봉오리 위

  const list: Butterfly[] = Array.from({ length: n }, (_, i) => ({ on: false, p: new THREE.Vector3(), yaw: 0, bank: 0, rest: false, t: 0, flap: 0, target: null, seed: i * 1.37 }));
  const spawn = (b: Butterfly, i: number, px: number, pz: number) => {
    const a = Math.random() * Math.PI * 2, d = rand(6, RANGE);
    const f = flowerNear(px + Math.cos(a) * d, pz + Math.sin(a) * d, 8);
    if (!f) return;
    b.on = true; b.rest = false; b.target = f; b.t = 0;
    b.p.set(f.x + rand(-3, 3), top(f) + rand(0.6, 1.4), f.z + rand(-3, 3));
    b.yaw = Math.random() * Math.PI * 2;
    const h = Math.random(), wing = pastel(h, 0.8, 0.7);
    tint(upper, i, wing); tint(lower, i, pastel(h + 0.08, 0.75, 0.76));
    tint(body, i, pastel(h + 0.5, 0.25, 0.45)); tint(head, i, pastel(h + 0.5, 0.25, 0.5)); tint(stalk, i, pastel(h + 0.5, 0.25, 0.5)); tint(knob, i, pastel(h + 0.5, 0.3, 0.6));
  };
  let colorsDirty = true;
  const base = new THREE.Matrix4();

  return {
    update(dt: number, player: THREE.Vector3, now: number) {
      list.forEach((b, i) => {
        if (!b.on || Math.hypot(b.p.x - player.x, b.p.z - player.z) > FAR) { b.on = false; spawn(b, i, player.x, player.z); colorsDirty ||= b.on; }
        if (!b.on) { for (const p of [body, head, eye, shine, stalk, knob, upper, lower]) hide(p, i); return; }
        b.t += dt;
        const f = b.target!;
        if (b.rest) {
          // 꽃에 앉아 날개를 천천히 접었다 편다. 가까이 오거나 쉴 만큼 쉬면 날아오른다
          b.flap = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(now * 2 + b.seed));
          b.bank *= 0.9;
          if (b.t > 0 || Math.hypot(b.p.x - player.x, b.p.z - player.z) < 1.3) {
            b.rest = false; b.t = 0;
            b.target = flowerNear(b.p.x, b.p.z, 7) ?? flowerNear(player.x, player.z, RANGE) ?? f;
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
          if (b.t > 14) { b.target = flowerNear(player.x, player.z, RANGE) ?? f; b.t = 0; } // 오래 헤매면 다른 꽃으로
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
      for (const p of [body, head, eye, shine, stalk, knob, upper, lower]) {
        p.mesh.instanceMatrix.needsUpdate = true;
        if (colorsDirty && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
      colorsDirty = false;
    },
  };
}

// ── 물고기 ──
// 앞이 +z. 통통한 몸, 큰 눈과 반짝임, 볼 홍조, 살랑이는 꼬리. 물속을 헤엄치다 가끔 물 위로 뛰어오른다
type Fish = { on: boolean; p: THREE.Vector3; yaw: number; turn: number; t: number; jump: number; nextJump: number; pitch: number; seed: number };
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

function makeFish(root: THREE.Object3D, n: number, env: CritterEnv) {
  const S = 1.3;
  const body = part(root, new THREE.SphereGeometry(1, 16, 12), n, 1);
  const tail = part(root, new THREE.SphereGeometry(1, 14, 10).translate(0, 0, -1), n, 1); // 둥근 부채꼴 꼬리. 앞 끝이 원점(몸 쪽)
  const fin = part(root, new THREE.SphereGeometry(1, 10, 8), n, 1);
  const eye = part(root, new THREE.SphereGeometry(0.024, 10, 8), n, 2, { color: "#2f2a36", roughness: 0.35 });
  const shine = part(root, new THREE.SphereGeometry(0.008, 6, 5), n, 2, { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6 });
  const blush = part(root, new THREE.SphereGeometry(0.02, 8, 6), n, 2, { color: "#ff9fb2", roughness: 0.9 });

  const list: Fish[] = Array.from({ length: n }, (_, i) => ({ on: false, p: new THREE.Vector3(), yaw: 0, turn: 0, t: 0, jump: -1, nextJump: 0, pitch: 0, seed: i * 2.1 }));
  let colorsDirty = false, tries = 0;
  const spawn = (f: Fish, i: number, px: number, pz: number) => {
    for (let k = 0; k < 6 && tries < 30; k++, tries++) { // 물이 없는 곳에서 헛되이 많이 찾지 않도록 프레임당 시도를 줄인다
      const a = Math.random() * Math.PI * 2, d = rand(5, RANGE), x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (!fishOk(x, z)) continue;
      f.on = true; f.p.set(x, 0, z); f.yaw = Math.random() * Math.PI * 2; f.turn = 0; f.jump = -1; f.nextJump = rand(6, 20);
      const h = [0.03, 0.08, 0.13, 0.92, 0.75, 0.55][Math.floor(Math.random() * 6)] + rand(-0.02, 0.02);
      tint(body, i, pastel(h, 0.75, 0.74)); tint(tail, i, pastel(h + 0.05, 0.7, 0.66)); tint(fin, i, pastel(h + 0.05, 0.7, 0.68));
      colorsDirty = true;
      return;
    }
  };
  const base = new THREE.Matrix4();

  return {
    update(dt: number, player: THREE.Vector3, now: number) {
      tries = 0;
      list.forEach((f, i) => {
        if (!f.on || (f.jump < 0 && Math.hypot(f.p.x - player.x, f.p.z - player.z) > FAR)) { f.on = false; spawn(f, i, player.x, player.z); }
        if (!f.on) { for (const p of [body, tail, fin, eye, shine, blush]) hide(p, i); return; }
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
      for (const p of [body, tail, fin, eye, shine, blush]) {
        p.mesh.instanceMatrix.needsUpdate = true;
        if (colorsDirty && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
      colorsDirty = false;
    },
  };
}

export function makeCritters(root: THREE.Object3D, env: CritterEnv) {
  const flies = makeButterflies(root, env.light ? 12 : 24, env);
  const fish = makeFish(root, env.light ? 6 : 10, env);
  let now = 0;
  return {
    update(dt: number, player: THREE.Vector3) {
      now += dt;
      flies.update(dt, player, now);
      fish.update(dt, player, now);
    },
  };
}
