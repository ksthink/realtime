import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Reaction } from "./three/blob";

export type StoneRow = {
  id: string; seed: number; radius: number; height: number;
  state: "ground" | "held" | "stacked";
  holder_id: string | null; tower_id: string | null; order_index: number | null;
  x: number; z: number; expires_at: string | null;
};
export type TowerRow = {
  id: string; owner_id: string | null; owner_name: string; // 소원을 빌면 owner_id가 비고, 이름만 남는다
  x: number; z: number; wish: string | null; expires_at: string;
  pray_count?: number; // 받은 합장 수. 마이그레이션 전 서버에는 없다
};
export type CharacterRow = {
  user_id: string; name: string; seed: number;
  top_color: string; bottom_color: string; body: string;
};
export type Pose = { id: string; x: number; z: number; yaw: number; m: boolean; r?: Reaction };
export type DropResult = { result: "first" | "stacked" | "collapsed" | "discarded" | "too_close" | "full" | "rejected"; count?: number };
export type PrayResult = { ok: boolean; reason?: "gone" | "cooldown" | "auth"; expires_at?: string; prayed_at?: string; extended?: boolean; pray_count?: number };

export type NetEvents = {
  snapshot(stones: StoneRow[], towers: TowerRow[], prayers: { tower_id: string; prayed_at: string }[]): void;
  stone(row: StoneRow): void;
  stoneGone(id: string): void;
  tower(row: TowerRow): void;
  towerGone(id: string): void;
  pose(p: Pose): void;
  prayed(id: string, towerId: string): void;
  presence(ids: string[]): void;
  status(online: boolean): void;
};

// 실시간·저장 통신은 전부 이 파일을 거친다. 위치는 Broadcast(DB 미경유), 돌·탑은 Postgres 변경 이벤트.
export class Net {
  private channel: RealtimeChannel | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private db: SupabaseClient, readonly uid: string, private name: string, private on: NetEvents) {}

  start() {
    const channel = this.db.channel("world", {
      config: { broadcast: { self: false }, presence: { key: this.uid } },
    });
    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "stones" }, (e) => {
        if (e.eventType === "DELETE") this.on.stoneGone((e.old as { id: string }).id);
        else this.on.stone(e.new as StoneRow);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "towers" }, (e) => {
        if (e.eventType === "DELETE") this.on.towerGone((e.old as { id: string }).id);
        else this.on.tower(e.new as TowerRow);
      })
      .on("broadcast", { event: "pose" }, ({ payload }) => this.on.pose(payload as Pose))
      .on("broadcast", { event: "pray" }, ({ payload }) => this.on.prayed(payload.id, payload.tower))
      .on("presence", { event: "sync" }, () => this.on.presence(Object.keys(channel.presenceState())))
      .subscribe(async (status) => {
        this.on.status(status === "SUBSCRIBED");
        if (status !== "SUBSCRIBED") return;
        await channel.track({ name: this.name });
        await this.tick();
        await this.resync(); // 재접속 때도 여기로 온다
        // 아무도 구독하지 않던 채널의 첫 구독자는 구독 직후 잠깐의 변경을 놓칠 수 있어 한 번 더 맞춘다
        setTimeout(() => void this.resync(), 3000);
      });
    this.channel = channel;
    this.timers.push(setInterval(() => void this.tick(), 15_000));
    this.timers.push(setInterval(() => void this.resync(), 60_000)); // 놓친 이벤트 보정
  }

  stop() {
    this.timers.forEach(clearInterval);
    if (this.channel) void this.db.removeChannel(this.channel);
  }

  private async tick() {
    const { error } = await this.db.rpc("world_tick");
    if (error) console.warn("world_tick", error.message);
  }

  async resync() {
    const [stones, towers, prayers] = await Promise.all([
      this.db.from("stones").select("id,seed,radius,height,state,holder_id,tower_id,order_index,x,z,expires_at").limit(1000),
      this.db.from("towers").select("*").limit(1000), // 열 이름을 적지 않아 pray_count 마이그레이션 전 서버에서도 읽힌다
      this.db.from("prayers").select("tower_id,prayed_at").eq("user_id", this.uid),
    ]);
    if (stones.error || towers.error || prayers.error) {
      console.warn("resync", stones.error ?? towers.error ?? prayers.error);
      return;
    }
    this.on.snapshot(stones.data as StoneRow[], towers.data as TowerRow[], prayers.data);
  }

  sendPose(p: Omit<Pose, "id">) {
    void this.channel?.send({ type: "broadcast", event: "pose", payload: { id: this.uid, ...p } });
  }
  sendPray(tower: string) {
    void this.channel?.send({ type: "broadcast", event: "pray", payload: { id: this.uid, tower } });
  }

  async pickStone(id: string) {
    const { data, error } = await this.db.rpc("pick_stone", { p_stone: id });
    if (error) console.warn("pick_stone", error.message);
    return data === true;
  }
  async dropStone(id: string, x: number, z: number): Promise<DropResult> {
    const { data, error } = await this.db.rpc("drop_stone", { p_stone: id, p_x: x, p_z: z });
    if (error) { console.warn("drop_stone", error.message); return { result: "rejected" }; }
    return data as DropResult;
  }
  async pray(tower: string): Promise<PrayResult> {
    const { data, error } = await this.db.rpc("pray", { p_tower: tower });
    if (error) { console.warn("pray", error.message); return { ok: false }; }
    return data as PrayResult;
  }
  async setWish(wish: string) {
    const { data, error } = await this.db.rpc("set_wish", { p_wish: wish });
    if (error) console.warn("set_wish", error.message);
    return data === true;
  }
  async releaseFirstStone() {
    const { data, error } = await this.db.rpc("release_first_stone");
    if (error) console.warn("release_first_stone", error.message);
    return data === true;
  }
  async character(id: string) {
    const { data } = await this.db.from("characters").select("user_id,name,seed,top_color,bottom_color,body").eq("user_id", id).maybeSingle();
    return data as CharacterRow | null;
  }
}
