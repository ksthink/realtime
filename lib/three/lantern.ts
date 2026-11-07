import * as THREE from "three";

// ── 밤에 드는 작은 랜턴 ──
// 어두워지면 저절로 왼손에 나타나 불이 켜지고, 밝아지면 꺼지며 사라진다.
// 손을 비워야 할 때는 잠깐(돌 줍기·나르기·쌓기, 얼굴 가리기) 허리에 걸고, 오래 머물 때(합장, 앉기)는 옆 땅에 세워 둔다. 끝나면 다시 손에 든다.
// 모든 캐릭터의 랜턴에 은은한 빛 번짐(스프라이트)을 그린다. 땅을 비추는 진짜 빛은 game.ts가 내 랜턴에만(PC) 단다.
// 밤 깊이는 모두에게 같으므로 재질은 함께 쓰고 tickLanterns가 한 번에 밝기를 바꾼다

const H = 0.2; // 손잡이 꼭대기에서 바닥까지(랜턴은 손잡이에 매달려 아래로 늘어진다)
const MOVE = 0.32; // 손 ↔ 허리 ↔ 땅으로 옮기는 시간(초)
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const frameMat = new THREE.MeshStandardMaterial({ color: "#8a6a55", roughness: 0.8 });
const glassMat = new THREE.MeshBasicMaterial({ color: "#d8cdb6" }); // 불이 켜지면 따뜻한 빛으로 바뀐다
const glowMat = new THREE.SpriteMaterial({ color: "#ffcf86", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }); // 무늬는 처음 만들 때 넣는다(서버에는 canvas가 없다)
const OFF = new THREE.Color("#d8cdb6"), ON = new THREE.Color("#ffe6a8");
// 손잡이 고리 → 지붕 → 유리 → 바닥. 원점이 손잡이 꼭대기
const parts: [THREE.BufferGeometry, THREE.Material][] = [
  [new THREE.TorusGeometry(0.028, 0.006, 5, 12, Math.PI).translate(0, -0.028, 0), frameMat],
  [new THREE.ConeGeometry(0.062, 0.045, 8).translate(0, -0.05, 0), frameMat],
  [new THREE.CylinderGeometry(0.046, 0.046, 0.105, 8).translate(0, -0.125, 0), glassMat],
  [new THREE.CylinderGeometry(0.058, 0.052, 0.022, 8).translate(0, -0.189, 0), frameMat],
];

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 랜턴이 보이는 정도(0~1)와 불 밝기. 매 프레임 game.ts가 밤 깊이(0~1)를 넣는다
export const lanternLit = { show: 0, light: 0 };
export function tickLanterns(night: number) {
  lanternLit.show = smooth(0.3, 0.5, night);
  lanternLit.light = smooth(0.35, 0.65, night);
  glassMat.color.copy(OFF).lerp(ON, lanternLit.light);
  glowMat.opacity = 0.55 * lanternLit.light;
}

export type LanternMode = "hand" | "hip" | "ground";
export type Lantern = {
  g: THREE.Group; // 캐릭터 그룹(blob.g)의 자식
  mode: LanternMode; k: number; from: THREE.Vector3; // 옮기는 중이면 k < 1
  swing: number; swingV: number; // 흔들림(라디안)과 그 속도
};

export function makeLantern(parent: THREE.Object3D): Lantern {
  glowMat.map ??= glowTexture();
  const g = new THREE.Group();
  for (const [geo, mat] of parts) g.add(new THREE.Mesh(geo, mat));
  const glow = new THREE.Sprite(glowMat);
  glow.position.y = -0.125;
  glow.scale.setScalar(0.75);
  g.add(glow);
  g.visible = false;
  parent.add(g);
  return { g, mode: "hand", k: 1, from: new THREE.Vector3(), swing: 0, swingV: 0 };
}

// target: 이번 프레임에 랜턴이 있어야 할 자리(캐릭터 그룹 안 좌표, 손잡이 꼭대기). walk: 걷기 위상
export function updateLantern(l: Lantern, dt: number, mode: LanternMode, target: THREE.Vector3, moving: boolean, walk: number) {
  const show = lanternLit.show;
  l.g.visible = show > 0.01;
  if (!l.g.visible) { l.g.position.copy(target); l.mode = mode; l.k = 1; return; }
  l.g.scale.setScalar(show);
  if (mode !== l.mode) { l.from.copy(l.g.position); l.mode = mode; l.k = 0; }
  if (l.k < 1) {
    // 손에서 허리·땅으로 살짝 들어 올렸다 내려놓듯 옮긴다
    l.k = Math.min(1, l.k + dt / MOVE);
    const e = l.k * l.k * (3 - 2 * l.k);
    l.g.position.lerpVectors(l.from, target, e);
    l.g.position.y += Math.sin(l.k * Math.PI) * 0.08;
  } else l.g.position.copy(target);
  // 걸으면 손잡이에 매달린 채 앞뒤로 달랑달랑. 땅에 세우면 멈춘다
  const want = mode === "ground" ? 0 : moving ? Math.sin(walk) * (mode === "hip" ? 0.35 : 0.22) : 0;
  l.swingV += ((want - l.swing) * 60 - l.swingV * 6) * dt;
  l.swing += l.swingV * dt;
  if (mode === "ground") l.swing *= 0.8;
  l.g.rotation.x = l.swing;
}

export const LANTERN_H = H;
