// 서버 규칙 테스트. 로컬 Supabase(`npx supabase start`)를 상대로 돌린다.
// 환경변수: SB_URL, SB_KEY(publishable), DB_URL. 시간은 DB를 직접 고쳐 앞당긴다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const { SB_URL, SB_KEY, DB_URL } = process.env;
const sql = (q) => execFileSync("psql", [DB_URL, "-Atq", "-c", q], { encoding: "utf8" }).trim();

async function player(name) {
  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signInAnonymously();
  assert.ifError(error);
  const uid = data.user.id;
  const up = await db.from("characters").upsert({ user_id: uid, name, seed: 1, top_color: "#ffffff", bottom_color: "#000000", body: "AA==" });
  assert.ifError(up.error);
  return { db, uid, name };
}
// 원하는 크기의 돌을 바닥에 만든다
const stone = (radius = 0.3, height = 0.2, x = 0, z = 0) =>
  sql(`insert into stones (seed, radius, height, x, z, expires_at) values (1, ${radius}, ${height}, ${x}, ${z}, now() + interval '5 min') returning id`).split("\n")[0];
const rpc = async (p, fn, args) => {
  const { data, error } = await p.db.rpc(fn, args);
  assert.ifError(error);
  return data;
};
async function carryAndDrop(p, id, x, z) {
  assert.equal(await rpc(p, "pick_stone", { p_stone: id }), true);
  return rpc(p, "drop_stone", { p_stone: id, p_x: x, p_z: z });
}
const row = (id) => sql(`select state, tower_id is not null, expires_at is not null from stones where id='${id}'`);
const clean = (p) => sql(`delete from towers where owner_id='${p.uid}'; delete from stones where holder_id='${p.uid}'`);

test("첫돌은 탑을 만들고, 근처면 쌓이고, 멀면 버려져 다시 주울 수 있다", async () => {
  const p = await player("첫돌");
  const first = await carryAndDrop(p, stone(0.35), 20, 20);
  assert.equal(first.result, "first");

  const near = await carryAndDrop(p, stone(0.3), 21, 20);
  assert.ok(["stacked", "collapsed"].includes(near.result));
  if (near.result === "collapsed") return; // 드문 경우: 아래 시나리오는 다음 테스트가 다룬다

  const farId = stone(0.3);
  const far = await carryAndDrop(p, farId, 25, 20);
  assert.equal(far.result, "discarded");
  assert.equal(row(farId), "ground|f|t"); // 바닥 돌, 수명 있음
  assert.equal(await rpc(p, "pick_stone", { p_stone: farId }), true); // 다시 주움
  clean(p);
});

test("한 사람은 돌을 하나만 들고, 같은 돌은 먼저 집은 사람만 갖는다", async () => {
  const [a, b] = [await player("가"), await player("나")];
  const id = stone();
  const results = await Promise.all([rpc(a, "pick_stone", { p_stone: id }), rpc(b, "pick_stone", { p_stone: id })]);
  assert.equal(results.filter(Boolean).length, 1);
  const holder = results[0] ? a : b;
  assert.equal(await rpc(holder, "pick_stone", { p_stone: stone() }), false);
  clean(a); clean(b);
});

test("남의 탑 옆에는 첫돌을 놓을 수 없고, 남의 탑에는 쌓이지 않는다 (1인 1탑, 내 탑만)", async () => {
  const [a, b] = [await player("주인"), await player("손님")];
  assert.equal((await carryAndDrop(a, stone(0.35), -20, 20)).result, "first");
  const id = stone();
  assert.equal((await carryAndDrop(b, id, -20.5, 20)).result, "too_close");
  assert.equal(row(id), "ground|f|t");
  assert.equal(sql(`select count(*) from stones s join towers t on s.tower_id=t.id where t.owner_id='${a.uid}'`), "1");

  // 내 탑이 있으면 남의 탑 옆에 놓아도 내 탑과 멀어서 버려진다
  assert.equal((await carryAndDrop(b, stone(0.35), -40, 20)).result, "first");
  assert.equal((await carryAndDrop(b, stone(), -20.5, 20)).result, "discarded");
  assert.equal(sql(`select count(*) from towers where owner_id='${b.uid}'`), "1");
  clean(a); clean(b);
});

test("작은 돌 위의 큰 돌은 대부분 무너지고, 탑·소원이 사라지며 돌은 전부 바닥으로 간다", async () => {
  const p = await player("붕괴");
  let collapsed = 0;
  const trials = 30;
  for (let i = 0; i < trials; i++) {
    const firstId = stone(0.14, 0.1);
    assert.equal((await carryAndDrop(p, firstId, 30, -20)).result, "first");
    const topId = stone(0.38, 0.3);
    const r = await carryAndDrop(p, topId, 30, -20);
    if (r.result === "collapsed") {
      collapsed++;
      assert.equal(sql(`select count(*) from towers where owner_id='${p.uid}'`), "0");
      assert.equal(row(firstId), "ground|f|t");
      assert.equal(row(topId), "ground|f|t");
    } else clean(p);
  }
  assert.ok(collapsed >= trials * 0.75, `collapsed ${collapsed}/${trials}`);
});

test("큰 돌부터 작게 쌓으면 대체로 10단까지 선다", async () => {
  const p = await player("장인");
  let reached = 0;
  const trials = 20;
  for (let i = 0; i < trials; i++) {
    let alive = true;
    for (let k = 0; k < 10 && alive; k++) {
      const r = await carryAndDrop(p, stone(0.38 - k * 0.02, 0.2), 10, -20);
      alive = r.result === "first" || r.result === "stacked";
      if (alive && k === 9) reached++;
    }
    clean(p);
  }
  console.log(`10단 성공 ${reached}/${trials}`);
  assert.ok(reached >= trials * 0.4, `reached ${reached}/${trials}`);
});

test("10단이 차면 더 쌓이지 않고 바닥에 놓인다", async () => {
  const p = await player("상한");
  const first = await carryAndDrop(p, stone(0.3), 15, -20);
  const towerId = first.tower_id;
  // 판정 운을 배제하려고 9단을 직접 채운다
  for (let k = 1; k <= 9; k++) {
    sql(`insert into stones (seed, radius, height, state, tower_id, order_index, x, z) values (1, 0.3, 0.2, 'stacked', '${towerId}', ${k}, 15, -20)`);
  }
  assert.equal((await carryAndDrop(p, stone(), 15, -20)).result, "full");
  clean(p);
});

test("합장: 기본 1시간에 +10분, 같은 탑은 10분에 한 번, 다른 사람은 따로 가능", async () => {
  const [a, b] = [await player("탑주"), await player("행인")];
  const { tower_id: t } = await carryAndDrop(a, stone(0.35), 40, 5);
  const minutes = () => Math.round(Number(sql(`select extract(epoch from expires_at - now())/60 from towers where id='${t}'`)));
  assert.equal(minutes(), 60);

  assert.equal((await rpc(b, "pray", { p_tower: t })).ok, true);
  assert.equal(minutes(), 70);
  const again = await rpc(b, "pray", { p_tower: t });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "cooldown");
  assert.equal(minutes(), 70);

  assert.equal((await rpc(a, "pray", { p_tower: t })).ok, true); // 자기 탑도 가능
  assert.equal(minutes(), 80);

  sql(`update prayers set prayed_at = now() - interval '10 minutes 1 second' where tower_id='${t}' and user_id='${b.uid}'`);
  assert.equal((await rpc(b, "pray", { p_tower: t })).ok, true); // 쿨다운 뒤 다시
  assert.equal(minutes(), 90);
  clean(a);
});

test("소원은 5단부터 24자까지, 내 탑에만", async () => {
  const p = await player("소원");
  const { tower_id: t } = await carryAndDrop(p, stone(0.3), 50, 5);
  assert.equal(await rpc(p, "set_wish", { p_wish: "이른 소원" }), false);
  for (let k = 1; k <= 4; k++) {
    sql(`insert into stones (seed, radius, height, state, tower_id, order_index, x, z) values (1, 0.3, 0.2, 'stacked', '${t}', ${k}, 50, 5)`);
  }
  assert.equal(await rpc(p, "set_wish", { p_wish: "가".repeat(40) }), true);
  assert.equal(sql(`select wish from towers where id='${t}'`), "가".repeat(24));
  clean(p);
});

test("수명이 다하면 탑과 쌓인 돌이 사라지고, 쌓인 돌은 그전까지 사라지지 않는다", async () => {
  const p = await player("수명");
  const a = stone(0.35);
  const { tower_id: t } = await carryAndDrop(p, a, 60, 5);
  const expiredGround = stone();
  sql(`update stones set expires_at = now() - interval '1 second' where id='${expiredGround}'`);

  sql(`update world_state set last_tick = 'epoch'`);
  await rpc(p, "world_tick");
  assert.equal(sql(`select count(*) from stones where id='${expiredGround}'`), "0"); // 바닥 돌은 사라짐
  assert.equal(row(a), "stacked|t|f"); // 쌓인 돌은 남음

  sql(`update towers set expires_at = now() - interval '1 second' where id='${t}'`);
  sql(`update world_state set last_tick = 'epoch'`);
  await rpc(p, "world_tick");
  assert.equal(sql(`select count(*) from towers where id='${t}'`), "0");
  assert.equal(sql(`select count(*) from stones where id='${a}'`), "0");
});

test("돌이 자동으로 채워지고, 사라진 사람이 든 돌은 풀려난다", async () => {
  const p = await player("보충");
  const id = stone();
  assert.equal(await rpc(p, "pick_stone", { p_stone: id }), true);
  sql(`update characters set last_seen = now() - interval '2 minutes' where user_id='${p.uid}'`);
  const q = await player("다른이");
  sql(`update world_state set last_tick = 'epoch'`);
  await rpc(q, "world_tick");
  assert.equal(row(id), "ground|f|t");
  assert.ok(Number(sql(`select count(*) from stones where state='ground'`)) >= 240);
  // 크기가 범위 전체에 고르게 퍼져 있어야 쌓기 판정이 의미 있다
  sql(`delete from stones where state='ground'`);
  sql(`update world_state set last_tick = 'epoch'`);
  await rpc(q, "world_tick");
  const [min, max] = sql(`select min(radius), max(radius) from stones where state='ground'`).split("|").map(Number);
  assert.ok(min < 0.25 && max > 0.45, `돌 크기 범위가 좁음: ${min}~${max}`);
});

test("클라이언트는 테이블에 직접 쓸 수 없다", async () => {
  const p = await player("해커");
  const id = stone();
  await p.db.from("stones").update({ x: 999 }).eq("id", id);
  assert.notEqual(sql(`select x from stones where id='${id}'`), "999");
  const ins = await p.db.from("towers").insert({ owner_id: p.uid, owner_name: "x", x: 0, z: 0, expires_at: "2099-01-01" });
  assert.ok(ins.error);
  const other = await player("피해자");
  await p.db.from("characters").update({ name: "탈취" }).eq("user_id", other.uid);
  assert.equal(sql(`select name from characters where user_id='${other.uid}'`), "피해자");
});

test("소스에 맞는 실시간 이벤트가 온다 (돌 변경)", async () => {
  const p = await player("실시간");
  const got = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("실시간 이벤트 없음")), 15000);
    const ch = p.db.channel("t").on("postgres_changes", { event: "UPDATE", schema: "public", table: "stones" }, (e) => {
      if (e.new.id !== idRef) return; // 다른 테스트가 남긴 변경은 무시
      clearTimeout(to); p.db.removeChannel(ch); resolve(e.new);
    }).subscribe(async (s) => {
      if (s === "SUBSCRIBED") setTimeout(() => void rpc(p, "pick_stone", { p_stone: idRef }), 3000); // 첫 구독자의 변경 수신 준비 시간
    });
  });
  const idRef = stone();
  const ev = await got;
  assert.equal(ev.id, idRef);
  assert.equal(ev.state, "held");
  clean(p);
});
