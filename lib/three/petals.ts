import * as THREE from "three";
import { rng } from "../terrain";

// 바람 방향(x, z). 나무·꽃의 흔들림과 꽃잎의 흐름이 같은 방향을 쓴다
export const WIND_DIR = [0.8, 0.6] as const;

// 꽃잎 세기: 개수, 플레이어 둘레 범위(한 변, m), 크기(반지름에 가까운 값, m), 흐르고 떨어지는 속도(m/s)
const COUNT = 48;
const BOX = 24;
const SIZE_MIN = 0.055, SIZE_MAX = 0.085;
const DRIFT = 0.45, FALL = 0.22;
// 한 주기(초) 가운데 공중에 떠 있는 비율. 낮추면 더 드문드문해진다
const PERIOD_MIN = 14, PERIOD_MAX = 24, DUTY = 0.5;
// 분홍, 흰색, 연노랑, 연보라, 살구. 셰이더가 그대로 내보내므로 화면에 보일 색이다
const COLORS = [[0.96, 0.76, 0.81], [0.95, 0.93, 0.89], [0.95, 0.89, 0.63], [0.82, 0.76, 0.93], [0.96, 0.81, 0.69]];

const f = (v: number) => v.toFixed(4);

// 위치 배열을 고치지 않고 시간으로 계산한다. 꽃잎은 월드에 머물고, 플레이어 둘레 상자를 벗어나면 반대편으로 돌아온다
export function makePetals() {
  // uTint: 지금 하늘빛(시간대)으로 꽃잎 색을 물들인다. 한낮엔 흰색(1, 1, 1)이라 예전 색 그대로다
  const uniforms = { uTime: { value: 0 }, uPx: { value: 1000 }, uCenter: { value: new THREE.Vector3() }, uTint: { value: new THREE.Color(1, 1, 1) } };
  const r = rng(97);
  const seeds = new Float32Array(COUNT * 4), colors = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    seeds.set([r(), r(), r(), r()], i * 4);
    colors.set(COLORS[i % COLORS.length], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: `
        uniform float uTime;
        uniform float uPx;
        uniform vec3 uCenter;
        uniform vec3 uTint;
        attribute vec4 aSeed;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying vec2 vRot;
        varying float vWidth;
        varying float vA;
        void main() {
          float phase = aSeed.w;
          float period = mix(${f(PERIOD_MIN)}, ${f(PERIOD_MAX)}, fract(phase * 7.13));
          float raw = uTime / period + phase;
          float life = fract(raw) / ${f(DUTY)};
          vColor = aColor * uTint; vRot = vec2(1.0, 0.0); vWidth = 0.2; vA = 0.0;
          // 쉬는 동안은 화면 밖으로 보낸다
          if (life > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return; }
          float sec = life * period * ${f(DUTY)};
          float a = phase * 6.283 + sec * 0.9;
          // 주기마다 출발점을 옮겨 같은 자리를 반복하지 않게 한다
          vec2 xz = (aSeed.xy + fract(floor(raw) * 0.618)) * ${f(BOX)}
            + vec2(${f(WIND_DIR[0])}, ${f(WIND_DIR[1])}) * ${f(DRIFT)} * sec
            + vec2(cos(a), sin(a)) * 0.35;
          xz = mod(xz - uCenter.xz + ${f(BOX / 2)}, ${f(BOX)}) - ${f(BOX / 2)};
          float y = uCenter.y + 1.5 + aSeed.z * 3.0 - ${f(FALL)} * sec + sin(a * 1.3) * 0.1;
          vec4 mv = viewMatrix * vec4(uCenter.x + xz.x, y, uCenter.z + xz.y, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = mix(${f(SIZE_MIN)}, ${f(SIZE_MAX)}, fract(phase * 3.7));
          gl_PointSize = clamp(uPx * projectionMatrix[1][1] * size / -mv.z, 2.0, uPx * 0.03);
          // 날아다니며 뒤집히는 모습: 돌면서 폭이 좁아졌다 넓어진다
          float spin = phase * 20.0 + sec * 0.7;
          vRot = vec2(cos(spin), sin(spin));
          vWidth = mix(0.14, 0.3, abs(sin(sec * 1.4 + phase * 9.0)));
          // 나타나고 사라질 때, 상자 가장자리에서, 카메라 바로 앞에서 흐려진다
          vA = 0.9 * smoothstep(0.0, 0.15, life) * smoothstep(1.0, 0.8, life)
            * smoothstep(1.0, 0.7, length(xz) / ${f(BOX / 2)})
            * smoothstep(1.2, 3.0, -mv.z);
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying vec2 vRot;
        varying float vWidth;
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          q = vec2(vRot.x * q.x - vRot.y * q.y, vRot.y * q.x + vRot.x * q.y);
          // 한쪽이 좁은 꽃잎 모양
          float e = length(vec2(q.x / (vWidth * (0.75 + q.y)), q.y / 0.5));
          gl_FragColor = vec4(vColor, smoothstep(1.0, 0.75, e) * vA);
        }`,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = 1; // 물보다 뒤에 그려야 물색에 덮이지 않는다
  const size = new THREE.Vector2();
  points.onBeforeRender = (renderer) => { uniforms.uPx.value = renderer.getDrawingBufferSize(size).y; };

  let placed = false;
  return {
    points,
    // tint: 시간대 빛깔(한낮 = 흰색). 넘기지 않으면 그대로 둔다
    update(dt: number, center: THREE.Vector3, tint?: THREE.Color) {
      uniforms.uTime.value += dt;
      if (tint) uniforms.uTint.value.copy(tint);
      const c = uniforms.uCenter.value;
      // 오르막에서 꽃잎이 플레이어와 함께 출렁이지 않도록 높이만 천천히 따라간다
      c.set(center.x, placed ? c.y + (center.y - c.y) * Math.min(1, dt * 0.8) : center.y, center.z);
      placed = true;
    },
    dispose() {
      geo.dispose();
      points.material.dispose();
    },
  };
}
