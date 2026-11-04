"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as THREE from "three";
import { Game, type HudState } from "@/lib/game";
import { type CharacterRow, Net } from "@/lib/net";
import { WISH_AT, WISH_MAX } from "@/lib/rules";
import { CameraIcon, ClockIcon, CloseIcon, DiscardIcon, DragIcon, FirstStoneIcon, PersonIcon, PickIcon, PrayIcon, SculptIcon, StackIcon, TowerIcon, WishIcon } from "./Icons";

const TOAST_MS = 5000;

const ACTIONS = {
  pick: { icon: PickIcon, key: "E" },
  first: { icon: FirstStoneIcon, key: "E" },
  stack: { icon: StackIcon, key: "E" },
  discard: { icon: DiscardIcon, key: "E" },
  blocked: { icon: DiscardIcon, key: "E" },
  pray: { icon: PrayIcon, key: "Q" },
};

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
  online: false, people: 1, towers: 0, myStones: 0, myMinutes: null, myLife: "", myWish: null, carrying: false,
  prompt: "", action: null, dropKind: null, canPray: false, prayWait: 0, canWish: false, cam: "따라가기", toastId: 0, toast: "",
};

export function GameView({ db, me, font, onResculpt }: { db: SupabaseClient; me: CharacterRow; font: string; onResculpt(): void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [hud, setHud] = useState(EMPTY);
  const [toastOn, setToastOn] = useState(false);
  const [wishOpen, setWishOpen] = useState(false);
  const [wish, setWish] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const markerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);

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

  // 메시지마다 5초 동안 보여 주고 서서히 사라진다. 글자는 남겨 둬야 사라지는 동안에도 보인다
  useEffect(() => {
    if (!hud.toastId) return;
    setToastOn(true);
    const t = setTimeout(() => setToastOn(false), TOAST_MS);
    return () => clearTimeout(t);
  }, [hud.toastId]);

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
      if (e.code === "Escape") setHelpOpen(false);
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

  const ActionIcon = hud.action ? ACTIONS[hud.action].icon : null;

  return (
    <div className="stage">
      <Canvas shadows="percentage" camera={{ fov: 42, near: 0.1, far: 260, position: [0, 5, 9] }} dpr={[1, 2]}>
        <Scene onGame={setGame} db={db} me={me} font={font} />
      </Canvas>

      <div className="hud tl">
        <div className="stat-row">
          <div className="chip stat" role="img" aria-label={`마을 탑 ${hud.towers}개`}><TowerIcon /><b>{hud.towers}</b></div>
          <div className={`chip stat ${hud.online ? "" : "offline"}`} role="img" aria-label={`접속 ${hud.people}명${hud.online ? "" : ", 연결 중"}`}><PersonIcon /><b>{hud.people}</b></div>
        </div>
        {hud.myMinutes !== null && (
          <div className="chip stat mine" role="img" aria-label={`내 탑 ${hud.myStones}단, 남은 시간 ${hud.myLife}`}>
            <TowerIcon /><b>{hud.myStones}</b><ClockIcon /><b>{hud.myLife}</b>
          </div>
        )}
        {ActionIcon && (
          <div className={`chip stat action ${hud.action}`} role="img" aria-label={hud.prompt}>
            <ActionIcon size={22} /><kbd>{ACTIONS[hud.action!].key}</kbd>
          </div>
        )}
      </div>
      <div className="hud tr keys">
        <div className="chip key dpad" role="img" aria-label="W A S D 키로 이동"><kbd className="up">W</kbd><kbd className="left">A</kbd><kbd className="down">S</kbd><kbd className="right">D</kbd></div>
        <div className="chip key icon" role="img" aria-label="E 키로 돌 줍기, 놓기"><kbd>E</kbd><PickIcon /></div>
        <div className="chip key icon" role="img" aria-label="Q 키로 기도"><kbd>Q</kbd><PrayIcon /></div>
        <div className="chip key icon" role="img" aria-label={`C 키로 뷰 전환, 지금은 ${hud.cam}`}><kbd>C</kbd><CameraIcon /></div>
        <button type="button" className="chip key icon link" onClick={onResculpt} aria-label="캐릭터 다시 빚기" title="캐릭터 다시 빚기"><SculptIcon /></button>
      </div>

      <div className="marker" ref={markerRef} style={{ display: "none" }}>
        <span className="arrow" aria-hidden="true">▲</span>
        <span />
      </div>

      <div className={`toast ${toastOn ? "on" : ""}`} role="status">{hud.toast}</div>

      <button type="button" className="chip help-btn" onClick={() => setHelpOpen(true)} aria-label="조작 방법 보기">?</button>

      {helpOpen && (
        <div className="help-back" onClick={() => setHelpOpen(false)}>
          <div className="help" role="dialog" aria-modal="true" aria-label="조작 방법" onClick={(e) => e.stopPropagation()}>
            <div className="help-head">
              <h2>조작 방법</h2>
              <button type="button" autoFocus onClick={() => setHelpOpen(false)} aria-label="닫기"><CloseIcon /></button>
            </div>
            <dl>
              <div className="only-key"><dt><span className="dpad"><kbd className="up">W</kbd><kbd className="left">A</kbd><kbd className="down">S</kbd><kbd className="right">D</kbd></span></dt><dd>방향. 방향키도 됩니다</dd></div>
              <div className="only-touch"><dt>조이스틱</dt><dd>왼쪽 아래 조이스틱으로 이동</dd></div>
              <div><dt><DragIcon /></dt><dd>화면을 드래그해 카메라 돌리기</dd></div>
              <div><dt><PickIcon /><kbd className="only-key">E</kbd></dt><dd>줍기/놓기. 내 첫돌 근처에 놓아야 쌓입니다</dd></div>
              <div><dt><PrayIcon /><kbd className="only-key">Q</kbd></dt><dd>기도. 탑 옆에서 하면 수명이 1시간 늘어납니다</dd></div>
              <div><dt><WishIcon /><kbd className="only-key">F</kbd></dt><dd>내 탑이 {WISH_AT}단이 되면 소원 적기</dd></div>
              <div><dt><CameraIcon /><kbd className="only-key">C</kbd></dt><dd>뷰 전환</dd></div>
              <div><dt><SculptIcon /></dt><dd>캐릭터 다시 빚기</dd></div>
            </dl>
          </div>
        </div>
      )}

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
