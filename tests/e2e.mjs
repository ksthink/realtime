// 실제 브라우저 한 명과, 같은 실시간 프로토콜을 쓰는 Node 접속자 한 명으로 멀티플레이를 확인한다.
// (GPU 없는 서버에서 브라우저 둘을 렌더링하기엔 무거워서)
// 실행: NODE_OPTIONS=--experimental-websocket node --env-file=.env.local tests/e2e.mjs <base url> <스크린샷 폴더>
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const [base = "http://localhost:3100", out = "."] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1000, height: 562 } });
ctx.setDefaultTimeout(120000);
const a = await ctx.newPage();
a.on("pageerror", (e) => errors.push(e.message));
a.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// ── 입장: 인트로 → 빚기 → 저장 → 게임 ──
await a.goto(`${base}/?debug`, { waitUntil: "domcontentloaded" });
await a.getByRole("button", { name: "입장" }).click();
await a.getByPlaceholder("예: 감자").fill("감자");
await a.mouse.move(500, 281); await a.mouse.down(); await a.mouse.move(640, 230, { steps: 8 }); await a.mouse.up();
await a.waitForTimeout(600);
await a.screenshot({ path: `${out}/1-sculpt.png` });
await a.getByRole("button", { name: "입장" }).click();
await a.waitForFunction(() => window.__doltap?.debugState().stones.length > 100, null, { timeout: 180000 });
const state = () => a.evaluate(() => window.__doltap.debugState());
const until = (fn, arg) => a.waitForFunction(fn, arg, { timeout: 60000, polling: 300 });
console.log("ok 입장과 돌 로드", (await state()).stones.length);

// ── 다른 접속자 ──
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: signed } = await db.auth.signInAnonymously();
const peerId = signed.user.id;
const myId = await a.evaluate(() => window.__doltap.net.uid);
const { data: mine } = await db.from("characters").select("seed,top_color,bottom_color,body").eq("user_id", myId).single();
assert.ifError((await db.from("characters").upsert({ user_id: peerId, name: "호두", ...mine })).error);

const poses = [];
const peer = db.channel("world", { config: { broadcast: { self: false }, presence: { key: peerId } } });
peer.on("broadcast", { event: "pose" }, ({ payload }) => poses.push(payload)).on("presence", { event: "sync" }, () => {});
await new Promise((res) => peer.subscribe(async (s) => { if (s === "SUBSCRIBED") { await peer.track({ name: "호두" }); res(); } }));
const peerPose = (x, z, m = false) => peer.send({ type: "broadcast", event: "pose", payload: { id: peerId, x, z, yaw: 0, m } });

// 서로 보임
const timer = setInterval(() => void peerPose(4, 3), 500);
await until((id) => window.__doltap.debugState().remotes.some((r) => r.id === id && r.seen), peerId);
assert.equal((await state()).hud.people, 2);
console.log("ok 상대 캐릭터 표시, 접속자 2명");
clearInterval(timer);

// 위치 동기화 (양방향)
await peerPose(6, 4);
await until((id) => window.__doltap.debugState().remotes.some((r) => r.id === id && Math.hypot(r.x - 6, r.z - 4) < 0.5), peerId);
await a.evaluate(() => window.__doltap.debugTeleport(5, 3));
await new Promise((r) => setTimeout(r, 4000));
assert.ok(poses.some((p) => p.id === myId && Math.hypot(p.x - 5, p.z - 3) < 0.2), "브라우저 위치가 상대에게 전달되지 않음");
console.log("ok 위치 동기화 양방향");

// ── 돌 조작 ──
const pickNearest = (minR = 0, maxR = 9) => a.evaluate(async ([minR, maxR]) => {
  const g = window.__doltap, s = g.debugState();
  const c = s.stones.filter((x) => x.state === "ground" && x.radius >= minR && x.radius <= maxR)
    .sort((p, q) => Math.hypot(p.x - s.me.x, p.z - s.me.z) - Math.hypot(q.x - s.me.x, q.z - s.me.z))[0];
  g.debugTeleport(c.x + 0.3, c.z);
  // 저사양 렌더링에서는 이전 동작 애니메이션이 늦게 끝난다
  while (g.debugState().me.state !== "idle") await new Promise((r) => setTimeout(r, 100));
  await g.action();
  await new Promise((r) => setTimeout(r, 900));
  return c.id;
}, [minR, maxR]);
const prepDrop = (x, z) => a.evaluate(async ([x, z]) => {
  const g = window.__doltap;
  g.debugTeleport(x, z);
  await new Promise((r) => setTimeout(r, 300));
  return g.hud().dropKind;
}, [x, z]);
const doDrop = () => a.evaluate(async () => { const g = window.__doltap;
  while (g.debugState().me.state !== "idle") await new Promise((r) => setTimeout(r, 100));
  await g.action(); await new Promise((r) => setTimeout(r, 900)); return g.hud().toast; });

const stoneEvents = [];
const watcher = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
await watcher.auth.signInAnonymously();
await new Promise((res) => watcher.channel("watch").on("postgres_changes", { event: "*", schema: "public", table: "towers" }, (e) => stoneEvents.push(e))
  .subscribe((s) => { if (s === "SUBSCRIBED") res(); }));

// 첫돌
await pickNearest(0.4);
assert.equal((await state()).hud.carrying, true);
await a.waitForTimeout(800);
await a.screenshot({ path: `${out}/2-carrying.png` });
assert.equal(await prepDrop(5, 3), "first");
console.log("첫돌:", await doDrop());
await until(() => window.__doltap.debugState().towers.length === 1);
const tower = (await state()).towers[0];
assert.equal(tower.owner_name, "감자");
await new Promise((r) => setTimeout(r, 1000));
assert.ok(stoneEvents.some((e) => e.eventType === "INSERT"), "탑 생성이 다른 접속자에게 전달되지 않음");
console.log("ok 첫돌로 탑 생성, 다른 접속자에게 전파");

// 쌓기: 아래 돌보다 조금 작은 돌을 골라 첫돌 근처에 놓는다. 그래도 무너지면 첫돌부터 다시
const stackUpTo = async (n) => {
  for (let guard = 0; guard < 30; guard++) {
    const st = await state();
    const t = st.towers[0];
    if (!t) {
      await pickNearest(0.4);
      await prepDrop(5, 3);
      console.log("첫돌:", await doDrop());
      await until(() => window.__doltap.debugState().towers.length === 1);
      continue;
    }
    const own = st.stones.filter((x) => x.tower_id === t.id).sort((p, q) => p.order_index - q.order_index);
    if (own.length >= n) return t;
    const top = own[own.length - 1].radius;
    await pickNearest(Math.max(0.2, top - 0.08), top);
    assert.equal(await prepDrop(t.x + 0.1, t.z - 0.8), "stack");
    console.log("쌓기:", await doDrop());
    await a.waitForTimeout(500);
  }
  throw new Error(`${n}단까지 쌓지 못함`);
};
const tower2 = await stackUpTo(4);
tower.x = tower2.x; tower.z = tower2.z;
const cnt = (await state()).hud.myStones;
console.log("현재 단수", cnt);
await a.evaluate(([x, z]) => window.__doltap.debugTeleport(x + 2.5, z + 2.5), [tower.x, tower.z]);
await a.waitForTimeout(1500);
await a.screenshot({ path: `${out}/3-tower.png` });

// 버리기: 멀리서 들고 있으면 안내가 바뀌고, 돌이 바닥에 남는다
const farId = await pickNearest(0, 0.33);
const farKind = await prepDrop(tower.x + 15, tower.z + 1);
assert.ok(["discard"].includes(farKind), farKind);
await a.waitForTimeout(1000);
await a.screenshot({ path: `${out}/4-far-beacon.png` });
console.log("버리기:", await doDrop());
const dropped = (await state()).stones.find((s) => s.id === farId);
assert.equal(dropped.state, "ground");
console.log("ok 첫돌에서 멀면 버려지고 바닥에 남음");

// 상대가 합장 → 내 화면의 수명이 늘고 상대 캐릭터가 합장한다
const live = (await state()).towers[0];
if (live) {
  await a.evaluate(([x, z]) => window.__doltap.debugTeleport(x - 2, z + 1.5), [live.x, live.z]);
  await peerPose(live.x + 1.2, live.z + 1.2);
  const before = Date.parse(live.expires_at);
  const { data: prayed } = await db.rpc("pray", { p_tower: live.id });
  assert.equal(prayed.ok, true);
  await peer.send({ type: "broadcast", event: "pray", payload: { id: peerId, tower: live.id } });
  await until((t) => Date.parse(window.__doltap.debugState().towers[0].expires_at) > t + 3000000, before);
  await a.waitForTimeout(700);
  await a.screenshot({ path: `${out}/5-peer-pray.png` });
  console.log("ok 합장으로 수명 +1시간이 실시간 전파");

  // 내가 합장하고 쿨다운 안내
  await a.evaluate(() => window.__doltap.prayAction());
  await a.waitForTimeout(1200);
  await a.screenshot({ path: `${out}/6-my-pray.png` });
  const k = (await state()).me.prayK;
  assert.ok(k > 0.5, `합장 자세가 아님 ${k}`);
  await until(() => window.__doltap.debugState().me.state === "idle");
  await a.evaluate(() => window.__doltap.prayAction());
  await a.waitForTimeout(300);
  assert.match((await state()).hud.toast, /다시 합장/);
  console.log("ok 합장 자세와 쿨다운");

  // 수명 만료 처리는 tests/rules.test.mjs가 확인한다. 라벨 문구 확인
  assert.ok((await state()).hud.myMinutes >= 1500);
}

// 합장 자세를 정면에서
await a.evaluate(async () => {
  const g = window.__doltap;
  while (g.debugState().me.state !== "idle") await new Promise((r) => setTimeout(r, 100));
  g.me.yaw = 0; g.orbitYaw = 0.35; g.orbitPitch = 0.25; g.orbitDist = 4.5;
  g.me.state = "pray"; g.me.stateT = -60;
});
await a.waitForTimeout(3500);
await a.screenshot({ path: `${out}/7-pray-front.png` });
await a.evaluate(() => { const g = window.__doltap; g.me.state = "idle"; g.me.stateT = 0; g.orbitPitch = 0.55; g.orbitDist = 7.5; });

// 5단까지 쌓고 화면에서 소원을 적는다
const t2 = await stackUpTo(5);
if ((await state()).towers.length) {
  await a.waitForTimeout(600);
  await a.keyboard.press("KeyF");
  await a.getByPlaceholder("예: 올해는 책 100권 읽기").fill("가족 모두 건강하기");
  await a.screenshot({ path: `${out}/8-wish-form.png` });
  await a.getByRole("button", { name: "새기기" }).click();
  await until(() => window.__doltap.debugState().towers[0]?.wish === "가족 모두 건강하기");
  await a.evaluate(([x, z]) => { const g = window.__doltap; g.debugTeleport(x + 2.5, z + 2.5); }, [t2.x, t2.z]);
  await a.waitForTimeout(1500);
  await a.screenshot({ path: `${out}/9-wish-label.png` });
  console.log("ok 소원이 탑에 표시");
}

// 큰 돌을 계속 올려 붕괴시킨다: 탑과 소원이 사라지고 돌은 바닥으로
for (let i = 0; i < 12 && (await state()).towers.length; i++) {
  await pickNearest(0.45);
  await prepDrop(t2.x + 0.1, t2.z - 0.8);
  console.log("큰 돌:", await doDrop());
}
assert.equal((await state()).towers.length, 0, "큰 돌을 올려도 무너지지 않음");
await a.waitForTimeout(1500);
await a.screenshot({ path: `${out}/10-collapsed.png` });
assert.equal((await state()).hud.myStones, 0);
console.log("ok 붕괴로 탑과 소원 삭제");

// 메시지는 5초 뒤 사라진다
await a.evaluate(() => window.__doltap.toast("사라짐 확인"));
await a.waitForSelector(".toast.on");
await a.waitForTimeout(3500);
assert.equal(await a.locator(".toast.on").count(), 1, "5초 전에 사라짐");
await a.waitForTimeout(3500);
assert.equal(await a.locator(".toast.on").count(), 0, "5초 뒤에도 남아 있음");
console.log("ok 메시지 5초 뒤 사라짐");

// 새로고침해도 들고 있던 돌과 탑이 이어진다
await pickNearest(0, 0.33);
await a.reload({ waitUntil: "domcontentloaded" });
await a.getByRole("button", { name: "입장" }).click();
await a.waitForFunction(() => window.__doltap?.debugState().stones.length > 100, null, { timeout: 180000 });
await until(() => window.__doltap.debugState().hud.carrying);
console.log("ok 새로고침 뒤 세션·들고 있던 돌 복원");

console.log("브라우저 오류:", errors.length ? errors : "없음");
await browser.close();
assert.equal(errors.length, 0);
process.exit(0);
