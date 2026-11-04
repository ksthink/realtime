"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as THREE from "three";
import { Game, type HudState } from "@/lib/game";
import { type CharacterRow, Net } from "@/lib/net";
import { WISH_AT, WISH_MAX } from "@/lib/rules";

function Scene({ onGame, db, me, font }: { onGame(g: Game | null): void; db: SupabaseClient; me: CharacterRow; font: string }) {
  const { scene, camera, gl } = useThree();
  const game = useRef<Game | null>(null);

  useEffect(() => {
    gl.toneMappingExposure = 0.78;
    const g = new Game(scene, camera as THREE.PerspectiveCamera, (ev) => new Net(db, me.user_id, me.name, ev), me, font);
    game.current = g;
    onGame(g);
    g.net.start();
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __doltap: Game }).__doltap = g;

    // 빈 곳 드래그로 카메라 회전, 휠로 거리
    const el = gl.domElement;
    let drag: { id: number; x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      g.orbit(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => g.zoom(e.deltaY);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      g.dispose();
      game.current = null;
      onGame(null);
    };
  }, [scene, camera, gl, db, me, font, onGame]);

  useFrame((_, dt) => game.current?.update(Math.min(dt, 0.1)));
  return null;
}

const EMPTY: HudState = {
  online: false, people: 1, towers: 0, myStones: 0, myMinutes: null, myWish: null, carrying: false,
  prompt: "마을에 들어가는 중…", dropKind: null, canPray: false, prayWait: 0, canWish: false, cam: "따라가기", toastId: 0, toast: "",
};

export function GameView({ db, me, font, onResculpt }: { db: SupabaseClient; me: CharacterRow; font: string; onResculpt(): void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [hud, setHud] = useState(EMPTY);
  const [toast, setToast] = useState("");
  const [wishOpen, setWishOpen] = useState(false);
  const [wish, setWish] = useState("");
  const markerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [lastToast, setLastToast] = useState(0);

  // HUD 폴링: 프레임마다 React를 돌리지 않는다
  useEffect(() => {
    if (!game) return;
    const id = setInterval(() => setHud(game.hud()), 150);
    let raf = 0;
    const tick = () => {
      if (markerRef.current) game.placeMarker(markerRef.current, innerWidth, innerHeight);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { clearInterval(id); cancelAnimationFrame(raf); };
  }, [game]);

  useEffect(() => {
    if (hud.toastId === lastToast) return;
    setLastToast(hud.toastId);
    setToast(hud.toast);
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [hud.toastId, hud.toast, lastToast]);

  const openWish = () => {
    if (!game) return;
    if (!game.canWishHere) { game.toast(`내 탑을 ${WISH_AT}단 이상 쌓으면 소원을 적을 수 있어요`); return; }
    setWish(game.currentWish);
    game.inputLocked = true;
    game.releaseKeys();
    setWishOpen(true);
  };
  const closeWish = () => { setWishOpen(false); if (game) game.inputLocked = false; };
  const submitWish = async (e: FormEvent) => {
    e.preventDefault();
    if (!game) return;
    const text = wish.trim();
    closeWish();
    if (!text) return;
    game.toast((await game.net.setWish(text)) ? "소원을 탑에 새겼어요" : "소원을 새기지 못했어요");
  };

  // 키보드
  useEffect(() => {
    if (!game) return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || wishOpen || (e.target as HTMLElement)?.tagName === "INPUT") return;
      game.setKey(e.code, true);
      if (e.code === "KeyE" || e.code === "Space") { e.preventDefault(); void game.action(); }
      if (e.code === "KeyQ") void game.prayAction();
      if (e.code === "KeyC") game.cycleCam();
      if (e.code === "KeyF") { e.preventDefault(); openWish(); }
    };
    const up = (e: KeyboardEvent) => game.setKey(e.code, false);
    const blur = () => game.releaseKeys();
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", blur); };
  });

  // 조이스틱
  const joyMove = (e: React.PointerEvent) => {
    if (!game || !stickRef.current) return;
    const rc = stickRef.current.getBoundingClientRect();
    let x = (e.clientX - rc.left - 60) / 45, y = (e.clientY - rc.top - 60) / 45;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    game.joy = { x, y };
    if (knobRef.current) knobRef.current.style.transform = `translate(${x * 40}px,${y * 40}px)`;
  };
  const joyEnd = () => {
    if (game) game.joy = { x: 0, y: 0 };
    if (knobRef.current) knobRef.current.style.transform = "";
  };

  return (
    <div className="stage">
      <Canvas shadows="percentage" camera={{ fov: 42, near: 0.1, far: 260, position: [0, 5, 9] }} dpr={[1, 2]}>
        <Scene onGame={setGame} db={db} me={me} font={font} />
      </Canvas>

      <div className="hud tl">
        <div className={`chip prompt ${hud.dropKind ?? ""}`}>{hud.prompt}</div>
        <div className="chip">
          {hud.myMinutes !== null ? <>내 탑 <b>{hud.myStones}</b>단 · <b>{Math.max(0, hud.myMinutes)}</b>분 남음</> : "아직 내 탑이 없어요"}
        </div>
        <div className="chip">마을 탑 <b>{hud.towers}</b>개 · 접속 <b>{hud.people}</b>명{!hud.online && " · 연결 중…"}</div>
      </div>
      <div className="hud tr keys">
        <div className="chip key"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동 · 드래그 회전</div>
        <div className="chip key"><kbd>E</kbd> 줍기 · 놓기</div>
        <div className="chip key"><kbd>Q</kbd> 합장 (탑 수명 +10분)</div>
        <div className="chip key"><kbd>F</kbd> 소원 · {WISH_AT}단부터</div>
        <div className="chip key"><kbd>C</kbd> 카메라 {hud.cam}</div>
        <button type="button" className="chip key link" onClick={onResculpt}>캐릭터 다시 빚기</button>
      </div>

      <div className="marker" ref={markerRef} style={{ display: "none" }}>
        <span className="arrow" aria-hidden="true">▲</span>
        <span />
      </div>

      <div className={`toast ${toast ? "on" : ""}`} role="status">{toast}</div>

      {wishOpen && (
        <form className="wish" onSubmit={submitWish}>
          <label htmlFor="wish-text">탑에 새길 소원</label>
          <p>접속한 모두에게 보이고, 탑이 무너지거나 수명이 다하면 사라져요.</p>
          <input id="wish-text" autoFocus maxLength={WISH_MAX} value={wish} onChange={(e) => setWish(e.target.value)} placeholder="예: 올해는 책 100권 읽기" autoComplete="off" />
          <div className="row">
            <button type="button" onClick={closeWish}>취소</button>
            <button type="submit" className="go">새기기</button>
          </div>
        </form>
      )}

      <div className="touch">
        <div className="stick" ref={stickRef} aria-label="이동 조이스틱"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); joyMove(e); }}
          onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) joyMove(e); }}
          onPointerUp={joyEnd} onPointerCancel={joyEnd}>
          <div className="knob" ref={knobRef} />
        </div>
        <button type="button" className="btn act" onClick={() => void game?.action()}>{hud.carrying ? "놓기" : "줍기"}</button>
        <button type="button" className="btn small pray" disabled={!hud.canPray} onClick={() => void game?.prayAction()}>합장</button>
        <button type="button" className="btn small wishb" disabled={!hud.canWish} onClick={openWish}>소원</button>
        <button type="button" className="btn small cam" onClick={() => game?.cycleCam()}>카메라</button>
      </div>
    </div>
  );
}
