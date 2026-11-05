import * as THREE from "three";

// 조절값. 크면 파도처럼 보이니 조금씩만 바꾼다
const RIPPLE_SLOPE = 0.03; // 법선 기울기(햇빛 일렁임 세기)
const RIPPLE_SHADE = 0.022; // 밝기 흔들림 세기
const RIPPLE_SPEED = 0.16; // 물결이 흐르는 속도(유닛/초)
const FADE_NEAR = 22; // 이 거리부터 멀어질수록 물결을 줄인다
const FADE_FAR = 75; // 이 거리 밖은 물결 없음(먼 곳 깜빡임 방지)

// 물결 4개: 방향(라디안)과 파장(유닛)
const WAVES = [
  { dir: 0.5, len: 3.1 },
  { dir: 2.1, len: 1.9 },
  { dir: 3.7, len: 1.23 },
  { dir: 5.2, len: 0.83 },
];

const vec4 = (f: (w: (typeof WAVES)[number]) => number) => `vec4(${WAVES.map((w) => f(w).toFixed(4)).join(",")})`;

const uPhase = { value: new THREE.Vector4() };

export function waterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: "#8fb8da", roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.82 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uWaterPhase = uPhase;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWaterXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWaterXZ = (modelMatrix * vec4(position, 1.0)).xz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWaterXZ;\nuniform vec4 uWaterPhase;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        // 사인 4개를 살짝 비틀어 값싼 노이즈처럼 쓴다. 기울기는 식으로 바로 얻는다
        vec2 wp = vWaterXZ + 0.8 * sin(vWaterXZ.yx * 0.23);
        vec4 wa = ${vec4((w) => (Math.cos(w.dir) * Math.PI * 2) / w.len)} * wp.x + ${vec4((w) => (Math.sin(w.dir) * Math.PI * 2) / w.len)} * wp.y + uWaterPhase;
        vec4 ws = sin(wa), wc = cos(wa);
        float wFade = 1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, length(vViewPosition));
        diffuseColor.rgb *= 1.0 + ${RIPPLE_SHADE.toFixed(4)} * wFade * dot(ws, vec4(0.5));`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec2 wg = ${RIPPLE_SLOPE.toFixed(4)} * wFade * vec2(dot(wc, ${vec4((w) => Math.cos(w.dir))}), dot(wc, ${vec4((w) => Math.sin(w.dir))}));
        normal = normalize((viewMatrix * vec4(-wg.x, 1.0, -wg.y, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => "water";
  return mat;
}

// 위상을 물결별로 한 바퀴씩 감으므로 오래 켜 두거나 탭이 돌아와도 끊기지 않는다
export function tickWater() {
  const t = performance.now() / 1000;
  const phase = (i: number) => (((t * RIPPLE_SPEED) / WAVES[i].len) % 1) * Math.PI * 2;
  uPhase.value.set(phase(0), phase(1), phase(2), phase(3));
}
