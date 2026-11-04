import * as THREE from "three";
import type { CharacterRow, DropResult, NetEvents, Pose, StoneRow, TowerRow } from "./net";
import { Net } from "./net";
import { formatLife, MAX_STONES, PICK_RANGE, PRAY_COOLDOWN_MS, PRAY_RANGE, STACK_RADIUS, TOWER_GAP, WISH_AT } from "./rules";
import { playDrop, playPick, playStep, setWaterDistance, stopSound, stopStep } from "./sound";
import { WORLD, clamp, isWater, lerp, terrainY, waterDistance } from "./terrain";
import { type Blob, REACTIONS, REACTION_SECONDS, type Reaction, animateBlob, makeBlob } from "./three/blob";
import { TowerLabel, floatingText } from "./three/label";
import { makeStoneMesh } from "./three/stone";
import { buildWorld } from "./three/world";

export type HudState = {
  online: boolean; people: number; towers: number;
  myStones: number; myMinutes: number | null; myLife: string; myWish: string | null;
  carrying: boolean; prompt: string; action: "first" | "stack" | "discard" | "blocked" | "pick" | "pray" | null; dropKind: "first" | "stack" | "discard" | "blocked" | null;
  canPray: boolean; prayWait: number; canWish: boolean; cam: string; toastId: number; toast: string;
};

type StoneView = {
  row: StoneRow; mesh: THREE.Mesh;
  from: THREE.Vector3 | null; to: THREE.Vector3; t: number; dur: number; arc: number;
  grow: number; dying: boolean; landSound?: boolean;
};
type TowerView = { row: TowerRow; label: TowerLabel; top: number };
type Remote = { blob: Blob; target: THREE.Vector3; targetYaw: number; moving: boolean; seen: boolean; prayUntil: number };
type Floater = { sprite: THREE.Sprite; t: number };

const CAMS = ["따라가기", "하늘에서"];
const SUN_OFF = new THREE.Vector3(8, 14, 6);
const UP = new THREE.Vector3(0, 1, 0);
const LABEL_RANGE = 10; // 남의 탑 푯말은 이 거리 안에서만 보인다. 내 탑은 항상 보인다

// 다시 빚기를 취소하고 돌아올 자리
export type PlayerSpot = { x: number; z: number; yaw: number };

export class Game {
  readonly net: Net;
  private root = new THREE.Group();
  private sun: THREE.DirectionalLight;
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
  private waterT = 0;
  private lastContact = 0;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    netFactory: (ev: NetEvents) => Net,
    meRow: CharacterRow,
    private font: string,
    start?: PlayerSpot,
  ) {
    scene.background = new THREE.Color("#d9e3ef");
    scene.fog = new THREE.Fog("#d9e3ef", 48, 150);
    scene.add(this.root);
    this.root.add(new THREE.HemisphereLight("#f3ecdf", "#b9c9b4", 1.6));
    this.sun = new THREE.DirectionalLight("#ffe9c9", 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -24; sc.right = sc.top = 24; sc.far = 60;
    this.sun.shadow.bias = -0.0008;
    this.root.add(this.sun, this.sun.target);
    buildWorld(this.root);

    this.me = this.makeAvatar(meRow);
    const a = Math.random() * Math.PI * 2;
    this.me.g.position.set(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5);
    if (start) {
      this.me.g.position.set(start.x, 0, start.z);
      this.me.yaw = start.yaw;
    }
    this.me.baseY = terrainY(this.me.g.position.x, this.me.g.position.z);

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
      mesh.position.set(row.x, terrainY(row.x, row.z) + row.height / 2, row.z);
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
      const to = new THREE.Vector3(row.x, terrainY(row.x, row.z) + row.height / 2, row.z);
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
    let y = terrainY(list[0].row.x, list[0].row.z);
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
      t = { row, label, top: terrainY(row.x, row.z) };
      this.towers.set(row.id, t);
      this.restack(row.id);
    }
    t.row = row;
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
        this.remotes.set(id, { blob, target: new THREE.Vector3(), targetYaw: 0, moving: false, seen: false, prayUntil: 0 });
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
  private nearestGround(rad: number) {
    let best: StoneView | null = null, bd = rad;
    const p = this.me.g.position;
    for (const v of this.stones.values()) {
      if (v.row.state !== "ground" || v.dying) continue;
      const d = Math.hypot(v.row.x - p.x, v.row.z - p.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
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
    return !isWater(x, z) && Math.hypot(x, z) < WORLD ? { x, z } : { x: p.x, z: p.z };
  }
  private dropKind(): HudState["dropKind"] {
    if (!this.myHeld) return null;
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
  setKey(code: string, down: boolean) { this.keys[code] = down; }
  releaseKeys() { this.keys = {}; this.joy = { x: 0, y: 0 }; }
  orbit(dx: number, dy: number) {
    this.orbitYaw -= dx * 0.006;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, 0.12, 1.4);
  }
  zoom(d: number) { this.orbitDist = clamp(this.orbitDist + d * 0.01, 3, 18); }
  cycleCam() {
    this.camMode = (this.camMode + 1) % CAMS.length;
    this.toast(`카메라: ${CAMS[this.camMode]}`);
  }
  toast(msg: string) { this.toastMsg = msg; this.toastId++; }

  react(kind: Reaction) {
    if (this.inputLocked) return;
    if (this.myHeld) { this.toast("돌을 내려놓고 할 수 있어요"); return; }
    const s = this.me.state;
    if (this.busy || s === "pickup" || s === "place" || s === "pray") return;
    this.me.state = kind; this.me.stateT = 0;
    this.sendPoseNow();
  }

  async action() {
    if (this.busy || this.me.state === "pickup" || this.me.state === "place") return;
    this.busy = true;
    try {
      const held = this.myHeld;
      if (held) await this.drop(held);
      else await this.pick();
    } finally {
      this.busy = false;
    }
  }

  private async pick() {
    const s = this.nearestGround(PICK_RANGE);
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

  private async drop(held: StoneView) {
    const { x, z } = this.dropPoint();
    this.me.state = "place"; this.me.stateT = 0;
    const r = await this.net.dropStone(held.row.id, x, z);
    this.onDropResult(r);
  }

  private onDropResult(r: DropResult) {
    const msg: Record<DropResult["result"], string> = {
      first: "첫돌을 놓았어요! 빛기둥이 내 탑을 알려줘요",
      stacked: (r.count ?? 0) >= WISH_AT && !this.myTower?.row.wish ? `${r.count}단! 소원을 적을 수 있어요 (F)` : `${r.count}단!`,
      collapsed: "와르르… 탑이 무너져 소원도 사라졌어요",
      discarded: "돌을 버렸어요. 첫돌 근처에 놓아야 쌓여요",
      too_close: "다른 탑과 너무 가까워요. 돌은 바닥에 놓였어요",
      full: `탑은 ${MAX_STONES}단까지예요. 돌은 바닥에 놓였어요`,
      rejected: "돌을 내려놓지 못했어요",
    };
    this.toast(msg[r.result]);
  }

  async prayAction() {
    if (this.busy || this.me.state === "pray") return;
    const t = this.nearestTower(PRAY_RANGE);
    if (!t) { this.toast("탑 가까이에서 합장할 수 있어요"); return; }
    const wait = this.prayWait(t.row.id);
    if (wait > 0) { this.toast(`이 탑에는 ${Math.ceil(wait / 60000)}분 뒤 다시 기도할 수 있어요`); return; }
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
      this.toast(r.reason === "cooldown" ? "이 탑에는 조금 뒤 다시 기도할 수 있어요" : "기도하지 못했어요");
    }
  }

  get canWishHere() {
    const t = this.myTower;
    return !!t && this.towerStoneCount(t.row.id) >= WISH_AT;
  }
  get currentWish() { return this.myTower?.row.wish ?? ""; }

  // ───────── 프레임 ─────────
  update(dt: number) {
    this.updatePlayer(dt);
    this.updateRemotes(dt);
    this.updateStones(dt);
    this.updateTowers();
    this.updateFloaters(dt);
    this.updateCamera(dt);
    this.updatePoseSend(dt);
    const p = this.me.g.position;
    this.sun.position.copy(p).add(SUN_OFF);
    this.sun.target.position.copy(p);
    this.sun.target.updateMatrixWorld();
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
    if (wantsMove && isReaction(me.state)) me.state = "idle";
    if (wantsMove && me.state === "idle") {
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, UP);
      const dir = right.multiplyScalar(ix).addScaledVector(fwd, -iz);
      stepOnLand(me.g.position, dir, (me.carrying ? 3 : 4) * dt);
      const dy = Math.atan2(dir.x, dir.z) - me.yaw;
      me.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * Math.min(1, dt * 12);
      moving = true;
    }
    me.baseY = terrainY(me.g.position.x, me.g.position.z);
    animateBlob(me, dt, moving);
    // 발이 땅에 닿는 순간(걷기 위상이 π의 배수를 지날 때) 발소리를 낸다
    const contact = Math.floor(me.walk / Math.PI);
    if (moving && contact !== this.lastContact) playStep();
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
      b.baseY = terrainY(p.x, p.z);
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
  private updateTowers() {
    const now = Date.now();
    const p = this.me.g.position;
    for (const t of this.towers.values()) {
      const mine = t.row.owner_id === this.net.uid;
      const dist = Math.hypot(t.row.x - p.x, t.row.z - p.z);
      t.label.sprite.visible = mine || dist < LABEL_RANGE;
      t.label.sprite.position.set(t.row.x, t.top + 0.3, t.row.z);
      const left = Date.parse(t.row.expires_at) - now;
      const name = mine ? "내 탑" : `${t.row.owner_name}의 탑`;
      // 초마다 바뀌므로 보이는 라벨만 다시 그린다
      if (t.label.sprite.visible) t.label.set(t.row.wish, left > 0 ? `${name} · ${formatLife(left)}` : `${name} · 곧 사라져요`, left < 10 * 60000, mine);
    }

    // 내 첫돌 표시: 멀리서도 보이는 빛기둥과, 돌을 들었을 때 쌓이는 범위
    const mine = this.myTower;
    this.beacon.visible = !!mine;
    if (mine) {
      // 멀수록 굵게 해서 화면에서 일정한 굵기로 보이게 하고, 가까우면 돌탑을 가리지 않게 옅게 한다
      const camDist = Math.hypot(mine.row.x - this.camera.position.x, mine.row.z - this.camera.position.z);
      const width = Math.max(0.5, camDist * 0.022) * (1 + Math.sin(now * 0.003) * 0.12);
      const shaft = this.beacon.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      this.beacon.position.set(mine.row.x, terrainY(mine.row.x, mine.row.z), mine.row.z);
      shaft.scale.set(width, 1, width);
      shaft.material.uniforms.nearFade.value = clamp(camDist / 14, 0.4, 1);
      if (this.ringFor !== mine.row.id) this.buildRing(mine.row);
    } else if (this.ring) {
      this.root.remove(this.ring); this.ring = null; this.ringFor = null;
    }
    if (this.ring) this.ring.visible = !!this.myHeld;
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
    const want = this.camMode === 0
      ? new THREE.Vector3(
          Math.sin(this.orbitYaw) * this.orbitDist * Math.cos(this.orbitPitch),
          this.orbitDist * Math.sin(this.orbitPitch) + 0.8,
          Math.cos(this.orbitYaw) * this.orbitDist * Math.cos(this.orbitPitch),
        ).add(p)
      : new THREE.Vector3(p.x, p.y + 16, p.z + 4);
    want.y = Math.max(want.y, terrainY(want.x, want.z) + 1.2);
    const k = 1 - Math.pow(0.001, dt);
    this.camPos.lerp(want, k);
    this.camera.position.copy(this.camPos);
    this.camLook.lerp(new THREE.Vector3(p.x, p.y + 1.2, p.z), k);
    this.camera.lookAt(this.camLook);
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
    const stone = !kind && this.nearestGround(PICK_RANGE);
    const prompt =
      kind === "first" ? "여기에 첫돌 놓기 (E)"
      : kind === "stack" ? "내 탑에 쌓기 (E)"
      : kind === "discard" ? "여기서 놓으면 버려져요 (E)"
      : kind === "blocked" ? "다른 탑과 너무 가까워요 (E)"
      : stone ? "돌 줍기 (E)"
      : near ? `${near.row.owner_id === this.net.uid ? "내 탑" : near.row.owner_name + "의 탑"}에 합장하기 (Q)`
      : "";
    const action = kind ?? (stone ? "pick" : near ? "pray" : null);
    return {
      online: this.online, people: this.people, towers: this.towers.size,
      myStones: mine ? this.towerStoneCount(mine.row.id) : 0,
      myMinutes: mine ? Math.ceil((Date.parse(mine.row.expires_at) - Date.now()) / 60000) : null,
      myLife: mine ? formatLife(Date.parse(mine.row.expires_at) - Date.now()) : "",
      myWish: mine?.row.wish ?? null,
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
    this.me.g.position.set(x, 0, z);
  }

  get spot(): PlayerSpot {
    const p = this.me.g.position;
    return { x: p.x, z: p.z, yaw: this.me.yaw };
  }

  dispose() {
    stopSound();
    this.net.stop();
    this.scene.remove(this.root);
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
// 네트워크 입력도 거치므로 unknown을 받는다
const isReaction = (v: unknown): v is Reaction => (REACTIONS as readonly unknown[]).includes(v);

function stepOnLand(p: THREE.Vector3, dir: THREE.Vector3, dist: number) {
  const tryMove = (dx: number, dz: number) => {
    const nx = p.x + dx, nz = p.z + dz;
    if (Math.hypot(nx, nz) > WORLD || isWater(nx, nz)) return false;
    p.x = nx; p.z = nz;
    return true;
  };
  return tryMove(dir.x * dist, dir.z * dist) || tryMove(dir.x * dist, 0) || tryMove(0, dir.z * dist);
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
      pos.push(x, terrainY(x, z) + 0.05, z);
    }
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#ff8f70", transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
}
