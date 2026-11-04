"use client";

import { useEffect, useState } from "react";
import type { PlayerSpot } from "@/lib/game";
import type { CharacterRow } from "@/lib/net";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { GameView } from "./GameView";
import { Intro } from "./Intro";
import { type SculptResult, Sculptor } from "./Sculptor";

// 개발 모드 StrictMode의 이중 실행에도 익명 계정이 하나만 생기도록 한 번만 수행한다
let session: Promise<string> | null = null;
function ensureSession(db: NonNullable<typeof supabase>) {
  return (session ??= (async () => {
    const { data: { session: existing } } = await db.auth.getSession();
    if (existing) return existing.user.id;
    const { data, error } = await db.auth.signInAnonymously();
    if (error || !data.user) throw new Error(error?.message ?? "익명 로그인 실패");
    return data.user.id;
  })());
}

type Phase = { kind: "loading" } | { kind: "error"; message: string } | { kind: "intro"; uid: string; me: CharacterRow | null } | { kind: "sculpt"; uid: string; back?: { me: CharacterRow; at: PlayerSpot } } | { kind: "play"; me: CharacterRow; at?: PlayerSpot };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [font, setFont] = useState("sans-serif");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) return;
    const db = supabase;
    let dead = false;
    (async () => {
      const family = getComputedStyle(document.body).fontFamily;
      setFont(family);
      // 3D 라벨은 캔버스에 그리므로 글꼴을 먼저 받아 둔다
      await document.fonts.load(`30px ${family}`, "돌탑").catch(() => undefined);

      const uid = await ensureSession(db);
      const { data: me, error } = await db.from("characters").select("user_id,name,seed,top_color,bottom_color,body").eq("user_id", uid).maybeSingle();
      if (error) throw new Error(error.message);
      if (!dead) setPhase({ kind: "intro", uid, me: me as CharacterRow | null });
    })().catch((e: Error) => { if (!dead) setPhase({ kind: "error", message: e.message }); });
    return () => { dead = true; };
  }, []);

  if (!supabaseConfigured || !supabase) {
    return <div className="center"><h1>어서 놔요, 소원 돌탑</h1><p>Supabase 환경변수가 설정되지 않았어요. <code>.env.example</code>을 확인해 주세요.</p></div>;
  }
  if (phase.kind === "loading") return <div className="center"><p>마을로 가는 길…</p></div>;
  if (phase.kind === "error") return <div className="center"><h1>들어가지 못했어요</h1><p>{phase.message}</p></div>;

  if (phase.kind === "intro") {
    return <Intro db={supabase} onEnter={() => setPhase(phase.me ? { kind: "play", me: phase.me } : { kind: "sculpt", uid: phase.uid })} />;
  }

  if (phase.kind === "sculpt") {
    const db = supabase;
    const done = async (r: SculptResult) => {
      setBusy(true);
      setError("");
      const row: CharacterRow = { user_id: phase.uid, name: r.name, seed: r.seed, top_color: r.top, bottom_color: r.bottom, body: r.body };
      const { error } = await db.from("characters").upsert(row);
      setBusy(false);
      if (error) setError(`저장하지 못했어요: ${error.message}`);
      else setPhase({ kind: "play", me: row });
    };
    // 게임 중에 다시 빚을 때만 취소할 수 있다. 처음 입장할 때는 돌아갈 곳이 없다
    const { back } = phase;
    return <Sculptor busy={busy} error={error} onDone={done} onCancel={back && (() => { setError(""); setPhase({ kind: "play", me: back.me, at: back.at }); })} />;
  }
  return <GameView db={supabase} me={phase.me} font={font} start={phase.at} onResculpt={(at) => setPhase({ kind: "sculpt", uid: phase.me.user_id, back: { me: phase.me, at } })} />;
}
