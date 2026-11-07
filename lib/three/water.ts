import * as THREE from "three";

// 조절값. 크면 파도처럼 보이니 조금씩만 바꾼다
const RIPPLE_SLOPE = 0.03; // 법선 기울기(햇빛 일렁임 세기)
const RIPPLE_SHADE = 0.022; // 밝기 흔들림 세기
const RIPPLE_SPEED = 0.16; // 물결이 흐르는 속도(유닛/초)
const FADE_NEAR = 22; // 이 거리부터 멀어질수록 물결을 줄인다
const FADE_FAR = 75; // 이 거리 밖은 물결 없음(먼 곳 깜빡임 방지)
// 깊이에 따른 물빛. 물이 빛을 흡수하는 것처럼 깊이에 따라 지수적으로 짙어져, 물가에서는 투명하게 시작한다
const ABSORB = 0.95; // 클수록 얕은 곳부터 빨리 짙어진다
const ALPHA_MAX = 0.9; // 가장 깊은 곳의 불투명도
const DEPTH_RANGE = 4; // 깊이 지도에 담는 최대 깊이(유닛)
const COLOR_SHALLOW = new THREE.Color("#4fa3a6"), COLOR_DEEP = new THREE.Color("#3f7ea8"); // 얕은 곳은 청록, 깊은 곳은 파랑

// 물결 4개: 방향(라디안)과 파장(유닛)
const WAVES = [
  { dir: 0.5, len: 3.1 },
  { dir: 2.1, len: 1.9 },
  { dir: 3.7, len: 1.23 },
  { dir: 5.2, len: 0.83 },
];

const vec4 = (f: (w: (typeof WAVES)[number]) => number) => `vec4(${WAVES.map((w) => f(w).toFixed(4)).join(",")})`;

const uPhase = { value: new THREE.Vector4() };
// 하늘 분위기: 물빛을 이 색 쪽으로 k만큼 끌어간다(낮 0, 노을에 살짝 따뜻하게, 밤에 푸르고 어둡게). daytime.ts가 정한다
export const waterMood = { color: { value: new THREE.Color() }, k: { value: 0 } };
const glslColor = (c: THREE.Color) => `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`;

// 지형 메시의 높이(격자 n×n, 한 변 size)로 수면 아래 깊이 지도를 만든다. 지형을 다시 계산하지 않는다
function depthMap(heights: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, n: number, waterY: number) {
  const data = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) data[i] = Math.round((Math.min(1, Math.max(0, waterY - heights.getY(i)) / DEPTH_RANGE)) * 255);
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function waterMaterial(heights: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, n: number, size: number, waterY: number) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05, transparent: true });
  const uDepth = { value: depthMap(heights, n, waterY) };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uWaterPhase = uPhase;
    s.uniforms.uWaterDepth = uDepth;
    s.uniforms.uMoodCol = waterMood.color;
    s.uniforms.uMoodK = waterMood.k;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWaterXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWaterXZ = (modelMatrix * vec4(position, 1.0)).xz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWaterXZ;\nuniform vec4 uWaterPhase;\nuniform sampler2D uWaterDepth;\nuniform vec3 uMoodCol;\nuniform float uMoodK;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float wDepth = texture2D(uWaterDepth, vWaterXZ / ${(size * 2).toFixed(1)} + 0.5).r * ${DEPTH_RANGE.toFixed(1)};
        float wAbsorb = 1.0 - exp(-${ABSORB.toFixed(2)} * wDepth);
        diffuseColor.rgb = mix(mix(${glslColor(COLOR_SHALLOW)}, ${glslColor(COLOR_DEEP)}, wAbsorb), uMoodCol, uMoodK);
        diffuseColor.a = ${ALPHA_MAX.toFixed(2)} * wAbsorb;
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
