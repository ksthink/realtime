import * as THREE from "three";
import type { CharacterRow, DropResult, NetEvents, Pose, StoneRow, TowerRow } from "./net";
import { Net } from "./net";
import { formatLife, MAX_STONES, PICK_RANGE, PRAY_COOLDOWN_MS, PRAY_RANGE, STACK_RADIUS, TOWER_GAP, WISH_AT } from "./rules";
import { playDrop, playPick, playStep, setWaterDistance, stopSound, stopStep } from "./sound";
import { HILL, WATER_Y, WORLD, blocked, clamp, canWade, hillBlocked, isWater, lerp, onStairs, stairDip, terrainY, walkY, waterDistance } from "./terrain";
import { type Blob, REACTIONS, REACTION_SECONDS, type Reaction, animateBlob, makeBlob } from "./three/blob";
import { TowerLabel, floatingText } from "./three/label";
import { makePetals } from "./three/petals";
import { makeSkyline } from "./three/skyline";
import { makeRipple } from "./three/ripple";
import { makePathfinder, type PathPoint } from "./path";
import { makeSplash } from "./three/splash";
import { makePickGlow, makeStoneMesh } from "./three/stone";
import { makeCritters } from "./three/critters";
import { makeFireflies } from "./three/fireflies";
import { lanternLit, tickLanterns } from "./three/lantern";
import { buildWorld, groundAt } from "./three/world";
import { seeThrough } from "./three/bigtree";
import { makeDaytime, NOON_LIGHT } from "./three/daytime";
import { updateFogTint } from "./three/fogtint";
import { fitSunShadow, shadowLook } from "./three/sunshadow";
import { makeSky } from "./three/sky";
import { waterGlare, waterMood } from "./three/water";

// 소원을 빌 수 있게 된 순간(ready)과 최대 층에 닿은 순간(max)에 한 번씩 묻는다
export type WishPrompt = "ready" | "max";

export type HudState = {
  online: boolean; people: number; towers: number;
  myStones: number; myMinutes: number | null; myLife: string; wishPrompt: WishPrompt | null; firstStoneAsk: boolean; dropAsk: boolean;
  carrying: boolean; prompt: string; action: "first" | "stack" | "discard" | "blocked" | "pick" | "pray" | null; dropKind: "first" | "stack" | "discard" | "blocked" | null;
  canPray: boolean; prayWait: number; canWish: boolean; cam: string; toastId: number; toast: string;
};

type StoneView = {
  row: StoneRow; mesh: THREE.Mesh;
  from: THREE.Vector3 | null; to: THREE.Vector3; t: number; dur: number; arc: number;
  grow: number; dying: boolean; landSound?: boolean;
};
type TowerView = { row: TowerRow; label: TowerLabel; top: number; stage: 0 | 1 | 2; shown: 0 | 1 | 2; alpha: number; labelK: number; pop: number; popFrom: number }; // stage: 0 안 보임, 1 「…」, 2 내용
type Remote = { blob: Blob; target: THREE.Vector3; targetYaw: number; moving: boolean; seen: boolean; prayUntil: number; lastX: number; lastZ: number; splashD: number };
type Floater = { sprite: THREE.Sprite; t: number };

const CAMS = ["따라가기", "하늘에서"];
const UP = new THREE.Vector3(0, 1, 0);
// 안개(가까이, 멀리)와 카메라가 그리는 거리. 땅에서는 앞의 값, 동산 꼭대기에서는 뒤의 값으로 천천히 바뀐다
const FOG_GROUND = [48, 150, 260], FOG_TOP = [110, 300, 320];
// 탑 푯말: 가까이(LABEL_NEAR 안)는 내용 전체, 조금 떨어지면 「…」, 멀면 안 보인다.
// 나타나는 거리와 사라지는 거리를 달리 둬 경계에서 깜빡이지 않게 한다. 내 탑도 같은 규칙이다
const LABEL_NEAR = 2, LABEL_NEAR_OUT = 2.5, LABEL_FAR = 12, LABEL_FAR_OUT = 13;
const LABEL_POP = 0.14; // 푯말이 나타나거나 모습이 바뀔 때 살짝 커지며 또렷해지는 시간(초)
const LABEL_HIDE = 0.4; // 멀어져 사라지는 시간(초). 스르륵 옅어지며 살짝 작아진다
const HOVER_PAD = 24; // 펼친 푯말은 테두리 밖 이만큼(캔버스 픽셀)까지 마우스가 안에 있는 것으로 본다
const HOVER_GRACE = 0.12; // 마우스가 펼친 푯말을 벗어나고 이만큼(초) 지나야 접는다
const OPEN_SWITCH = 0.3; // 가까운 탑 둘 사이에서 펼친 푯말을 바꾸려면 이만큼(m) 더 가까워야 한다
// 시야각(도). 가로 화면은 세로 시야각 FOV_MIN을 쓰고, 화면이 좁아질수록(휴대폰 세로) 가로로 FOV_WIDE만큼 보이도록
// 세로 시야각을 넓힌다. 너무 넓으면 가장자리가 늘어나 보여 FOV_MAX에서 멈춘다
const FOV_MIN = 50, FOV_WIDE = 60, FOV_MAX = 76;
const PORTRAIT_PULL = 1.3; // 세로 화면에서는 카메라를 이만큼 더 뒤로 빼 양옆이 더 보이게 한다 // 단계가 바뀔 때 사라졌다 나타나는 시간(초)
const PICK_SWITCH_GAIN = 0.15; // 다른 돌이 이만큼(미터) 더 가까워야 대상을 바꾼다. 거리가 비슷한 돌 사이에서 깜빡이지 않게 한다
const HOVER_STONE_EVERY = 0.08; // 마우스 아래 돌을 이만큼(초)마다 다시 찾는다
const GLOW_FADE = 0.12; // 대상 표시가 사라지거나 나타나는 시간(초)
const LANTERN_LIGHT = 2.2; // 내 랜턴 빛 세기(칸델라). 발밑 둘레 몇 m를 따뜻하게 비춘다
const TOUCH_QUERY = "(hover: none), (pointer: coarse)"; // globals.css의 모바일 조건과 같다

// 다시 빚기를 취소하고 돌아올 자리
export type PlayerSpot = { x: number; z: number; yaw: number };

export class Game {
  readonly net: Net;
  private root = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private hemi = new THREE.HemisphereLight("#f3ecdf", "#b9c9b4", 1.6);
  // 서울의 실제 해·달로 정한 하늘빛. night(0 한낮 ~ 1 깊은 밤)은 다른 곳(생물·반딧불)에서 읽어 간다
  readonly daytime = makeDaytime();
  get night() { return this.daytime.night; }
  private sky = makeSky();
  private starPx = typeof devicePixelRatio === "number" ? Math.min(devicePixelRatio, 2) : 1;
  private me: Blob;
  private stones = new Map<string, StoneView>();
  private towers = new Map<string, TowerView>();
  private remotes = new Map<string, Remote>();
  private loadingChars = new Set<string>();
  private floaters: Floater[] = [];
  private prayers = new Map<string, number>();
  private people = 1;
  private online = false;
  private busy = false;
  private keys: Record<string, boolean> = {};
  joy = { x: 0, y: 0 };
  private orbitYaw = 0;
  private orbitPitch = 0.55;
  private orbitDist = 7.5;
  private camMode = 0;
  private camPos = new THREE.Vector3(0, 5, 9);
  private camLook = new THREE.Vector3();
  private poseT = 0;
  private keepT = 0;
  private lastSent: { x: number; z: number; yaw: number; r?: Reaction } = { x: 0, z: 0, yaw: 0 };
  private toastId = 0;
  private toastMsg = "";
  private beacon: THREE.Group;
  private ring: THREE.Mesh | null = null;
  private ringFor: string | null = null;
  inputLocked = false;
  private wishPrompt: WishPrompt | null = null;
  private firstStoneAsk = false;
  private dropAsk: { x: number; z: number } | null = null; // 탑이 없을 때 탭한 자리에 첫돌을 놓을지 묻는 중
  // 탭으로 걸어가는 곳. stone이면 닿았을 때 그 돌을 줍고, drop이면 그 자리를 바라보고 돌을 놓는다
  private walkTo: { x: number; z: number; stone?: StoneView; drop?: boolean; reach?: number; best?: number; stuck: number; path?: PathPoint[] } | null = null;
  private paths = makePathfinder((x, z) => !blocked(x, z) && !sunken(x, z));
  private ray = new THREE.Raycaster();
  private pickTarget: StoneView | null = null;
  private glow = makePickGlow();
  private petals = makePetals();
  private splash = makeSplash();
  private ripple = makeRipple();
  private skyline = makeSkyline();
  private world: ReturnType<typeof buildWorld>;
  private critters: ReturnType<typeof makeCritters>;
  private fireflies: ReturnType<typeof makeFireflies>;
  // 내 랜턴만 땅을 비추는 진짜 빛을 단다(PC). 다른 사람 랜턴과 휴대폰은 빛 번짐만.
  // 낮에도 빛은 그대로 두고 세기만 0으로 한다. 켜고 끄면(visible) 빛 개수가 바뀌어 모든 재질의 셰이더를 다시 만드느라 화면이 멈칫한다
  private lanternLight: THREE.PointLight | null = null;
  private lanternAt = new THREE.Vector3();
  private glowOn: StoneView | null = null;
  private glowK = 0;
  private waterT = 0;
  private lastContact = 0;
  private fogK = 0;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    netFactory: (ev: NetEvents) => Net,
    meRow: CharacterRow,
    private font: string,
    start?: PlayerSpot,
  ) {
    this.daytime.update(); // 첫 프레임 전에 지금 시각의 하늘을 구해 둔다(밤에 들어오자마자 동물이 낮처럼 나오지 않게)
    scene.background = new THREE.Color("#d9e3ef");
    scene.fog = new THREE.Fog("#d9e3ef", 48, 150);
    scene.add(this.root);
    this.root.add(this.hemi, ...this.sky.objects);
    this.sun = new THREE.DirectionalLight("#ffe9c9", 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // 그림자 상자 크기·깊이·치우침은 빛 높이에 따라 fitSunShadow가 맞춘다
    this.root.add(this.sun, this.sun.target);
    this.world = buildWorld(this.root);
    this.root.add(this.petals.points, this.splash.group, this.ripple.group, this.skyline.mesh);
    // 나비·물고기: 내 둘레에서만 사는 배경 생물. 휴대폰에서는 수를 줄인다
    this.critters = makeCritters(this.root, { flowers: this.world.flowers, meadows: this.world.meadows, perches: this.world.perches, splash: (x, z, yaw) => this.splash.emit(x, z, yaw), light: matchMedia(TOUCH_QUERY).matches });
    if (!matchMedia(TOUCH_QUERY).matches) {
      this.lanternLight = new THREE.PointLight("#ffc77d", 0, 6, 1.4);
      this.root.add(this.lanternLight);
    }
    this.fireflies = makeFireflies(this.root, { perches: this.world.perches, flowers: this.world.flowers, light: matchMedia(TOUCH_QUERY).matches });

    this.me = this.makeAvatar(meRow);
    const a = Math.random() * Math.PI * 2;
    this.me.g.position.set(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5);
    if (start) {
      this.me.g.position.set(start.x, 0, start.z);
      this.me.yaw = start.yaw;
    }
    this.me.baseY = standY(this.me.g.position.x, this.me.g.position.z);

    this.root.add(this.glow.group);

    this.beacon = makeBeacon();
    this.beacon.visible = false;
    this.root.add(this.beacon);

    this.net = netFactory({
      snapshot: (s, t, p) => this.onSnapshot(s, t, p),
      stone: (r) => this.applyStone(r),
      stoneGone: (id) => this.removeStone(id),
      tower: (r) => this.applyTower(r),
      towerGone: (id) => this.removeTower(id),
      pose: (p) => this.onPose(p),
      prayed: (id, tower) => this.onRemotePray(id, tower),
      presence: (ids) => this.onPresence(ids),
      status: (on) => { this.online = on; },
    });
  }

  private makeAvatar(c: CharacterRow) {
    const blob = makeBlob({ seed: c.seed, name: c.name, top: c.top_color, bottom: c.bottom_color, body: c.body }, this.font);
    this.root.add(blob.g);
    return blob;
  }

  // ───────── 수신 ─────────
  private onSnapshot(stones: StoneRow[], towers: TowerRow[], prayers: { tower_id: string; prayed_at: string }[]) {
    const sIds = new Set(stones.map((s) => s.id)), tIds = new Set(towers.map((t) => t.id));
    for (const id of [...this.stones.keys()]) if (!sIds.has(id)) this.removeStone(id);
    for (const id of [...this.towers.keys()]) if (!tIds.has(id)) this.removeTower(id);
    for (const t of towers) this.applyTower(t);
    for (const s of stones) this.applyStone(s);
    this.prayers.clear();
    for (const p of prayers) this.prayers.set(p.tower_id, Date.parse(p.prayed_at));
  }

  private applyStone(row: StoneRow) {
    let v = this.stones.get(row.id);
    const isNew = !v;
    if (!v) {
      const mesh = makeStoneMesh(row.seed, row.radius, row.height);
      mesh.position.set(row.x, groundAt(row.x, row.z) + row.height / 2, row.z);
      this.root.add(mesh);
      v = { row, mesh, from: null, to: mesh.position.clone(), t: 1, dur: 1, arc: 0, grow: 0, dying: false };
      this.stones.set(row.id, v);
    }
    const prev = v.row;
    v.row = row;
    v.dying = false;
    // 내가 내려놓은 돌은 땅이나 탑에 닿는 순간 소리를 낸다
    if (prev.state === "held" && prev.holder_id === this.net.uid && row.state !== "held") v.landSound = true;
    if (prev.tower_id && prev.tower_id !== row.tower_id) this.restack(prev.tower_id);
    if (row.state === "stacked" && row.tower_id) this.restack(row.tower_id);
    else if (row.state === "ground") {
      const to = new THREE.Vector3(row.x, groundAt(row.x, row.z) + row.height / 2, row.z);
      // 탑에서 흩어질 때는 높이 튀어 오른다
      this.moveStone(v, to, isNew ? 0 : prev.state === "stacked" ? 0.8 : 0.35, prev.state === "stacked" ? 1.4 : 0.3);
    }
    if (v.landSound && !v.from) { v.landSound = false; playDrop(); }
  }

  private moveStone(v: StoneView, to: THREE.Vector3, dur: number, arc: number) {
    if (dur <= 0 || v.mesh.position.distanceToSquared(to) < 1e-4) {
      v.mesh.position.copy(to); v.to.copy(to); v.from = null; v.t = 1;
      return;
    }
    v.from = v.mesh.position.clone(); v.to.copy(to); v.t = 0; v.dur = dur; v.arc = arc;
  }

  // 탑의 돌 높이는 아래부터 쌓아 올려 계산한다. 서버는 수평 어긋남만 저장한다
  private restack(towerId: string) {
    const list = [...this.stones.values()]
      .filter((v) => v.row.state === "stacked" && v.row.tower_id === towerId)
      .sort((a, b) => (a.row.order_index ?? 0) - (b.row.order_index ?? 0));
    if (!list.length) return;
    let y = groundAt(list[0].row.x, list[0].row.z);
    let belowH = 0;
    for (const v of list) {
      const sink = belowH ? Math.min(v.row.height, belowH) * 0.12 : 0;
      const to = new THREE.Vector3(v.row.x, y + v.row.height / 2 - sink, v.row.z);
      if (!v.to.equals(to)) this.moveStone(v, to, 0.35, 0.5);
      y += v.row.height - sink;
      belowH = v.row.height;
    }
    const t = this.towers.get(towerId);
    if (t) t.top = y;
  }

  private removeStone(id: string) {
    const v = this.stones.get(id);
    if (v) v.dying = true;
  }

  private applyTower(row: TowerRow) {
    let t = this.towers.get(row.id);
    if (!t) {
      const label = new TowerLabel(this.font);
      this.root.add(label.sprite);
      t = { row, label, top: groundAt(row.x, row.z), stage: 0, shown: 0, alpha: 0, labelK: 1, pop: 1, popFrom: 0 };
      label.setOpacity(0);
      this.towers.set(row.id, t);
      this.restack(row.id);
    }
    t.row = row;
    // 휴대폰에서는 남의 탑 푯말이 화면을 많이 가려서 절반 크기로 줄인다. 소원을 빌면 내 탑도 남의 탑이 된다
    t.labelK = row.owner_id !== this.net.uid && matchMedia(TOUCH_QUERY).matches ? 0.5 : 1;
  }

  private removeTower(id: string) {
    const t = this.towers.get(id);
    if (!t) return;
    this.root.remove(t.label.sprite);
    t.label.dispose();
    this.towers.delete(id);
    this.prayers.delete(id);
  }

  private onPresence(ids: string[]) {
    this.people = Math.max(1, ids.length);
    const live = new Set(ids);
    for (const [id, r] of this.remotes) {
      if (!live.has(id)) { this.root.remove(r.blob.g); this.remotes.delete(id); }
    }
    for (const id of ids) {
      if (id === this.net.uid || this.remotes.has(id) || this.loadingChars.has(id)) continue;
      this.loadingChars.add(id);
      void this.net.character(id).then((c) => {
        this.loadingChars.delete(id);
        if (!c || this.remotes.has(id)) return;
        const blob = this.makeAvatar(c);
        blob.g.visible = false; // 첫 위치를 받기 전까지 숨긴다
        this.remotes.set(id, { blob, target: new THREE.Vector3(), targetYaw: 0, moving: false, seen: false, prayUntil: 0, lastX: 0, lastZ: 0, splashD: 0 });
      });
    }
    this.sendPoseNow(); // 새로 온 사람이 내 위치를 바로 알도록
  }

  private onPose(p: Pose) {
    const r = this.remotes.get(p.id);
    if (!r || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    r.target.set(p.x, 0, p.z);
    r.targetYaw = p.yaw;
    r.moving = p.m;
    if (!r.seen) { r.seen = true; r.blob.g.visible = true; r.blob.g.position.set(p.x, 0, p.z); r.blob.yaw = p.yaw; }
    // 3초마다 같은 값이 다시 와도 바뀔 때만 재시작한다. 리액션 끝은 보낸 쪽이 알려 준다.
    // 합장 중에는 r이 오지 않으므로, r이 왔다면 보낸 쪽은 이미 합장을 끝낸 것이다
    const b = r.blob, kind = isReaction(p.r) ? p.r : null;
    if (kind) {
      if (b.state !== kind) { b.state = kind; b.stateT = 0; }
    } else if (isReaction(b.state)) b.state = "idle";
  }

  private onRemotePray(id: string, tower: string) {
    const r = this.remotes.get(id), t = this.towers.get(tower);
    if (r) { r.blob.state = "pray"; r.blob.stateT = 0; r.prayUntil = performance.now() + 2000; }
    if (t) this.floatAt(t);
  }

  private floatAt(t: TowerView) {
    const sprite = floatingText("+1시간", this.font);
    sprite.position.set(t.row.x, t.top + 0.4, t.row.z);
    this.root.add(sprite);
    this.floaters.push({ sprite, t: 0 });
  }

  // ───────── 조회 ─────────
  private get myTower() {
    for (const t of this.towers.values()) if (t.row.owner_id === this.net.uid && Date.parse(t.row.expires_at) > Date.now()) return t;
    return null;
  }
  private get myHeld() {
    for (const v of this.stones.values()) if (v.row.state === "held" && v.row.holder_id === this.net.uid && !v.dying) return v;
    return null;
  }
  private towerStoneCount(id: string) {
    let n = 0;
    for (const v of this.stones.values()) if (v.row.tower_id === id && v.row.state === "stacked" && !v.dying) n++;
    return n;
  }
  // 줍기 대상: 범위 안에서 가장 가까운 바닥 돌, 또는 돌이 하나뿐인 내 탑의 첫 돌. 빛나는 돌과 주워지는 돌은 항상 이 돌이다
  private refreshPickTarget() {
    if (this.myHeld) { this.pickTarget = null; return; }
    const p = this.me.g.position, mineId = this.myTower?.row.id, cur = this.pickTarget;
    let best: StoneView | null = null, bestD: number = PICK_RANGE, curD = Infinity;
    const consider = (v: StoneView) => {
      const d = Math.hypot(v.row.x - p.x, v.row.z - p.z);
      if (v === cur) curD = d;
      if (d < bestD) { bestD = d; best = v; }
    };
    let first: StoneView | null = null, ownCount = 0;
    for (const v of this.stones.values()) {
      if (v.dying) continue;
      if (v.row.state === "ground") consider(v);
      else if (v.row.state === "stacked" && v.row.tower_id === mineId) { first = v; ownCount++; }
    }
    if (first && ownCount === 1) consider(first);
    this.pickTarget = curD < PICK_RANGE && curD - PICK_SWITCH_GAIN < bestD ? cur : best;
  }

  private updateGlow(dt: number) {
    const s = this.me.state;
    const want = this.inputLocked || s === "pickup" || s === "place" ? null : this.hoverStone && this.pickable(this.hoverStone) ? this.hoverStone : this.pickTarget;
    if (this.glowOn !== want) {
      this.glowK -= dt / GLOW_FADE;
      if (this.glowK <= 0) {
        this.glowK = 0;
        this.glowOn = want;
      }
    } else if (want) this.glowK = Math.min(1, this.glowK + dt / GLOW_FADE);

    const { group, uniforms } = this.glow;
    group.visible = !!this.glowOn;
    uniforms.uK.value = this.glowK;
    uniforms.uTime.value += dt;
    if (this.glowOn) {
      const { x, z } = this.glowOn.mesh.position;
      group.position.set(x, groundAt(x, z), z);
      const k = 0.2 + this.glowOn.row.radius * 1.5; // 돌 크기에 맞춘다. 높이는 그대로 둔다
      group.scale.set(k, 1, k);
    }
  }
  private nearestTower(rad: number) {
    let best: TowerView | null = null, bd = rad;
    const p = this.me.g.position;
    for (const t of this.towers.values()) {
      if (Date.parse(t.row.expires_at) <= Date.now()) continue;
      const d = Math.hypot(t.row.x - p.x, t.row.z - p.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  private dropPoint() {
    const p = this.me.g.position;
    const x = p.x + Math.sin(this.me.yaw) * 0.7, z = p.z + Math.cos(this.me.yaw) * 0.7;
    return !isWater(x, z) && !sunken(x, z) && !hillBlocked(x, z) && Math.hypot(x, z) < WORLD ? { x, z } : { x: p.x, z: p.z };
  }
  // 계단 위에서는 돌이 디딤판에 묻히므로 놓지 않는다
  private get onStairs() {
    const p = this.me.g.position, d = this.dropPoint();
    return onStairs(p.x, p.z) || onStairs(d.x, d.z);
  }
  private dropKind(): HudState["dropKind"] {
    if (!this.myHeld || this.onStairs) return null;
    const { x, z } = this.dropPoint();
    const mine = this.myTower;
    if (mine) {
      if (this.towerStoneCount(mine.row.id) >= MAX_STONES) return "discard";
      return Math.hypot(mine.row.x - x, mine.row.z - z) <= STACK_RADIUS ? "stack" : "discard";
    }
    for (const t of this.towers.values()) if (Math.hypot(t.row.x - x, t.row.z - z) < TOWER_GAP) return "blocked";
    return "first";
  }
  private prayWait(id: string) {
    const last = this.prayers.get(id);
    return last ? Math.max(0, last + PRAY_COOLDOWN_MS - Date.now()) : 0;
  }

  // ───────── 입력 ─────────
  setKey(code: string, down: boolean) {
    this.keys[code] = down;
    if (down) this.walkTo = null; // 키를 누르면 탭으로 가던 길은 그만둔다
  }
  releaseKeys() { this.keys = {}; this.joy = { x: 0, y: 0 }; }
  orbit(dx: number, dy: number) {
    this.orbitYaw -= dx * 0.006;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, 0.12, 1.4);
  }
  zoom(d: number) { this.orbitDist = clamp(this.orbitDist + d * 0.01, 3, 18); }
  cycleCam() {
    this.camMode = (this.camMode + 1) % CAMS.length;
    this.toast(`뷰: ${CAMS[this.camMode]}`);
  }
  toast(msg: string) { this.toastMsg = msg; this.toastId++; }

  // 화면 탭(x, y는 -1~1): 보이는 푯말 중 가장 앞의 것을 펼치거나 접는다. 푯말을 맞혔으면 true
  tapLabel(x: number, y: number) {
    if (this.inputLocked) return false;
    this.ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    let best: TowerLabel | null = null, bestD = Infinity;
    for (const t of this.towers.values()) {
      if (!t.label.sprite.visible) continue;
      const hit = this.ray.intersectObject(t.label.sprite)[0];
      if (hit?.uv && hit.distance < bestD && t.label.contains(hit.uv)) { best = t.label; bestD = hit.distance; }
    }
    best?.toggle();
    return !!best;
  }

  // 화면 탭(클릭): 푯말 → 돌 → 땅 순서로 맞힌 것을 본다. 땅이면 그리로 걷고, 주울 수 있는 돌이면 가서 줍는다.
  // 돌을 들고 있으면 내 탑 둘레를 탭했을 때 가서 쌓고, 탑이 없으면 그 자리에 첫돌을 놓을지 묻는다
  tap(x: number, y: number) {
    if (this.tapLabel(x, y)) return;
    if (!this.canTapWalk) return;
    this.ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const ground = this.groundHit();
    const stone = this.stoneHit(ground);
    const held = this.myHeld;
    if (!held && stone && this.pickable(stone)) {
      this.walkTo = { x: stone.row.x, z: stone.row.z, stone, stuck: 0 };
      this.rippleAt(stone.row.x, stone.row.z);
      return;
    }
    if (!stone && this.beaconHit(ground?.t ?? Infinity)) { this.goToMyTower(); return; }
    const pt = stone ? { x: stone.mesh.position.x, z: stone.mesh.position.z } : ground;
    if (!pt) return;
    const mine = this.myTower;
    if (held && !mine) {
      const why = this.cantDropAt(pt.x, pt.z);
      if (why) { this.toast(why); return; }
      this.rippleAt(pt.x, pt.z);
      this.walkTo = null;
      this.dropAsk = { x: pt.x, z: pt.z };
      this.inputLocked = true;
      this.releaseKeys();
      return;
    }
    this.rippleAt(pt.x, pt.z);
    if (held && mine && Math.hypot(mine.row.x - pt.x, mine.row.z - pt.z) <= STACK_RADIUS) {
      this.walkTo = { x: mine.row.x, z: mine.row.z, drop: true, stuck: 0 };
    } else this.walkTo = { x: pt.x, z: pt.z, stuck: 0 };
  }
  // 광선에 맞은 가장 앞의 돌. 언덕 너머에 가려진 돌은 맞힌 것으로 치지 않는다
  private stoneHit(ground: { t: number } | null) {
    let stone: StoneView | null = null, bestD = ground ? ground.t + 0.3 : Infinity;
    for (const v of this.stones.values()) {
      if (v.dying || v.row.state === "held") continue; // 머리 위에 든 돌은 땅을 탭한 것으로 본다
      const hit = this.ray.intersectObject(v.mesh)[0];
      if (hit && hit.distance < bestD) { bestD = hit.distance; stone = v; }
    }
    return stone;
  }
  // PC 마우스가 올라간 주울 수 있는 돌. 줍기 대상과 같은 빛을 띄워 클릭하면 무엇을 주울지 미리 보여 준다.
  // 땅 광선 계산이 무거워 HOVER_STONE_EVERY초마다만 다시 찾는다
  private hoverStone: StoneView | null = null;
  private hoverStoneT = 0;
  private updateHoverStone(dt: number) {
    if ((this.hoverStoneT -= dt) > 0) return;
    this.hoverStoneT = HOVER_STONE_EVERY;
    this.hoverStone = null;
    if (!this.hover || this.myHeld || !this.canTapWalk) return;
    this.ray.setFromCamera(new THREE.Vector2(this.hover.x, this.hover.y), this.camera);
    const v = this.stoneHit(this.groundHit());
    if (v && this.pickable(v)) this.hoverStone = v;
  }
  private get canTapWalk() {
    const s = this.me.state;
    return !this.inputLocked && !this.busy && s !== "pickup" && s !== "place" && s !== "pray";
  }
  // 내 탑으로 걸어간다(빛기둥이나 「내 탑」 표시를 눌렀을 때). 돌을 들고 있으면 가서 쌓고, 아니면 돌을 밟지 않게 1.2m 앞에서 선다
  goToMyTower() {
    const mine = this.myTower;
    if (!mine || !this.canTapWalk) return;
    const { x, z } = mine.row;
    this.rippleAt(x, z);
    this.walkTo = this.myHeld ? { x, z, drop: true, stuck: 0 } : { x, z, reach: 1.2, stuck: 0 };
  }
  // 광선이 기둥 축에서 보이는 굵기의 1.5배 안으로 지나가면 맞힌 것으로 본다(굵기는 멀수록 커지므로 먼 기둥도 누르기 쉽다).
  // 땅에 먼저 닿는 광선(기둥 앞의 땅)과 밑동 1m는 땅을 탭한 것으로 둔다(탑 옆 땅을 눌러 그리로 걸어갈 수 있게)
  private beaconHit(groundT: number) {
    if (!this.beacon.visible) return false;
    const { origin: o, direction: d } = this.ray.ray, b = this.beacon.position;
    const hh = d.x * d.x + d.z * d.z;
    if (hh < 1e-6) return false;
    const t = ((b.x - o.x) * d.x + (b.z - o.z) * d.z) / hh; // 위에서 본 광선이 축에 가장 가까워지는 곳
    if (t <= 0 || t >= groundT) return false;
    const off = Math.hypot(o.x + d.x * t - b.x, o.z + d.z * t - b.z), y = o.y + d.y * t - b.y;
    return off < this.beacon.children[0].scale.x * 1.5 && y > 1 && y < 40;
  }
  private rippleAt(x: number, z: number) { this.ripple.emit(x, groundAt(x, z), z); }
  // 땅 메시를 따로 들고 있지 않아, 광선을 0.2m씩 따라가다 땅 밑으로 들어간 곳을 찾고 반으로 나눠 좁힌다
  private groundHit() {
    const { origin: o, direction: d } = this.ray.ray;
    const above = (t: number) => o.y + d.y * t - groundAt(o.x + d.x * t, o.z + d.z * t);
    for (let a = 0, t = 0.2; t <= 120; a = t, t += 0.2) {
      if (above(t) > 0) continue;
      let b = t;
      for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (above(m) > 0) a = m; else b = m; }
      return { x: o.x + d.x * b, z: o.z + d.z * b, t: b };
    }
    return null;
  }
  // refreshPickTarget와 같은 규칙: 바닥 돌, 또는 돌이 하나뿐인 내 탑의 첫 돌
  private pickable(v: StoneView) {
    if (v.dying) return false;
    if (v.row.state === "ground") return true;
    const mine = this.myTower;
    return !!mine && v.row.state === "stacked" && v.row.tower_id === mine.row.id && this.towerStoneCount(mine.row.id) === 1;
  }
  private cantDropAt(x: number, z: number) {
    if (isWater(x, z) || sunken(x, z) || hillBlocked(x, z) || onStairs(x, z) || Math.hypot(x, z) >= WORLD) return "여기에는 돌을 놓을 수 없어요";
    for (const t of this.towers.values()) if (Math.hypot(t.row.x - x, t.row.z - z) < TOWER_GAP) return "다른 탑과 너무 가까워요";
    return null;
  }
  // [네]: 그 자리로 걸어가 첫돌을 놓는다. [아니요]: 아무것도 하지 않는다
  answerDropAsk(yes: boolean) {
    const at = this.dropAsk;
    this.dropAsk = null;
    this.inputLocked = false;
    if (yes && at && this.myHeld) this.walkTo = { ...at, drop: true, stuck: 0 };
  }

  react(kind: Reaction) {
    if (this.inputLocked) return;
    if (this.myHeld) { this.toast("돌을 내려놓고 할 수 있어요"); return; }
    const s = this.me.state;
    if (this.busy || s === "pickup" || s === "place" || s === "pray") return;
    this.me.state = kind; this.me.stateT = 0;
    this.sendPoseNow();
  }

  action() {
    this.walkTo = null; // 버튼·키로 직접 하면 탭으로 가던 길은 그만둔다
    return this.act();
  }
  // target: 탭해서 고른 돌. 없으면 가까운 돌(pickTarget)을 줍는다. at: 탭해서 고른 놓을 자리. 없으면 0.7m 앞(dropPoint)
  private async act(target?: StoneView, at?: { x: number; z: number }) {
    if (this.busy || this.me.state === "pickup" || this.me.state === "place") return;
    this.busy = true;
    try {
      const held = this.myHeld;
      if (held) await this.drop(held, at);
      else await this.pick(target);
    } finally {
      this.busy = false;
    }
  }

  private async pick(target?: StoneView) {
    if (!target) this.refreshPickTarget();
    const s = target ?? this.pickTarget;
    if (s?.row.state === "stacked") {
      this.firstStoneAsk = true;
      this.inputLocked = true;
      this.releaseKeys();
      return;
    }
    if (!s) { this.toast("가까운 돌이 없어요"); return; }
    const p = this.me.g.position;
    this.me.yaw = Math.atan2(s.row.x - p.x, s.row.z - p.z);
    this.me.state = "pickup"; this.me.stateT = 0;
    if (await this.net.pickStone(s.row.id)) {
      playPick();
      this.applyStone({ ...s.row, state: "held", holder_id: this.net.uid, expires_at: null });
    } else {
      this.toast("다른 사람이 먼저 집었어요");
    }
  }

  private async drop(held: StoneView, at?: { x: number; z: number }) {
    const { x, z } = at ?? this.dropPoint(), p = this.me.g.position;
    if (onStairs(p.x, p.z) || onStairs(x, z)) { this.toast("계단에서는 돌을 놓을 수 없어요"); return; }
    this.me.state = "place"; this.me.stateT = 0;
    const r = await this.net.dropStone(held.row.id, x, z);
    this.onDropResult(r);
  }

  private onDropResult(r: DropResult) {
    if (r.result === "stacked" && (r.count === WISH_AT || r.count === MAX_STONES)) {
      this.wishPrompt = r.count === WISH_AT ? "ready" : "max";
      this.inputLocked = true;
      this.releaseKeys();
      return;
    }
    const msg: Record<DropResult["result"], string> = {
      first: "첫돌을 놓았어요! 빛기둥이 내 탑을 알려줘요",
      stacked: `${r.count}단!`,
      collapsed: "와르르… 탑이 무너졌어요",
      discarded: "돌을 버렸어요. 첫돌 근처에 놓아야 쌓여요",
      too_close: "다른 탑과 너무 가까워요. 돌은 바닥에 놓였어요",
      full: `탑은 ${MAX_STONES}단까지예요. 돌은 바닥에 놓였어요`,
      rejected: "돌을 내려놓지 못했어요",
    };
    this.toast(msg[r.result]);
  }

  async prayAction() {
    this.walkTo = null;
    if (this.busy || this.me.state === "pray") return;
    const t = this.nearestTower(PRAY_RANGE);
    if (!t) { this.toast("탑 가까이에서 합장할 수 있어요"); return; }
    const wait = this.prayWait(t.row.id);
    if (wait > 0) { this.toast(`이 탑에는 ${Math.ceil(wait / 60000)}분 뒤 다시 합장할 수 있어요`); return; }
    const p = this.me.g.position;
    this.me.yaw = Math.atan2(t.row.x - p.x, t.row.z - p.z);
    this.me.state = "pray"; this.me.stateT = 0;
    this.sendPoseNow();
    this.busy = true;
    const r = await this.net.pray(t.row.id);
    this.busy = false;
    if (r.ok) {
      this.prayers.set(t.row.id, Date.now());
      if (r.expires_at) t.row = { ...t.row, expires_at: r.expires_at };
      this.floatAt(t);
      this.net.sendPray(t.row.id);
      this.toast("합장했어요. 탑의 수명이 1시간 늘었어요");
    } else {
      this.me.state = "idle";
      if (r.reason === "cooldown" && r.prayed_at) this.prayers.set(t.row.id, Date.parse(r.prayed_at));
      this.toast(r.reason === "cooldown" ? "이 탑에는 조금 뒤 다시 합장할 수 있어요" : "합장하지 못했어요");
    }
  }

  get canWishHere() {
    const t = this.myTower;
    return !!t && this.towerStoneCount(t.row.id) >= WISH_AT;
  }
  get askOpen() { return !!this.wishPrompt || this.firstStoneAsk || !!this.dropAsk; }
  closeWishPrompt() {
    this.wishPrompt = null;
    this.inputLocked = false;
  }
  // [네]: 탑을 없애고 돌은 그 자리에 남긴다. [아니요]: 그대로 이어서 쌓는다
  async answerFirstStone(release: boolean) {
    this.firstStoneAsk = false;
    this.inputLocked = false;
    if (!release) return;
    const ok = await this.net.releaseFirstStone();
    if (ok) await this.net.resync();
    this.toast(ok ? "첫 돌을 내려놓았어요. 새 첫 돌을 찾아보세요" : "첫 돌을 바꾸지 못했어요");
  }
  // 소원을 빌면 탑은 내 손을 떠난다. 실시간 이벤트를 기다리지 않고 바로 반영해 새 탑을 시작할 수 있게 한다
  async makeWish(text: string) {
    const mine = this.myTower;
    const ok = await this.net.setWish(text);
    if (ok && mine) this.applyTower({ ...mine.row, wish: text, owner_id: null });
    this.toast(ok ? "소원을 빌었습니다" : "소원을 빌지 못했어요");
    return ok;
  }

  // ───────── 프레임 ─────────
  update(dt: number) {
    tickLanterns(this.night); // 어두워지면 랜턴을 들고 불을 켠다(모두 함께)
    this.updatePlayer(dt);
    this.updateRemotes(dt);
    this.updateStones(dt);
    this.refreshPickTarget();
    this.updateHoverStone(dt);
    this.paths.warm(1);
    this.updateGlow(dt);
    this.updateTowers(dt);
    this.updateFloaters(dt);
    this.updateCamera(dt);
    this.updatePoseSend(dt);
    const p = this.me.g.position;
    this.world.update(dt, this.camera, this.scene.fog as THREE.Fog);
    this.critters.update(dt, p, this.night); // 밤이면 나비는 쉬고 새는 잔다
    // 내 랜턴 자리(유리 가운데). 반딧불이가 살짝 모여들고, PC에서는 진짜 빛이 여기서 나온다
    const lt = this.me.lantern, lit = lt.g.visible;
    if (lit) lt.g.localToWorld(this.lanternAt.set(0, -0.125, 0));
    this.fireflies.update(dt, p, this.night, lit ? this.lanternAt : null); // 어두워지면 반딧불이가 나온다
    if (this.lanternLight) {
      const k = lit ? lanternLit.light : 0;
      this.lanternLight.intensity = k * LANTERN_LIGHT;
      if (k > 0) this.lanternLight.position.copy(this.lanternAt);
    }
    this.petals.update(dt, p, this.petalTint()); // 꽃잎도 지금 하늘빛에 물든다
    this.splash.update(dt);
    this.ripple.update(dt);
    this.updateDaytime();
    fitSunShadow(this.sun, p, this.daytime.lightDir, this.camera); // 해가 낮으면 긴 그림자를 담도록 그림자 상자를 늘린다
    shadowLook(this.sun, this.daytime.lightDir, this.daytime.night); // 그림자 진하기: 낮 0.7, 해가 낮을 때·밤엔 더 옅게
  }

  // 하늘·안개·빛·먼 산·물빛을 지금 하늘에 맞춘다. 한낮(해 높이 24° 위)은 예전 값 그대로다
  // 꽃잎은 빛을 받지 않는 재질이라, 하늘빛·햇빛을 한낮과 견줘 색을 곱해 준다(한낮 = 흰색)
  private petalTintC = new THREE.Color();
  private petalTint() {
    const d = this.daytime, n = NOON_LIGHT, c = this.petalTintC;
    const ch = (sky: number, sun: number, nSky: number, nSun: number) => (sky * d.hemiI * 0.6 + sun * d.lightI * 0.4) / (nSky * n.skyI * 0.6 + nSun * n.sunI * 0.4);
    return c.setRGB(ch(d.hemiSky.r, d.light.r, n.sky.r, n.sun.r), ch(d.hemiSky.g, d.light.g, n.sky.g, n.sun.g), ch(d.hemiSky.b, d.light.b, n.sky.b, n.sun.b));
  }

  private updateDaytime() {
    const d = this.daytime.update(), scene = this.scene;
    (scene.background as THREE.Color).copy(d.horizon);
    (scene.fog as THREE.Fog).color.copy(d.horizon);
    this.hemi.color.copy(d.hemiSky); this.hemi.groundColor.copy(d.hemiGround); this.hemi.intensity = d.hemiI;
    this.sun.color.copy(d.light); this.sun.intensity = d.lightI;
    this.skyline.tint(d.horizon, d.mountain);
    waterMood.color.value.copy(d.water); waterMood.k.value = d.waterK;
    // 해가 30°보다 낮아질수록(8°에서 가장) 물 반사를 부드럽게. 밤에도 그대로 거칠게 둔다
    { const t = THREE.MathUtils.clamp((d.sunAlt - 8) / 22, 0, 1); waterGlare.value = 1 - t * t * (3 - 2 * t); }
    updateFogTint(d);
    this.sky.update(this.camera, d, this.starPx);
  }

  private updatePlayer(dt: number) {
    const me = this.me, k = this.keys;
    me.carrying = !!this.myHeld;
    if ((me.state === "pickup" || me.state === "place") && me.stateT > 0.5) me.state = "idle";
    if (me.state === "pray" && me.stateT > 2) me.state = "idle";
    if (isReaction(me.state) && me.stateT >= REACTION_SECONDS[me.state]) me.state = "idle";
    let ix = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + this.joy.x;
    let iz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0) + this.joy.y;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    let moving = false;
    const wantsMove = !this.inputLocked && il > 0.05;
    if (il > 0.05) this.walkTo = null; // 키·조이스틱으로 움직이면 탭으로 가던 길은 그만둔다
    const tapWalk = !this.inputLocked && !!this.walkTo;
    if ((wantsMove || tapWalk) && isReaction(me.state)) me.state = "idle";
    if (wantsMove && me.state === "idle") {
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, UP);
      const dir = right.multiplyScalar(ix).addScaledVector(fwd, -iz);
      // 벽에 정면으로 막혀 못 갔으면 걷지 않고 선다(제자리 걸음과 발소리를 내지 않는다)
      moving = this.walk(dir, (me.carrying ? 3 : 4) * dt * Math.min(1, il), dt) > 0; // 조이스틱을 덜 기울이면 천천히 걷는다
    } else if (tapWalk && me.state === "idle") moving = this.followTap(dt);
    me.baseY = standY(me.g.position.x, me.g.position.z);
    animateBlob(me, dt, moving);
    // 발이 땅에 닿는 순간(걷기 위상이 π의 배수를 지날 때) 발소리를 낸다. 웅덩이에서는 물이 살짝 튄다
    const contact = Math.floor(me.walk / Math.PI);
    if (moving && contact !== this.lastContact) {
      playStep();
      this.splashAt(me);
    }
    if (!moving && this.movingNow) stopStep();
    this.lastContact = contact;
    this.movingNow = moving;
    this.waterT -= dt;
    if (this.waterT <= 0) {
      this.waterT = 0.25;
      setWaterDistance(waterDistance(me.g.position.x, me.g.position.z));
    }
  }
  private movingNow = false;

  // dir 쪽으로 want만큼 걷고 그쪽으로 돌아선다. 실제로 간 거리를 돌려준다
  private walk(dir: THREE.Vector3, want: number, dt: number) {
    const me = this.me, from = me.g.position.clone();
    const moved = stepOnLand(me.g.position, dir, want);
    // 벽을 따라 미끄러질 때는 실제로 가는 쪽을 바라본다
    const face = moved > 0 ? me.g.position.clone().sub(from) : dir;
    const dy = Math.atan2(face.x, face.z) - me.yaw;
    me.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * Math.min(1, dt * 12);
    return moved;
  }

  // 탭한 곳으로 곧장 걷는다. 닿으면 고른 돌을 줍거나, 그 자리를 바라보고 그곳에 돌을 놓는다
  private followTap(dt: number) {
    this.frameDt = dt;
    const w = this.walkTo!, me = this.me, p = me.g.position, held = this.myHeld;
    // 가는 사이 돌을 누가 집었거나, 들고 있던 돌이 없어졌으면 그만둔다
    if (w.stone ? held || !this.pickable(w.stone) : w.drop && !held) { this.walkTo = null; return false; }
    const tx = w.stone ? w.stone.row.x : w.x, tz = w.stone ? w.stone.row.z : w.z;
    // 처음 한 번 강·비탈을 돌아가는 길을 찾고, 꺾이는 곳을 하나씩 지나간다. 마지막 점은 목표 자리다
    w.path ??= this.paths.find(p.x, p.z, tx, tz).pts;
    while (w.path.length > 1 && Math.hypot(w.path[0].x - p.x, w.path[0].z - p.z) < 0.3) { w.path.shift(); w.best = undefined; w.stuck = 0; }
    if (w.path.length > 1) {
      const wp = w.path[0], wd = new THREE.Vector3(wp.x - p.x, 0, wp.z - p.z), dd = wd.length();
      const moved = this.walk(wd.divideScalar(dd), Math.min((me.carrying ? 3 : 4) * dt, dd), dt);
      this.checkStuck(w, dd - moved);
      return moved > 0;
    }
    const dir = new THREE.Vector3(tx - p.x, 0, tz - p.z), d = dir.length();
    const reach = w.reach ?? (w.stone ? 1.2 : w.drop ? 0.7 : 0.1); // 줍기는 PICK_RANGE보다 조금 안쪽까지 가야 확실히 닿는다
    if (d <= reach) {
      this.walkTo = null;
      if ((w.drop || w.stone) && d > 0.05) me.yaw = Math.atan2(tx - p.x, tz - p.z); // 곧바로 돌아서 바라본다
      if (!w.drop && !w.stone) return false;
      if (this.busy) return false; // 다른 일(합장 등)을 하는 중이면 조용히 그만둔다
      // 놓는 자리는 바라보는 방향과 상관없이 탭한 곳(탑이면 탑 가운데)이다. 너무 가까이 서 있어도 그 자리에 놓인다
      void (w.stone ? this.act(w.stone) : this.act(undefined, { x: tx, z: tz }));
      return false;
    }
    const moved = this.walk(dir.divideScalar(d), Math.min((me.carrying ? 3 : 4) * dt, d - reach + 0.02), dt);
    this.checkStuck(w, d - moved);
    return moved > 0;
  }
  // 벽을 따라 미끄러지기만 하고 0.5초 동안 0.05m도 가까워지지 못하면 그만둔다
  private checkStuck(w: NonNullable<Game["walkTo"]>, left: number) {
    if (left < (w.best ?? Infinity) - 0.05) { w.best = left; w.stuck = 0; }
    else if ((w.stuck += this.frameDt) > 0.5) {
      this.walkTo = null;
      if (w.drop || w.stone) this.toast("거기까지 갈 수 없어요");
    }
  }
  private frameDt = 0;

  private splashAt(b: Blob) {
    const p = b.g.position;
    if (canWade(p.x, p.z)) this.splash.emit(p.x, p.z, b.yaw);
  }

  private updateRemotes(dt: number) {
    const k = 1 - Math.exp(-dt * 10); // 100ms 정도 뒤따라가는 보간
    const holders = new Set<string>();
    for (const v of this.stones.values()) if (v.row.state === "held" && v.row.holder_id) holders.add(v.row.holder_id);
    for (const [id, r] of this.remotes) {
      if (!r.seen) continue;
      const b = r.blob, p = b.g.position;
      p.x = lerp(p.x, r.target.x, k);
      p.z = lerp(p.z, r.target.z, k);
      const dy = r.targetYaw - b.yaw;
      b.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
      b.baseY = standY(p.x, p.z);
      // 남의 발걸음은 이동 거리로 센다(걷기 위상은 내 것만 쓴다)
      r.splashD += Math.hypot(p.x - r.lastX, p.z - r.lastZ);
      r.lastX = p.x; r.lastZ = p.z;
      if (r.splashD > 0.45) { r.splashD = 0; if (r.moving) this.splashAt(b); }
      if (b.state === "pray" && performance.now() > r.prayUntil) b.state = "idle";
      b.carrying = holders.has(id);
      animateBlob(b, dt, r.moving);
    }
  }

  private holderBlob(id: string | null) {
    if (id === this.net.uid) return this.me;
    return id ? this.remotes.get(id)?.blob ?? null : null;
  }

  private updateStones(dt: number) {
    for (const [id, v] of this.stones) {
      const m = v.mesh;
      if (v.dying) {
        v.grow -= dt * 3;
        if (v.grow <= 0) { this.root.remove(m); this.stones.delete(id); continue; }
      } else if (v.grow < 1) v.grow = Math.min(1, v.grow + dt * 2.5);
      const s = v.grow * (2 - v.grow);
      m.scale.set(v.row.radius * 2 * s, v.row.height * s, v.row.radius * 2 * s);

      if (v.row.state === "held") {
        const b = this.holderBlob(v.row.holder_id);
        m.visible = !!b && b.g.visible;
        if (b) {
          const hp = b.holdPoint.clone().applyAxisAngle(UP, b.yaw).add(b.g.position);
          hp.y += v.row.height / 2;
          m.position.lerp(hp, 0.35);
        }
        continue;
      }
      m.visible = true;
      if (v.from) {
        v.t = Math.min(1, v.t + dt / v.dur);
        const e = v.t * (2 - v.t);
        m.position.lerpVectors(v.from, v.to, e);
        m.position.y += Math.sin(v.t * Math.PI) * v.arc;
        if (v.t >= 1) {
          v.from = null;
          if (v.landSound) { v.landSound = false; playDrop(); }
        }
      } else if (m.position.distanceToSquared(v.to) > 1e-6) {
        m.position.copy(v.to);
      }
    }
  }

  private labelT = 0;
  private labelScale = 1;
  hover: { x: number; y: number } | null = null; // PC 마우스 위치(-1~1). 그 아래 「…」 푯말은 내용을 펼친다
  private hovered: TowerView | null = null;
  private hoverLost = 0; // 마우스가 펼친 푯말을 벗어난 뒤 흐른 시간(초). 잠깐 벗어난 것은 무시한다

  // 마우스 아래에 보이는 푯말이 있는 탑. 펼쳐진 푯말은 더 크므로 마우스가 그 안에 있는 동안 유지된다
  private hoverTower(): TowerView | null {
    if (!this.hover || this.inputLocked || this.camMode !== 0) return null;
    this.ray.setFromCamera(new THREE.Vector2(this.hover.x, this.hover.y), this.camera);
    let best: TowerView | null = null, bestD = Infinity;
    // 단계가 바뀌며 잠깐 투명해진 푯말도 센다. 그러지 않으면 펼치는 순간 놓쳐 접혔다 펼쳤다 반복한다
    for (const t of this.towers.values()) {
      if (!t.shown) continue;
      const hit = this.ray.intersectObject(t.label.sprite)[0];
      if (hit?.uv && hit.distance < bestD && t.label.contains(hit.uv, t === this.hovered ? HOVER_PAD : 0)) { best = t; bestD = hit.distance; }
    }
    return best;
  }
  private updateTowers(dt: number) {
    const now = Date.now();
    const p = this.me.g.position;
    // 펼친 푯말에서 마우스가 벗어나도 HOVER_GRACE 동안은 그대로 둔다
    const h = this.hoverTower();
    if (h || !this.hovered || !this.hover) { this.hovered = h; this.hoverLost = 0; }
    else if ((this.hoverLost += dt) > HOVER_GRACE) { this.hovered = null; this.hoverLost = 0; }
    // 내용을 펼치는 탑은 가까운 탑 하나와 마우스를 올린 탑뿐이다. 이미 펼친 탑은 조금 더 멀어질 때까지 유지한다
    let open: TowerView | null = null, openD = Infinity;
    for (const t of this.towers.values()) {
      const d = Math.hypot(t.row.x - p.x, t.row.z - p.z);
      // 이미 펼친 탑은 다른 탑이 OPEN_SWITCH만큼 더 가까워야 바꾼다. 두 탑 사이에서 번갈아 펼쳐지지 않게 한다
      const dd = t.stage === 2 && t !== this.hovered ? d - OPEN_SWITCH : d;
      if (d < (t.stage === 2 ? LABEL_NEAR_OUT : LABEL_NEAR) && dd < openD) { open = t; openD = dd; }
    }
    for (const t of this.towers.values()) {
      const mine = t.row.owner_id === this.net.uid;
      const dist = Math.hypot(t.row.x - p.x, t.row.z - p.z);
      t.stage = t === open || (t === this.hovered && t.stage) ? 2 : dist < (t.stage ? LABEL_FAR_OUT : LABEL_FAR) ? 1 : 0;
      // 모습이 바뀌면 곧바로 새 모습으로 바꾸고 살짝 커지며 또렷해진다. 사라질 때만 짧게 흐려진다
      let grow = 1;
      if (t.stage === 0) {
        if (t.shown) {
          if (t.pop >= 0) { t.popFrom = t.alpha; t.pop = 0; } // 사라지기 시작한 때의 진하기에서 출발한다(pop이 음수면 사라지는 중)
          t.pop = Math.max(-1, t.pop - dt / LABEL_HIDE);
          const e = -t.pop, k = e * e * (3 - 2 * e); // 천천히 시작해 천천히 끝난다
          t.alpha = t.popFrom * (1 - k);
          grow = 1 - 0.04 * k;
          if (t.pop <= -1) { t.alpha = 0; t.shown = 0; }
        }
      } else {
        if (t.shown !== t.stage) { t.popFrom = t.shown ? Math.min(t.alpha, 0.6) : 0; t.shown = t.stage; t.pop = 0; }
        else if (t.pop < 0) { t.popFrom = t.alpha; t.pop = 0; } // 사라지다 다시 가까워지면 지금 진하기에서 다시 또렷해진다
        t.pop = Math.min(1, t.pop + dt / LABEL_POP);
        const e = 1 - (1 - t.pop) ** 3; // 처음엔 빠르고 끝에서 부드럽게 멈춘다
        t.alpha = t.popFrom + (1 - t.popFrom) * e;
        grow = 0.95 + 0.05 * e;
      }
      t.label.setOpacity(t.alpha);
      t.label.setSize(t.labelK * this.labelScale * grow);
      t.label.sprite.position.set(t.row.x, t.top + 0.3, t.row.z);
      if (!t.shown) continue;
      if (t.shown === 1) { t.label.setBrief(mine); continue; }
      const left = Date.parse(t.row.expires_at) - now;
      const life = left > 0 ? formatLife(left) : "곧 사라져요";
      // 초마다 바뀌므로 보이는 라벨만 다시 그린다
      t.label.set(t.row.owner_name, t.row.wish, t.row.wish ? life : `${this.towerName(t.row)} · ${life}`, left < 10 * 60000, mine);
    }

    // 내 첫돌 표시: 멀리서도 보이는 빛기둥과, 돌을 들었을 때 쌓이는 범위
    const mine = this.myTower;
    this.beacon.visible = !!mine;
    if (mine) {
      // 멀수록 굵게 해서 화면에서 일정한 굵기로 보이게 하고, 가까우면 돌탑을 가리지 않게 옅게 한다
      const camDist = Math.hypot(mine.row.x - this.camera.position.x, mine.row.z - this.camera.position.z);
      const width = Math.max(0.5, camDist * 0.022) * (1 + Math.sin(now * 0.003) * 0.12);
      const shaft = this.beacon.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      this.beacon.position.set(mine.row.x, groundAt(mine.row.x, mine.row.z), mine.row.z);
      shaft.scale.set(width, 1, width);
      shaft.material.uniforms.nearFade.value = clamp(camDist / 14, 0.4, 1);
      if (this.ringFor !== mine.row.id) this.buildRing(mine.row);
    } else if (this.ring) {
      this.root.remove(this.ring); this.ring = null; this.ringFor = null;
    }
    if (this.ring) this.ring.visible = !!this.myHeld;
  }

  private towerName(t: TowerRow) {
    if (t.owner_id === this.net.uid) return "내 탑";
    return t.owner_id ? `${t.owner_name}의 탑` : `${t.owner_name}의 소원`;
  }

  private buildRing(t: TowerRow) {
    if (this.ring) this.root.remove(this.ring);
    this.ring = makeGroundRing(t.x, t.z, STACK_RADIUS);
    this.ringFor = t.id;
    this.root.add(this.ring);
  }

  private updateFloaters(dt: number) {
    this.floaters = this.floaters.filter((f) => {
      f.t += dt / 1.8;
      f.sprite.position.y += dt * 0.7;
      f.sprite.material.opacity = 1 - f.t * f.t;
      if (f.t < 1) return true;
      this.root.remove(f.sprite);
      f.sprite.material.map?.dispose();
      f.sprite.material.dispose();
      return false;
    });
  }

  private updateCamera(dt: number) {
    const p = this.me.g.position.clone();
    if (isReaction(this.me.state)) p.y = this.me.baseY; // 앉거나 뛰어도 카메라는 지면 높이를 본다
    // 가로 화면은 그대로, 세로로 좁아질수록 조금씩 더 뒤로 뺀다(정사각형 1, 휴대폰 세로 약 PORTRAIT_PULL)
    const pull = lerp(1, PORTRAIT_PULL, clamp((1 - this.camera.aspect) / 0.55, 0, 1)), dist = this.orbitDist * pull;
    // 시야각을 넓히고 카메라를 뒤로 뺀 만큼 푯말을 키워, 화면에서는 예전(시야각 42°, 그 거리)과 같은 크기로 보이게 한다
    this.labelScale = (pull * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.tan((42 * Math.PI) / 360);
    const want = this.camMode === 0
      ? new THREE.Vector3(
          Math.sin(this.orbitYaw) * dist * Math.cos(this.orbitPitch),
          dist * Math.sin(this.orbitPitch) + 0.8,
          Math.cos(this.orbitYaw) * dist * Math.cos(this.orbitPitch),
        ).add(p)
      : new THREE.Vector3(p.x, p.y + 16, p.z + 4);
    want.y = Math.max(want.y, terrainY(want.x, want.z) + 1.2);
    const k = 1 - Math.pow(0.001, dt);
    this.camPos.lerp(want, k);
    this.camera.position.copy(this.camPos);
    this.camLook.lerp(new THREE.Vector3(p.x, p.y + 1.2, p.z), k);
    this.camera.lookAt(this.camLook);
    seeThrough.set(this.camLook);
    this.updateFog(dt);
    this.updateFov();
    this.skyline.update(this.camera);
  }

  private updateFov() {
    const cam = this.camera, rad = Math.PI / 180;
    const need = (2 * Math.atan(Math.tan((FOV_WIDE / 2) * rad) / cam.aspect)) / rad;
    const fov = Math.round(clamp(need, FOV_MIN, FOV_MAX) * 10) / 10;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  // 높이 올라갈수록 안개를 걷어 동산 꼭대기에서 마을 끝까지 보이게 한다. 보통 땅은 3.5m 아래다
  private updateFog(dt: number) {
    const t = clamp((this.me.baseY - 3.5) / (HILL.topY - 3.5), 0, 1), want = t * t * (3 - 2 * t);
    this.fogK += (want - this.fogK) * (1 - Math.exp(-dt * 1.2));
    if (Math.abs(this.fogK - want) < 1e-4) this.fogK = want;
    const fog = this.scene.fog as THREE.Fog, k = this.fogK;
    fog.near = lerp(FOG_GROUND[0], FOG_TOP[0], k);
    fog.far = lerp(FOG_GROUND[1], FOG_TOP[1], k);
    const far = lerp(FOG_GROUND[2], FOG_TOP[2], k);
    if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
  }

  private sendPoseNow() {
    const p = this.me.g.position, r = isReaction(this.me.state) ? this.me.state : undefined;
    this.net.sendPose({ x: round2(p.x), z: round2(p.z), yaw: round2(this.me.yaw), m: this.movingNow, ...(r && { r }) });
    this.lastSent = { x: p.x, z: p.z, yaw: this.me.yaw, r };
    this.poseT = 0;
    this.keepT = 0;
  }

  // 움직일 때 8Hz, 가만히 있으면 3초마다. 뒤늦게 들어온 사람도 위치를 알 수 있게
  private wasMoving = false;
  private updatePoseSend(dt: number) {
    this.poseT += dt;
    this.keepT += dt;
    if (!this.online) return;
    const p = this.me.g.position, s = this.lastSent;
    const changed = Math.abs(p.x - s.x) + Math.abs(p.z - s.z) > 0.02 || Math.abs(this.me.yaw - s.yaw) > 0.05;
    const stopped = this.wasMoving && !this.movingNow;
    // 리액션이 시간이 다 되거나 이동·줍기·합장으로 끝난 순간도 바로 알린다
    const reactionChanged = (isReaction(this.me.state) ? this.me.state : undefined) !== s.r;
    if ((changed && this.poseT >= 0.125) || stopped || reactionChanged || this.keepT >= 3) this.sendPoseNow();
    this.wasMoving = this.movingNow;
  }

  // 화면 위 "내 탑 N m" 표시. 화면 밖이면 가장자리에 붙는다
  placeMarker(el: HTMLElement, w: number, h: number) {
    const mine = this.myTower;
    if (!mine) { el.style.display = "none"; return; }
    const p = this.me.g.position;
    const dist = Math.hypot(mine.row.x - p.x, mine.row.z - p.z);
    if (dist < 6) { el.style.display = "none"; return; }
    const v = new THREE.Vector3(mine.row.x, mine.top + 1.2, mine.row.z).project(this.camera);
    const behind = v.z > 1;
    let nx = behind ? -v.x : v.x, ny = behind ? -v.y : v.y;
    const off = behind || Math.abs(nx) > 0.9 || Math.abs(ny) > 0.82;
    if (off) {
      const s = Math.max(Math.abs(nx) / 0.9, Math.abs(ny) / 0.82, 0.0001);
      nx /= s; ny /= s;
    }
    el.style.display = "flex";
    el.style.transform = `translate(calc(${((nx + 1) / 2) * w}px - 50%), calc(${((1 - ny) / 2) * h}px - 50%))`;
    const arrow = el.firstElementChild as HTMLElement;
    arrow.style.display = off ? "inline-block" : "none";
    if (off) arrow.style.transform = `rotate(${Math.atan2(nx, ny)}rad)`;
    (el.lastElementChild as HTMLElement).textContent = `내 탑 ${Math.round(dist)}m`;
  }

  hud(): HudState {
    const mine = this.myTower;
    const kind = this.dropKind();
    const near = this.nearestTower(PRAY_RANGE);
    const redoFirst = !kind && this.pickTarget?.row.state === "stacked";
    const stone = !kind && this.pickTarget?.row.state === "ground";
    const prompt =
      kind === "first" ? "여기에 첫돌 놓기 (E)"
      : kind === "stack" ? "내 탑에 쌓기 (E)"
      : kind === "discard" ? "여기서 놓으면 버려져요 (E)"
      : kind === "blocked" ? "다른 탑과 너무 가까워요 (E)"
      : redoFirst ? "첫 돌 다시 들기 (E)"
      : stone ? "돌 줍기 (E)"
      : near ? `${this.towerName(near.row)}에 합장하기 (Q)`
      : "";
    const action = kind ?? (redoFirst || stone ? "pick" : near ? "pray" : null);
    return {
      online: this.online, people: this.people, towers: this.towers.size,
      myStones: mine ? this.towerStoneCount(mine.row.id) : 0,
      myMinutes: mine ? Math.ceil((Date.parse(mine.row.expires_at) - Date.now()) / 60000) : null,
      myLife: mine ? formatLife(Date.parse(mine.row.expires_at) - Date.now()) : "",
      wishPrompt: this.wishPrompt, firstStoneAsk: this.firstStoneAsk, dropAsk: !!this.dropAsk,
      carrying: !!this.myHeld, prompt, action, dropKind: kind,
      canPray: !!near, prayWait: near ? Math.ceil(this.prayWait(near.row.id) / 60000) : 0,
      canWish: this.canWishHere, cam: CAMS[this.camMode],
      toastId: this.toastId, toast: this.toastMsg,
    };
  }

  debugState() {
    const p = this.me.g.position;
    return {
      me: { x: p.x, z: p.z, state: this.me.state, prayK: this.me.prayK },
      stones: [...this.stones.values()].map((v) => ({ ...v.row, wy: v.mesh.position.y })),
      towers: [...this.towers.values()].map((t) => t.row),
      remotes: [...this.remotes.entries()].map(([id, r]) => ({ id, x: r.blob.g.position.x, z: r.blob.g.position.z, seen: r.seen })),
      hud: this.hud(),
    };
  }
  debugTeleport(x: number, z: number) {
    this.pickTarget = null;
    this.walkTo = null;
    this.me.g.position.set(x, 0, z);
  }

  // 좌표 오버레이용: 발이 딛는 높이(y)와 함께
  get coords() {
    const p = this.me.g.position;
    return { x: p.x, y: this.me.baseY, z: p.z };
  }

  get spot(): PlayerSpot {
    const p = this.me.g.position;
    return { x: p.x, z: p.z, yaw: this.me.yaw };
  }

  dispose() {
    stopSound();
    this.glow.dispose();
    this.petals.dispose();
    this.splash.dispose();
    this.ripple.dispose();
    this.skyline.dispose();
    this.fireflies.dispose();
    this.net.stop();
    this.scene.remove(this.root);
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
// 네트워크 입력도 거치므로 unknown을 받는다
const isReaction = (v: unknown): v is Reaction => (REACTIONS as readonly unknown[]).includes(v);

// 캐릭터가 딛는 높이: 계단 디딤판과 얕은 물은 walkY가 정하고, 그 밖에는 눈에 보이는 땅을 딛는다
function standY(x: number, z: number) {
  const w = walkY(x, z);
  return w === terrainY(x, z) - stairDip(x, z) ? groundAt(x, z) : w;
}

// 지형 함수로는 땅인데 눈에 보이는 땅(메시)은 물 밑으로 꺼진 곳. 돌다리 옆면처럼 높이가 뚝 떨어지는 곳에서
// 메시 격자(0.72m)가 그 사이를 비탈로 이어 생긴다. 여기 서면 물에 빠져 보이므로 들어가지 않고 돌도 놓지 않는다
const sunken = (x: number, z: number) => !isWater(x, z) && groundAt(x, z) < WATER_Y - 0.05;

const SLIDE_STEP = Math.PI / 24; // 막히면 7.5°씩 돌려 가며 비켜 갈 방향을 찾는다

// dir 방향으로 dist만큼 움직이고, 실제로 움직인 거리를 돌려준다.
// 막히면 벽을 따라 미끄러진다: 방향을 조금씩 돌리고, 돌린 만큼(cos) 덜 간다. 정면으로 부딪히면 거의 0이다
function stepOnLand(p: THREE.Vector3, dir: THREE.Vector3, dist: number) {
  const a0 = Math.atan2(dir.x, dir.z);
  for (let k = 0; k < 11; k++) { // 75°까지만: 그보다 꺾이면 벽을 정면으로 민 것으로 보고 멈춘다
    const d = dist * Math.cos(k * SLIDE_STEP);
    for (const s of k ? [1, -1] : [1]) {
      const a = a0 + s * k * SLIDE_STEP, nx = p.x + Math.sin(a) * d, nz = p.z + Math.cos(a) * d;
      if (blocked(nx, nz)) continue;
      if (sunken(nx, nz) && standY(nx, nz) <= standY(p.x, p.z)) continue; // 꺼진 곳으로는 못 들어가고(얕은 물에서도), 이미 빠져 있으면 올라오는 쪽으로만 간다
      p.x = nx; p.z = nz;
      return d;
    }
  }
  return 0;
}

// 위로 갈수록 옅어지는 빛기둥. 가장자리가 부드럽고 안개를 무시해 맵 반대편에서도 보인다
function makeBeacon() {
  const H = 60;
  const geo = new THREE.CylinderGeometry(1, 1, H, 24, 1, true);
  geo.translate(0, H / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { nearFade: { value: 1 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vH = position.y / ${H.toFixed(1)};
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float nearFade;
      varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.5);
        float fade = pow(1.0 - vH, 1.6) * smoothstep(0.0, 0.015, vH);
        vec3 color = mix(vec3(1.0, 0.56, 0.42), vec3(1.0, 0.95, 0.84), core * core);
        gl_FragColor = vec4(color, core * fade * 0.85 * nearFade);
      }`,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  return group;
}

// 지형을 따라가는 고리: 이 안에 돌을 떨구면 쌓인다
function makeGroundRing(cx: number, cz: number, radius: number) {
  const seg = 72, width = 0.09;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const r of [radius - width, radius + width]) {
      const x = cx + c * r, z = cz + s * r;
      pos.push(x, groundAt(x, z) + 0.05, z);
    }
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#ff8f70", transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
}
