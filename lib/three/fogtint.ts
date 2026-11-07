import * as THREE from "three";
import type { DayState } from "./daytime";

// 해 쪽 안개빛(대기 원근): 낮게 걸린 해 쪽 안개는 노을빛으로 물들고, 반대쪽은 조금 푸르게 식는다. 밤에는 달 쪽만 살짝 밝다.
// three의 안개 셰이더 조각을 고쳐 안개를 쓰는 모든 기본 재질(Standard·Basic·Lambert·Sprite·Points…)이 함께 받는다.
// 값은 모든 재질이 같은 Float32Array를 나눠 가진다(UniformsUtils.clone은 배열이 아닌 형식 배열을 복사하지 않는다).
// three는 안개를 sRGB로 바꾼 뒤에 섞으므로(fogColor도 sRGB) 색 값도 sRGB로 둔다. 선형으로 섞는 셰이더는 fogTintLinear()를 쓴다.
// 하늘(sky.ts)과 먼 산(skyline.ts)도 같은 fogTint()를 써서 지평선에서 이음매가 없다. 한낮은 세기가 0이라 예전 그대로다.

const sun = new Float32Array(4); // xy: 해의 수평 방향(x, z), z: 노을 세기, w: 반대쪽 푸른 세기
const glow = new Float32Array(3), cool = new Float32Array(3);
const moon = new Float32Array(4); // xy: 달의 수평 방향, z: 세기
const moonCol = new Float32Array(3);
export const fogTintUniforms = {
  fogTSun: { value: sun }, fogTGlow: { value: glow }, fogTCool: { value: cool }, fogTMoon: { value: moon }, fogTMoonCol: { value: moonCol },
};

// dir: 카메라에서 본 월드 방향(정규화 안 해도 된다)
export const FOG_TINT_GLSL = /* glsl */ `
uniform vec4 fogTSun; uniform vec3 fogTGlow; uniform vec3 fogTCool; uniform vec4 fogTMoon; uniform vec3 fogTMoonCol;
vec3 fogTint(vec3 base, vec3 dir) {
  vec3 d = normalize(dir);
  vec2 h = normalize(d.xz + 1e-4);
  float low = 1.0 - smoothstep(-0.05, 0.45, d.y);
  float az = dot(h, fogTSun.xy) * 0.5 + 0.5, aw = 1.0 - az;
  vec3 c = mix(base, fogTCool, fogTSun.w * aw * aw * low);
  c = mix(c, fogTGlow, fogTSun.z * az * az * az * low);
  float am = dot(h, fogTMoon.xy) * 0.5 + 0.5; am *= am;
  return mix(c, fogTMoonCol, fogTMoon.z * am * am * low);
}
vec3 fogTintLinear(vec3 base, vec3 dir) {
  return sRGBTransferEOTF(vec4(fogTint(sRGBTransferOETF(vec4(base, 1.0)).rgb, dir), 1.0)).rgb;
}
`;

const C = THREE.ShaderChunk as Record<string, string>;
if (!C.fog_pars_fragment.includes("fogTint")) {
  C.fog_pars_vertex = C.fog_pars_vertex.replace("varying float vFogDepth;", "varying float vFogDepth;\n\tvarying vec3 vFogDir;");
  C.fog_vertex = C.fog_vertex.replace("vFogDepth = - mvPosition.z;", "vFogDepth = - mvPosition.z;\n\tvFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;");
  C.fog_pars_fragment = C.fog_pars_fragment.replace("varying float vFogDepth;", "varying float vFogDepth;\n\tvarying vec3 vFogDir;\n" + FOG_TINT_GLSL);
  C.fog_fragment = C.fog_fragment.replace("mix( gl_FragColor.rgb, fogColor, fogFactor )", "mix( gl_FragColor.rgb, fogTint( fogColor, vFogDir ), fogFactor )");
  for (const s of Object.values(THREE.ShaderLib)) if (s.uniforms.fogColor) Object.assign(s.uniforms, fogTintUniforms);
}

const _cool = new THREE.Color(), _o = { r: 0, g: 0, b: 0 }, MOON_COL = new THREE.Color("#dde3ff");
const srgb = (c: THREE.Color, out: Float32Array) => { c.getRGB(_o, THREE.SRGBColorSpace); out[0] = _o.r; out[1] = _o.g; out[2] = _o.b; };
const horiz = (v: THREE.Vector3, out: Float32Array) => {
  const l = Math.hypot(v.x, v.z) || 1;
  out[0] = v.x / l; out[1] = v.z / l;
};
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 매 프레임 지금 하늘에 맞춘다
export function updateFogTint(d: DayState) {
  horiz(d.sunDir, sun);
  sun[2] = d.glowK;
  sun[3] = d.glowK * 0.85;
  srgb(d.glow, glow);
  srgb(_cool.copy(d.horizon).lerp(d.sky, 0.85), cool); // 반대쪽은 위쪽 하늘빛 쪽으로
  horiz(d.moonDir, moon);
  moon[2] = 0.16 * d.night * (0.25 + 0.75 * d.moonLit) * smooth(-2, 8, d.moonAlt);
  srgb(_cool.copy(d.horizon).lerp(MOON_COL, 0.6), moonCol);
}
