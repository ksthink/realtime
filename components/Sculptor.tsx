"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clamp, rng } from "@/lib/terrain";
import { colorize, createBodyGeometry, encodeBody, randomPalette, sculptTopology, smoothNormals } from "@/lib/three/blob";

export type SculptResult = { name: string; seed: number; top: string; bottom: string; body: string };

const SHAPES: Record<string, { label: string; fn: (v: THREE.Vector3) => THREE.Vector3 }> = {
  sphere: { label: "구", fn: (v) => v.multiplyScalar(0.85) },
  cube: {
    label: "네모",
    fn: (v) => {
      const p = 7, k = Math.pow(Math.abs(v.x) ** p + Math.abs(v.y) ** p + Math.abs(v.z) ** p, 1 / p);
      return v.multiplyScalar(0.72 / k);
    },
  },
  star: {
    label: "별",
    fn: (v) => {
      const a = Math.atan2(v.y, v.x), r = 0.62 * (1 + 0.42 * Math.cos(5 * a - Math.PI / 2)), flat = Math.abs(v.z);
      v.x *= r * 1.25; v.y *= r * 1.25; v.z *= 0.5 * (1 - 0.3 * flat ** 2);
      return v;
    },
  },
  trapezoid: {
    label: "사다리꼴",
    fn: (v) => {
      SHAPES.cube.fn(v);
      const w = 1.3 - 0.55 * ((v.y + 0.72) / 1.44);
      v.x *= w; v.z *= w * 0.85;
      return v;
    },
  },
  egg: {
    label: "달걀",
    fn: (v) => {
      v.multiplyScalar(0.8);
      const t = (v.y + 0.8) / 1.6, w = 1 + 0.12 * Math.sin(Math.PI * t) - 0.25 * t ** 2;
      v.x *= w; v.z *= w; v.y *= 1.2;
      return v;
    },
  },
  pill: {
    label: "알약",
    fn: (v) => {
      const p = 8, k = Math.pow(Math.abs(v.x) ** p + Math.abs(v.y * 0.55) ** p + Math.abs(v.z) ** p, 1 / p);
      return v.multiplyScalar(0.58 / k);
    },
  },
};

type Api = {
  shape(name: string): void;
  smooth(): void;
  recolor(): void;
  bake(): { top: string; bottom: string; body: string };
};

function Clay({ apiRef }: { apiRef: React.MutableRefObject<Api | null> }) {
  const { gl, camera } = useThree();
  const state = useMemo(() => {
    const geo = createBodyGeometry();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
    return { geo, mesh, unit: new Float32Array(geo.attributes.position.array), palette: randomPalette(rng((Math.random() * 1e9) | 0)) };
  }, []);

  useEffect(() => {
    const { geo, mesh, unit } = state;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const { members, neighbors } = sculptTopology();
    const paint = () => colorize(geo, state.palette.bottom, state.palette.top);

    const refresh = () => { pos.needsUpdate = true; smoothNormals(geo); paint(); geo.computeBoundingSphere(); };
    const shape = (name: string) => {
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.set(unit[i * 3], unit[i * 3 + 1], unit[i * 3 + 2]);
        SHAPES[name].fn(v);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      mesh.rotation.set(0, 0, 0);
      refresh();
    };
    shape("sphere");

    apiRef.current = {
      shape,
      smooth() {
        const avg = new Float32Array(members.length * 3);
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        members.forEach((_, g) => {
          a.set(0, 0, 0);
          for (const n of neighbors[g]) a.add(b.fromBufferAttribute(pos, members[n][0]));
          a.divideScalar(neighbors[g].size);
          avg[g * 3] = a.x; avg[g * 3 + 1] = a.y; avg[g * 3 + 2] = a.z;
        });
        members.forEach((m, g) => {
          a.fromBufferAttribute(pos, m[0]).lerp(b.set(avg[g * 3], avg[g * 3 + 1], avg[g * 3 + 2]), 0.6);
          for (const i of m) pos.setXYZ(i, a.x, a.y, a.z);
        });
        refresh();
      },
      recolor() { state.palette = randomPalette(rng((Math.random() * 1e9) | 0)); paint(); },
      // 지금 보이는 방향을 앞(+z)으로 굳히고, 바닥을 y=0, 키를 1.45로 맞춘다
      bake() {
        const baked = geo.clone();
        baked.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(mesh.rotation));
        baked.computeBoundingBox();
        baked.translate(0, -baked.boundingBox!.min.y, 0);
        const height = baked.boundingBox!.max.y - baked.boundingBox!.min.y;
        if (height > 0) baked.scale(1.45 / height, 1.45 / height, 1.45 / height);
        return { top: `#${state.palette.top.getHexString()}`, bottom: `#${state.palette.bottom.getHexString()}`, body: encodeBody(baked) };
      },
    };

    // 드래그: 몸통 위면 밀고 당기기, 빈 곳이면 돌리기
    const el = gl.domElement;
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(), pt = new THREE.Vector3(), tmp = new THREE.Vector3();
    let drag: { id: number; mode: "rotate"; x: number; y: number } | { id: number; mode: "deform"; last: THREE.Vector3; center: THREE.Vector3 } | null = null;
    const pointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      ray.setFromCamera(pointer(e), camera);
      const h = ray.intersectObject(mesh, false)[0];
      if (h) {
        plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), h.point);
        const local = mesh.worldToLocal(h.point.clone());
        drag = { id: e.pointerId, mode: "deform", last: local, center: local.clone() };
      } else drag = { id: e.pointerId, mode: "rotate", x: e.clientX, y: e.clientY };
      draggingRef.current = true;
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.mode === "rotate") {
        mesh.rotation.y += (e.clientX - drag.x) * 0.01;
        mesh.rotation.x = clamp(mesh.rotation.x + (e.clientY - drag.y) * 0.01, -1.2, 1.2);
        drag.x = e.clientX; drag.y = e.clientY;
        return;
      }
      ray.setFromCamera(pointer(e), camera);
      if (!ray.ray.intersectPlane(plane, pt)) return;
      const now = mesh.worldToLocal(pt.clone()), d = now.clone().sub(drag.last);
      drag.last.copy(now);
      if (d.length() > 0.25) d.setLength(0.25);
      const R = 0.9;
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i);
        const q = 1 - Math.min(1, tmp.distanceTo(drag.center) / R);
        if (q <= 0) continue;
        tmp.addScaledVector(d, q * q * (3 - 2 * q) * 0.85);
        const L = tmp.length();
        tmp.setLength(clamp(L, 0.3, 1.7));
        pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
      }
      drag.center.add(d);
      refresh();
    };
    const up = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) { drag = null; draggingRef.current = false; }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      apiRef.current = null;
    };
  }, [state, gl, camera, apiRef]);

  const draggingRef = useRef(false);
  const jelly = useRef(0);
  useFrame((_, dt) => {
    jelly.current += dt;
    if (draggingRef.current) return;
    const s = Math.sin(jelly.current * 2.4) * 0.015;
    state.mesh.scale.set(1 + s, 1 - s, 1 + s);
    state.mesh.rotation.y += dt * 0.15;
  });

  return <primitive object={state.mesh} />;
}

export function Sculptor({ busy, error, onDone }: { busy: boolean; error: string; onDone(r: SculptResult): void }) {
  const api = useRef<Api | null>(null);
  const [shape, setShape] = useState("sphere");
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const finish = () => {
    const baked = api.current?.bake();
    if (baked && trimmed) onDone({ name: trimmed, seed: (Math.random() * 2147483647) | 0, ...baked });
  };

  return (
    <div className="stage">
      <Canvas camera={{ fov: 38, near: 0.1, far: 50, position: [0, 0.15, 5] }} onCreated={({ scene }) => { scene.background = new THREE.Color("#e6edf6"); }}>
        <hemisphereLight args={["#fff6e8", "#f2c7c0", 2.2]} />
        <directionalLight position={[3, 5, 4]} intensity={3.4} color="#fff4e0" />
        <directionalLight position={[-4, 2, -3]} intensity={1.2} color="#dfe8ff" />
        <Clay apiRef={api} />
      </Canvas>
      <div className="sculpt">
        <div>
          <h1>말랑이를 빚어 주세요</h1>
          <p>몸통을 드래그해 밀고 당기고, 빈 곳을 드래그해 돌려요. 확인을 누를 때 보이는 쪽이 얼굴이 돼요.</p>
          <div className="shapes" role="group" aria-label="처음 모양">
            {Object.entries(SHAPES).map(([key, s]) => (
              <button type="button" key={key} className={shape === key ? "on" : ""} onClick={() => { setShape(key); api.current?.shape(key); }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <form className="sculpt-foot" onSubmit={(e) => { e.preventDefault(); finish(); }}>
          {error && <p className="error" role="alert">{error}</p>}
          <label className="name-field">
            <span>마을에서 쓸 이름</span>
            <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="예: 감자" autoComplete="off" />
          </label>
          <div className="tools">
            <button type="button" onClick={() => api.current?.smooth()}>매끈하게</button>
            <button type="button" onClick={() => api.current?.recolor()}>다른 색</button>
            <button type="button" onClick={() => api.current?.shape(shape)}>처음부터</button>
            <button type="submit" className="go" disabled={busy || !trimmed}>{busy ? "들어가는 중…" : "마을로 들어가기"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
