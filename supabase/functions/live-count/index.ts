// 게임 안 접속 인원을 metamoa로 보낸다. pg_cron이 10분마다 호출한다(supabase/live-count-cron.sql).
// 호출 검증은 아래 x-cron-secret으로 직접 하므로 --no-verify-jwt로 배포한다.
import { createClient } from "npm:@supabase/supabase-js@2";

const TARGET = "https://metamoa.com/api/live/stone-ksthink-com-mw79rqk1";
const SYNC_TIMEOUT_MS = 8000;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// track을 하지 않고 지켜보기만 하므로 자기 자신은 인원에 들어가지 않는다
function countPeople(): Promise<number> {
  const channel = db.channel("world");
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("presence sync timeout")), SYNC_TIMEOUT_MS);
    channel
      .on("presence", { event: "sync" }, () => {
        clearTimeout(timer);
        resolve(Object.keys(channel.presenceState()).length);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(new Error(`channel ${status}`));
        }
      });
  }).finally(() => db.removeChannel(channel));
}

Deno.serve(async (req) => {
  const { data: ok, error } = await db.rpc("live_count_secret_ok", { candidate: req.headers.get("x-cron-secret") ?? "" });
  if (error) {
    console.error("secret check failed", error.message);
    return new Response("secret check failed", { status: 500 });
  }
  if (!ok) return new Response("forbidden", { status: 403 });

  let count: number;
  try {
    count = await countPeople();
  } catch (e) {
    // 세지 못했을 때 0을 보내면 거짓 수치가 되므로 이번 회차는 건너뛴다
    console.error("count failed", e);
    return new Response("count failed", { status: 504 });
  }

  const res = await fetch(TARGET, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("METAMOA_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });
  console.log("live-count", { count, status: res.status });
  return Response.json({ count, status: res.status }, { status: res.ok ? 200 : 502 });
});
