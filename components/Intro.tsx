"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import * as THREE from "three";
import { MAX_PEOPLE } from "@/lib/rules";
import { unlockSound } from "@/lib/sound";
import { buildWorld } from "@/lib/three/world";
import "./intro.css";

// 게임과 같은 하늘·빛. 그림자는 끄고 한 장만 그린다
function Village() {
  const { scene, camera, gl, invalidate } = useThree();

  useEffect(() => {
    gl.toneMappingExposure = 0.78;
    scene.background = new THREE.Color("#d9e3ef");
    scene.fog = new THREE.Fog("#d9e3ef", 48, 150);
    camera.lookAt(0, 3, 0);
    const root = new THREE.Group();
    const sun = new THREE.DirectionalLight("#ffe9c9", 3);
    sun.position.set(8, 14, 6);
    root.add(new THREE.HemisphereLight("#f3ecdf", "#b9c9b4", 1.6), sun);
    buildWorld(root);
    scene.add(root);
    invalidate();
    return () => {
      scene.remove(root);
      // 바위 지오메트리는 stone.ts가 캐시해 게임도 쓰지만, dispose는 이 렌더러의 GPU 버퍼만 비우므로 게임에서 다시 올라간다
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    };
  }, [scene, camera, gl, invalidate]);

  return null;
}

// channel()은 같은 topic이 목록에 남아 있으면 그 객체를 돌려준다. 나가는 중인 채널을 받으면 subscribe가 조용히 무시되므로,
// 다음 구독은 이전 채널의 해제가 끝난 뒤에 해야 한다
let closing: Promise<unknown> = Promise.resolve();

// track하지 않으므로 인트로의 방문자는 접속자로 세이지 않는다
function usePeople(db: SupabaseClient) {
  const [people, setPeople] = useState<number | null>(null);
  const stop = useRef(() => {});

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let dead = false;
    const off = () => {
      if (dead) return;
      dead = true;
      if (channel) closing = db.removeChannel(channel).catch(() => undefined);
    };
    stop.current = off;
    // StrictMode의 첫 실행은 여기 닿기 전에 정리되어 채널을 만들지 않는다
    void closing.then(() => {
      if (dead) return;
      const ch = db.channel("world");
      channel = ch;
      ch.on("presence", { event: "sync" }, () => { if (!dead) setPeople(Object.keys(ch.presenceState()).length); })
        .subscribe((status) => { if (!dead && status !== "SUBSCRIBED") setPeople(null); }); // 끊기면 옛 수로 입장을 막지 않는다
    });
    return off;
  }, [db]);

  return { people, leave: () => { stop.current(); return closing; } };
}

export function Intro({ db, onEnter }: { db: SupabaseClient; onEnter(): void }) {
  const { people, leave } = usePeople(db);
  const going = useRef(false);
  const full = people !== null && people >= MAX_PEOPLE;

  // 게임이 같은 topic을 구독하기 전에 인트로 채널을 다 내보낸다
  const enter = async () => {
    if (going.current) return;
    going.current = true;
    await leave();
    onEnter();
  };

  return (
    <div className="intro">
      <div className="intro-bg" aria-hidden="true">
        <Canvas frameloop="demand" dpr={1} gl={{ antialias: false }} camera={{ fov: 42, near: 0.1, far: 260, position: [0, 8, 20] }}>
          <Village />
        </Canvas>
      </div>
      <main className="intro-front">
        <h1><span>어서 놔요,</span> <span>소원 돌탑</span></h1>
        <p role="img" aria-label={people === null ? `정원 ${MAX_PEOPLE}명` : `현재 접속 ${people}명, 정원 ${MAX_PEOPLE}명`}>{people ?? "–"} / {MAX_PEOPLE}</p>
        <button type="button" disabled={full} onClick={() => { unlockSound(); void enter(); }}>{full ? "정원이 찼어요" : "입장"}</button>
        <a className="intro-credit" href="https://metaphr.dev" target="_blank" rel="noopener noreferrer">제작자 (C) metaphr.dev</a>
      </main>
    </div>
  );
}
