"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as THREE from "three";
import { Game, type HudState, type PlayerSpot, type WishPrompt } from "@/lib/game";
import { type CharacterRow, Net } from "@/lib/net";
import { MAX_STONES, WISH_AT, WISH_MAX } from "@/lib/rules";
import { soundDebug, startSound } from "@/lib/sound";
import { CameraIcon, ClockIcon, CloseIcon, DiscardIcon, DragIcon, FirstStoneIcon, JoyIcon, PersonIcon, PickIcon, PrayIcon, RestIcon, SadIcon, SculptIcon, StackIcon, TowerIcon, WaveIcon, WishIcon } from "./Icons";

const TOAST_MS = 5000;
const TAP_SLOP = 8; // 이만큼(px) 움직이기 전에 손을 떼면 탭으로 본다

const ACTIONS = {
  pick: { icon: PickIcon, key: "E" },
  first: { icon: FirstStoneIcon, key: "E" },
  stack: { icon: StackIcon, key: "E" },
  discard: { icon: DiscardIcon, key: "E" },
  blocked: { icon: DiscardIcon, key: "E" },
  pray: { icon: PrayIcon, key: "Q" },
};

const WISH_PROMPTS: Record<WishPrompt, string> = {
  ready: `이제 소원을 더 빌 수 있어요. 탑은 최대 ${MAX_STONES}층까지 쌓을 수 있답니다. 지금 비실 건가요? 아님 나중?`,
  max: "최대 층을 달성했습니다. 소원을 비세요",
};

const REACTION_BUTTONS = [
  { kind: "rest", icon: RestIcon, label: "쉬기" },
  { kind: "wave", icon: WaveIcon, label: "인사" },
  { kind: "joy", icon: JoyIcon, label: "기쁨" },
  { kind: "sad", icon: SadIcon, label: "슬픔" },
] as const;

function Scene({ onGame, db, me, font, start }: { onGame(g: Game | null): void; db: SupabaseClient; me: CharacterRow; font: string; start?: PlayerSpot }) {
  const { scene, camera, gl } = useThree();
  const game = useRef<Game | null>(null);

  useEffect(() => {
    gl.toneMappingExposure = 0.78;
    const g = new Game(scene, camera as THREE.PerspectiveCamera, (ev) => new Net(db, me.user_id, me.name, ev), me, font, start);
    game.current = g;
    onGame(g);
    g.net.start();
    startSound();
    if (new URLSearchParams(location.search).has("debug")) Object.assign(window, { __doltap: g, __soundDebug: soundDebug });

    // 빈 곳 드래그로 카메라 회전, 휠로 거리
    const el = gl.domElement;
    let drag: { id: number; x: number; y: number; moved: number; tap: boolean } | null = null;
    // 오른쪽·가운데 버튼은 카메라만 돌리고 탭(이동·줍기)으로 치지 않는다
    // 두 번째 손가락은 무시하고, 첫 손가락의 탭도 취소한다(두 손가락을 뗄 때 탭으로 치지 않게)
    const down = (e: PointerEvent) => { if (drag) { drag.tap = false; return; } drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, tap: e.button === 0 }; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      // 마우스를 올린 「…」 푯말은 내용을 펼친다(드래그 중이 아닐 때만)
      if (e.pointerType === "mouse" && !drag) {
        const r = el.getBoundingClientRect();
        g.hover = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
      }
      if (!drag || e.pointerId !== drag.id) return;
      drag.moved += Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      g.orbit(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (drag && e.pointerId !== drag.id) return;
      // 거의 움직이지 않고 뗐으면 드래그가 아니라 탭이다
      if (drag && e.pointerId === drag.id && e.type === "pointerup" && drag.tap && drag.moved < TAP_SLOP) {
        const r = el.getBoundingClientRect();
        g.tap(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
      drag = null;
    };
    const leave = () => { g.hover = null; };
    const noMenu = (e: Event) => e.preventDefault(); // 오른쪽 드래그로 카메라를 돌릴 때 메뉴가 뜨지 않게
    const wheel = (e: WheelEvent) => g.zoom(e.deltaY);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up); // pointerup을 놓쳐도(오른쪽 클릭 메뉴 등) 드래그가 남지 않게
    el.addEventListener("pointerleave", leave);
    el.addEventListener("contextmenu", noMenu);
    el.addEventListener("wheel", wheel, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("contextmenu", noMenu);
      el.removeEventListener("wheel", wheel);
      g.dispose();
      game.current = null;
      onGame(null);
    };
  }, [scene, camera, gl, db, me, font, onGame, start]);

  useFrame((_, dt) => game.current?.update(Math.min(dt, 0.1)));
  return null;
}

const EMPTY: HudState = {
  online: false, people: 1, towers: 0, myStones: 0, myMinutes: null, myLife: "", wishPrompt: null, firstStoneAsk: false, dropAsk: false, towerAsk: false, carrying: false,
  prompt: "", action: null, dropKind: null, canPray: false, prayWait: 0, canWish: false, cam: "따라가기", toastId: 0, toast: "",
};

export function GameView({ db, me, font, start, onResculpt }: { db: SupabaseClient; me: CharacterRow; font: string; start?: PlayerSpot; onResculpt(at: PlayerSpot): void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [hud, setHud] = useState(EMPTY);
  const [toastOn, setToastOn] = useState(false);
  const [wishOpen, setWishOpen] = useState(false);
  const [wish, setWish] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const statsRef = useRef<HTMLPreElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const wishAskRef = useRef<HTMLDivElement>(null);

  // 버튼이 아니라 창에 포커스를 준다. 돌을 놓느라 누른 스페이스가 뗄 때 버튼을 눌러 버리지 않게 한다
  useEffect(() => { if (hud.wishPrompt || hud.firstStoneAsk || hud.dropAsk || hud.towerAsk) wishAskRef.current?.focus(); }, [hud.wishPrompt, hud.firstStoneAsk, hud.dropAsk, hud.towerAsk]);

  // HUD 폴링: 프레임마다 React를 돌리지 않는다
  useEffect(() => {
    if (!game) return;
    const id = setInterval(() => setHud(game.hud()), 150);
    let raf = 0, frames = 0, since = performance.now(), fps = 0;
    const tick = () => {
      if (markerRef.current) game.placeMarker(markerRef.current, innerWidth, innerHeight);
      // 프레임 레이트는 0.5초마다 센다
      frames++;
      const now = performance.now();
      if (now - since >= 500) { fps = (frames * 1000) / (now - since); frames = 0; since = now; }
      if (statsRef.current) {
        const c = game.coords;
        statsRef.current.textContent = `x ${c.x.toFixed(2)}\ny ${c.y.toFixed(2)}\nz ${c.z.toFixed(2)}\n${fps.toFixed(0)} fps`;
      }
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
    showWishForm(game);
  };
  // 이미 열려 있으면 그대로 둔다. 적던 소원은 빌기에 성공했을 때만 지운다(실패해 다시 열려도 남아 있게)
  const showWishForm = (g: Game) => {
    if (wishOpen) return;
    g.inputLocked = true;
    g.releaseKeys();
    setWishOpen(true);
  };
  const closeWish = () => { setWishOpen(false); if (game) game.inputLocked = false; };
  // 내 탑이 다 차면(최대 단) 소원을 빌 때까지 소원 창을 닫을 수 없다. 새로 들어와도, 빌기에 실패해도 다시 연다
  const mustWish = hud.myStones >= MAX_STONES;
  const wishing = useRef(false);
  useEffect(() => {
    if (game && mustWish && !wishOpen && !wishing.current && !game.askOpen) showWishForm(game);
  });
  const answerWishPrompt = (wishNow: boolean) => {
    if (!game) return;
    game.closeWishPrompt();
    setHud(game.hud());
    if (wishNow) showWishForm(game);
  };
  const answerFirstStone = (release: boolean) => {
    if (!game) return;
    void game.answerFirstStone(release);
    setHud(game.hud());
  };
  const answerTowerAsk = (yes: boolean) => {
    if (!game) return;
    game.answerTowerAsk(yes);
    setHud(game.hud());
  };
  const answerDropAsk = (yes: boolean) => {
    if (!game) return;
    game.answerDropAsk(yes);
    setHud(game.hud());
  };
  const submitWish = async (e: FormEvent) => {
    e.preventDefault();
    const text = wish.trim();
    if (!game || !text) return;
    wishing.current = true;
    closeWish();
    if (await game.makeWish(text)) setWish("");
    setHud(game.hud()); // 빈 탑이 화면에 남은 채로 창이 다시 열리지 않게 바로 반영한다
    wishing.current = false;
  };

  // 키보드
  useEffect(() => {
    if (!game) return;
    const down = (e: KeyboardEvent) => {
      // Ctrl + ? (Ctrl + Shift + /, Ctrl + / 도 같은 키)로 좌표·프레임 오버레이를 켜고 끈다
      if (e.ctrlKey && (e.code === "Slash" || e.key === "?") && !e.repeat && (e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        setStatsOpen((v) => !v);
        return;
      }
      if (e.repeat || wishOpen || game.askOpen || (e.target as HTMLElement)?.tagName === "INPUT") return;
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

  const ActionIcon = hud.action ? ACTIONS[hud.action].icon : null;

  return (
    <div className="stage">
      <Canvas shadows="percentage" camera={{ fov: 42, near: 0.1, far: 260, position: [0, 5, 9] }} dpr={[1, 2]}>
        <Scene onGame={setGame} db={db} me={me} font={font} start={start} />
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
        <div className="chip key icon" role="img" aria-label="Q 키로 합장"><kbd>Q</kbd><PrayIcon /></div>
        <div className="chip key icon" role="img" aria-label={`C 키로 뷰 전환, 지금은 ${hud.cam}`}><kbd>C</kbd><CameraIcon /></div>
        <button type="button" className="chip key icon link" onClick={() => { if (game) onResculpt(game.spot); }} aria-label="캐릭터 다시 빚기" title="캐릭터 다시 빚기"><SculptIcon /></button>
      </div>

      {/* 누르면 내 탑으로 걸어간다(돌을 들고 있으면 가서 쌓는다) */}
      <div className="marker" ref={markerRef} style={{ display: "none" }} role="button" aria-label="내 탑으로 가기" tabIndex={0}
        onClick={() => game?.goToMyTower()}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation(); // 전체 키보드 처리(스페이스 = 줍기·놓기)로 가지 않게
          if (!e.repeat) game?.goToMyTower();
        }}>
        <span className="arrow" aria-hidden="true">▲</span>
        <span />
      </div>

      <div className={`toast ${toastOn ? "on" : ""}`} role="status">{hud.toast}</div>
      {statsOpen && <pre className="stats" ref={statsRef} aria-label="현재 좌표와 프레임 레이트" />}

      <div className="hud reactions">
        {REACTION_BUTTONS.map(({ kind, icon: Icon, label }) => (
          // 마우스로 눌러도 포커스를 가져가지 않는다. 포커스가 남으면 스페이스(줍기)를 꾹 눌렀을 때 버튼도 눌린다
          <button key={kind} type="button" className="chip react" disabled={wishOpen} onMouseDown={(e) => e.preventDefault()} onClick={() => game?.react(kind)} aria-label={label} title={label}><Icon /></button>
        ))}
      </div>

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
              <div className="only-key"><dt>클릭</dt><dd>땅을 클릭하면 그곳으로 걸어갑니다. 돌을 클릭하면 줍습니다</dd></div>
              <div className="only-touch"><dt>탭</dt><dd>땅을 탭하면 그곳으로 걸어갑니다. 돌을 탭하면 줍습니다</dd></div>
              <div><dt><DragIcon /></dt><dd>화면을 드래그해 카메라 돌리기</dd></div>
              <div><dt><PickIcon /><kbd className="only-key">E</kbd></dt><dd>줍기/놓기. 내 첫돌 근처에 놓아야 쌓입니다. 돌을 든 채 땅을 누르면 첫 돌은 여기 내릴지 묻고, 그다음부터는 내 탑을 누르면 알아서 올립니다</dd></div>
              <div><dt><PrayIcon /><kbd className="only-key">Q</kbd></dt><dd>합장. 탑 옆에서 하면 수명이 1시간 늘어납니다</dd></div>
              <div><dt><WishIcon /><kbd className="only-key">F</kbd></dt><dd>내 탑이 {WISH_AT}단이 되면 소원 적기</dd></div>
              <div><dt><CameraIcon /><kbd className="only-key">C</kbd></dt><dd>뷰 전환</dd></div>
              <div><dt><span aria-hidden="true">😌👋😆😢</span></dt><dd>쉬기, 인사, 기쁨, 슬픔. 움직이면 끝나고, 돌을 들고는 할 수 없습니다</dd></div>
              <div><dt><SculptIcon /></dt><dd>캐릭터 다시 빚기</dd></div>
            </dl>
          </div>
        </div>
      )}

      {hud.wishPrompt && (
        <div className="help-back">
          <div className="wish" ref={wishAskRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-describedby="wish-ask">
            <p id="wish-ask" className="ask">{WISH_PROMPTS[hud.wishPrompt]}</p>
            <div className="row">
              {hud.wishPrompt === "ready" ? (
                <>
                  <button type="button" className="go" onClick={() => answerWishPrompt(true)}>지금</button>
                  <button type="button" onClick={() => answerWishPrompt(false)}>나중</button>
                </>
              ) : (
                <button type="button" className="go" onClick={() => answerWishPrompt(true)}>확인</button>
              )}
            </div>
          </div>
        </div>
      )}

      {hud.firstStoneAsk && (
        <div className="help-back">
          <div className="wish" ref={wishAskRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-describedby="first-ask">
            <p id="first-ask" className="ask">첫 돌을 다시 쌓으실 건가요</p>
            <div className="row">
              <button type="button" className="go" onClick={() => answerFirstStone(true)}>네</button>
              <button type="button" onClick={() => answerFirstStone(false)}>아니요</button>
            </div>
          </div>
        </div>
      )}

      {hud.dropAsk && (
        <div className="help-back">
          <div className="wish" ref={wishAskRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-describedby="drop-ask">
            <p id="drop-ask" className="ask">여기에 돌을 내릴까요?</p>
            <div className="row">
              <button type="button" className="go" onClick={() => answerDropAsk(true)}>네</button>
              <button type="button" onClick={() => answerDropAsk(false)}>아니요</button>
            </div>
          </div>
        </div>
      )}

      {hud.towerAsk && (
        // 창 바깥(어두운 배경)을 누르면 [아니요]와 같다
        <div className="help-back" onClick={(e) => { if (e.target === e.currentTarget) answerTowerAsk(false); }}>
          <div className="wish" ref={wishAskRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-describedby="tower-ask">
            <p id="tower-ask" className="ask">내 돌탑 위치로 이동할까요?</p>
            <div className="row">
              <button type="button" className="go" onClick={() => answerTowerAsk(true)}>네</button>
              <button type="button" onClick={() => answerTowerAsk(false)}>아니요</button>
            </div>
          </div>
        </div>
      )}

      {wishOpen && (
        <form className="wish" onSubmit={submitWish}>
          <label htmlFor="wish-text">탑에 새길 소원</label>
          <p>접속한 모두에게 보이고, 탑의 수명이 다하면 사라져요.</p>
          <input id="wish-text" autoFocus maxLength={WISH_MAX} value={wish} onChange={(e) => setWish(e.target.value)} placeholder="예: 올해는 책 100권 읽기" autoComplete="off" />
          <div className="row">
            {!mustWish && <button type="button" onClick={closeWish}>취소</button>}
            <button type="submit" className="go" disabled={!wish.trim()}>빌기</button>
          </div>
        </form>
      )}

      <div className="touch">
        <button type="button" className="btn act" onClick={() => void game?.action()}>{hud.carrying ? "놓기" : "줍기"}</button>
        <button type="button" className="btn small pray" disabled={!hud.canPray} onClick={() => void game?.prayAction()}>합장</button>
        <button type="button" className="btn small wishb" disabled={!hud.canWish} onClick={openWish}>소원</button>
        <button type="button" className="btn small cam" onClick={() => game?.cycleCam()}>뷰</button>
      </div>
    </div>
  );
}
