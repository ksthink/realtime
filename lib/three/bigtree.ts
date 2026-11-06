import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng, terrainY } from "../terrain";
import { WIND_DIR } from "./petals";

// 동산 꼭대기의 큰 나무. 줄기·뿌리·가지는 한 메시, 수관은 인스턴싱 한 번이라 그리기 호출이 둘이다(그림자 포함 넷)

// 크기(m). 수관 맨 아래를 땅에서 5.3m 위에 둬서, 기본 거리의 따라가기 카메라(캐릭터 위 4.7m)가 잎 아래에 남는다
const LOW = 5.3, TRUNK_H = 7, TRUNK_R0 = 0.58, TRUNK_R1 = 0.3;
// 바람 세기. 큰 나무는 작은 나무(0.035)보다 무겁게, 위쪽만 조금 흔들린다
const SWAY = 0.05, RIPPLE = 0.006;
// 카메라와 캐릭터 사이를 가리는 잎을 비우는 원뿔. 캐릭터 자리에서의 반지름(m)과 거리에 대한 비율
const SEE_R = 2.0, SEE_CONE = 0.24;

const f = (v: number) => v.toFixed(4);

// world.ts의 바람과 같은 식. 나무 전체가 한 덩어리로 흔들리도록 위치는 나무 중심을 쓴다
const WIND_GLSL = `
uniform float uWindTime;
uniform vec2 uTreeXZ;
uniform float uTreeY;
vec2 windAt(vec2 p) {
  float gust = 0.65 + 0.35 * sin(uWindTime * 0.21 + p.x * 0.04 + p.y * 0.06);
  float a = sin(uWindTime * 0.9 + dot(p, vec2(0.31, 0.23)));
  float b = sin(uWindTime * 1.6 + dot(p, vec2(-0.47, 0.71)));
  vec2 dir = vec2(${f(WIND_DIR[0])}, ${f(WIND_DIR[1])});
  return gust * (dir * (0.7 * a + 0.3 * b) + vec2(-dir.y, dir.x) * 0.25 * b);
}
`;
// 위로 갈수록 크게(밑동 0). 덩어리마다 위상을 조금 달리해 잎이 살짝 일렁인다
const CANOPY_WIND = `
  vec2 wind = windAt(uTreeXZ);
  vec3 base = instanceMatrix[3].xyz;
  float up = clamp((base.y - uTreeY + position.y * 2.0 - 4.0) / 6.0, 0.0, 1.0);
  transformed.xz += wind * ${f(SWAY)} * up / max(instanceMatrix[0].x, 0.5);
  transformed *= 1.0 + ${f(RIPPLE)} * sin(uWindTime * 1.7 + dot(position, vec3(2.3, 3.1, 1.7)) + base.x + base.z);`;

// 카메라에서 캐릭터를 보는 선 둘레의 조각을 디더링으로 지운다. 반투명 정렬 문제 없이 부드럽게 비어 보인다
const SEE_GLSL = `
uniform vec3 uCam;
uniform vec3 uFocus;
uniform float uSee;
varying vec3 vSeeW;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
`;
// line이 거짓이면 카메라 바로 앞만 비운다(줄기는 가려도 자연스럽고, 디더링된 줄기가 더 어색하다)
const seeCut = (line: boolean) => `
  if (uSee > 0.5) {
    float hole = 0.0;${line ? `
    vec3 ab = uFocus - uCam;
    float t = clamp(dot(vSeeW - uCam, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float d = length(vSeeW - uCam - ab * t), R = min(${f(SEE_R)}, ${f(SEE_CONE)} * t * length(ab)) + 0.3;
    hole = (1.0 - smoothstep(R * 0.7, R, d)) * (1.0 - smoothstep(0.65, 0.85, t));` : ""}
    hole = max(hole, 1.0 - smoothstep(0.6, 1.8, distance(vSeeW, uCam))); // 카메라 바로 앞의 잎
    if (hole > bayer4(gl_FragCoord.xy) + 0.03) discard;
  }`;

// 화면에 그리는 재질에 바람·비우기를, 그림자 재질에는 바람만 넣는다
function patch<M extends THREE.Material>(mat: M, key: string, u: Record<string, THREE.IUniform>, wind: string, see: boolean, line = true) {
  mat.customProgramCacheKey = () => `bigtree-${key}`;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    let vs = WIND_GLSL + (see ? "varying vec3 vSeeW;\n" : "") + s.vertexShader;
    vs = vs.replace("#include <begin_vertex>", `#include <begin_vertex>\n${wind}`);
    if (see) {
      vs = vs.replace("#include <project_vertex>", `#include <project_vertex>
      #ifdef USE_INSTANCING
        vSeeW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vSeeW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
      s.fragmentShader = SEE_GLSL + s.fragmentShader.replace("void main() {", `void main() {${seeCut(line)}`);
    }
    s.vertexShader = vs;
  };
  return mat;
}

// 위쪽이 가늘고 밑동이 퍼지는 줄기. 마디마다 살짝 휘게 한다
function trunkGeometry(r: () => number) {
  const g = new THREE.CylinderGeometry(TRUNK_R1, TRUNK_R0, TRUNK_H, 10, 6);
  g.translate(0, TRUNK_H / 2, 0);
  const p = g.attributes.position, lean = [(r() - 0.5) * 0.5, (r() - 0.5) * 0.5];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = y / TRUNK_H;
    const flare = 1 + 0.45 * Math.exp(-y / 0.45); // 밑동이 뿌리로 넓어진다
    const bend = Math.sin(k * Math.PI) * 0.18;
    p.setX(i, p.getX(i) * flare + lean[0] * k * k + bend * 0.6);
    p.setZ(i, p.getZ(i) * flare + lean[1] * k * k - bend * 0.4);
  }
  g.computeVertexNormals();
  return { g, top: new THREE.Vector3(lean[0], TRUNK_H, lean[1]) };
}

// from에서 to로 뻗는 원뿔대
function limb(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, seg = 7, open = true) {
  const len = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
  g.translate(from.x, from.y, from.z);
  return g;
}

export function buildBigTree(root: THREE.Object3D, x: number, z: number, windTime: { value: number }) {
  const r = rng(4021), y0 = terrainY(x, z);
  const u = { uWindTime: windTime, uTreeXZ: { value: new THREE.Vector2(x, z) }, uTreeY: { value: y0 }, uCam: seeThrough.cam, uFocus: seeThrough.focus, uSee: seeThrough.on };

  // 줄기·뿌리·가지
  const { g: trunk, top } = trunkGeometry(r);
  const parts: THREE.BufferGeometry[] = [trunk];
  // 뿌리는 땅을 따라 낮게 퍼지도록 세로로 눌러 둔다. 끝은 비탈이어도 땅속에 묻힌다
  const roots = 6, flat = 0.55;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots + (r() - 0.5) * 0.08) * Math.PI * 2, len = 1.25 + r() * 0.25;
    const tx = Math.cos(a) * len, tz = Math.sin(a) * len;
    const tip = new THREE.Vector3(tx, (terrainY(x + tx, z + tz) - y0 + 0.15 - 0.12) / flat, tz);
    const from = new THREE.Vector3(Math.cos(a) * 0.2, 1.1 + r() * 0.3, Math.sin(a) * 0.2);
    parts.push(limb(from, tip, 0.34, 0.05, 7).scale(1, flat, 1));
  }
  const branches = [
    { a: 0.4, y: 4.3, out: 2.6, up: 2.2 },
    { a: 2.5, y: 4.8, out: 2.4, up: 2.3 },
    { a: 4.4, y: 4.5, out: 2.7, up: 2.1 },
  ];
  for (const b of branches) {
    const a = b.a + (r() - 0.5) * 0.3, k = b.y / TRUNK_H;
    const bend = Math.sin(k * Math.PI) * 0.18; // 줄기 축을 따라 붙인다
    const from = new THREE.Vector3(top.x * k * k + bend * 0.6, b.y, top.z * k * k - bend * 0.4);
    const to = from.clone().add(new THREE.Vector3(Math.cos(a) * b.out, b.up, Math.sin(a) * b.out));
    parts.push(limb(from, to, 0.2, 0.08, 7, false)); // 끝이 잎 사이로 보일 수 있어 막는다
  }
  const wood = new THREE.Mesh(
    mergeGeometries(parts.map((g) => g.toNonIndexed())),
    patch(new THREE.MeshStandardMaterial({ color: "#8b6a52", roughness: 1 }), "wood", u, "", true, false),
  );
  parts.forEach((g) => g.dispose());
  wood.position.set(x, y0 - 0.15, z); // 평평하지 않아도 밑동이 뜨지 않게 조금 묻는다
  wood.castShadow = wood.receiveShadow = true;
  root.add(wood);

  // 수관: 아래 고리, 위 고리, 가운데, 꼭대기. 아래쪽 덩어리는 조금 어둡게 해 그늘진 느낌을 준다
  const blobs: { x: number; y: number; z: number; s: number }[] = [{ x: 0, y: LOW + 2.6, z: 0, s: 2.7 }, { x: 0.2, y: LOW + 4.2, z: -0.1, s: 1.8 }];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r() * 0.4, d = 2.9 + r() * 0.5, s = 1.9 + r() * 0.35;
    blobs.push({ x: Math.cos(a) * d, y: LOW + s * 0.85 + r() * 0.4, z: Math.sin(a) * d, s });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4 + 0.12) * Math.PI * 2 + r() * 0.3, d = 1.7 + r() * 0.4;
    blobs.push({ x: Math.cos(a) * d, y: LOW + 3.2 + r() * 0.5, z: Math.sin(a) * d, s: 1.8 + r() * 0.3 });
  }
  const leafMat = patch(new THREE.MeshStandardMaterial({ roughness: 0.95 }), "leaf", u, CANOPY_WIND, true);
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 13), leafMat, blobs.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  blobs.forEach((b, i) => {
    o.position.set(x + b.x + top.x, y0 + b.y, z + b.z + top.z);
    o.scale.set(b.s * 1.1, b.s * 0.85, b.s * 1.1);
    o.updateMatrix();
    leaves.setMatrixAt(i, o.matrix);
    leaves.setColorAt(i, c.setHSL(0.27 + r() * 0.07, 0.5, 0.42 + (b.y - LOW) / 5 * 0.12 + r() * 0.04));
  });
  leaves.castShadow = leaves.receiveShadow = true;
  leaves.customDepthMaterial = patch(new THREE.MeshDepthMaterial(), "leaf-depth", u, CANOPY_WIND, false);
  root.add(leaves);
  // 카메라 위치는 그릴 때마다 받는다
  wood.onBeforeRender = leaves.onBeforeRender = (_r, _s, cam) => { seeThrough.cam.value.copy(cam.position); };
  return { wood, leaves };
}

// 캐릭터를 가리는 잎을 비우는 기준. 게임이 매 프레임 바라보는 점을 넣는다. 넣지 않으면(인트로) 꺼져 있다
export const seeThrough = {
  cam: { value: new THREE.Vector3() },
  focus: { value: new THREE.Vector3() },
  on: { value: 0 },
  set(v: THREE.Vector3) { this.focus.value.copy(v); this.on.value = 1; },
};
