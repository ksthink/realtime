import * as THREE from "three";
import type { DayState } from "./daytime";
import { LINES, STARS } from "./stars";

// 하늘: 둥근 하늘(높이에 따른 빛깔 + 해·달 원반 + 해 쪽 노을빛)과 별·별자리 선. 산줄기처럼 카메라를 따라다니고,
// 산줄기보다 먼저 그리며 깊이를 쓰지 않아 해·달·별이 산 뒤로 진다. 그리기 호출 3번

const R = 190; // 산줄기(200)보다 안, 카메라 far(260)보다 안
const SUN_R = 0.04, MOON_R = 0.032; // 원반 반지름(라디안). 실제(0.0047)보다 훨씬 크게, 귀엽게

const domeMat = new THREE.ShaderMaterial({
  uniforms: {
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uGlowK: { value: 0 },
    uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uSunR: { value: SUN_R },
    uMoon: { value: new THREE.Vector3() }, uMoonA: { value: 1 }, uNight: { value: 0 },
  },
  vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uZen, uHor, uGlow, uSun, uSunCol, uMoon; uniform float uGlowK, uSunR, uMoonA, uNight;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.55, d.y));
      // 해 쪽 지평선의 노을빛
      vec2 sh = normalize(uSun.xz + 1e-4);
      float az = dot(normalize(d.xz + 1e-4), sh) * 0.5 + 0.5;
      c = mix(c, uGlow, uGlowK * az * az * az * (1.0 - smoothstep(-0.05, 0.45, d.y)));
      // 해: 크림빛 원반 + 둘레 빛무리
      float sd = acos(clamp(dot(d, uSun), -1.0, 1.0));
      float sunUp = smoothstep(-0.08, 0.02, uSun.y);
      c = mix(c, uSunCol, sunUp * (0.35 * exp(-sd / (uSunR * 2.2)) + 0.25 * exp(-sd / (uSunR * 7.0))));
      c = mix(c, uSunCol, sunUp * smoothstep(uSunR, uSunR * 0.8, sd));
      // 달: 해 쪽 반구만 밝다(모양이 그대로 위상). 어두운 쪽도 살짝 비친다
      float md = dot(d, uMoon);
      vec3 q = (d - uMoon * md) / ${MOON_R.toFixed(3)};
      float r2 = dot(q, q);
      float moonA = uMoonA * smoothstep(-0.03, 0.02, uMoon.y);
      c = mix(c, vec3(0.95, 0.94, 1.0), moonA * uNight * 0.18 * exp(-sqrt(r2) * 0.35));
      if (md > 0.0 && r2 < 1.0) {
        vec3 n = q - uMoon * sqrt(1.0 - r2);
        float lit = smoothstep(-0.08, 0.12, dot(n, uSun));
        vec3 mc = mix(mix(c, vec3(0.72, 0.76, 0.92), 0.18), vec3(1.0, 0.97, 0.88), lit);
        c = mix(c, mc, moonA * smoothstep(1.0, 0.85, r2));
      }
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
  depthWrite: false,
});

// 별: 등급으로 크기·밝기, 색지수로 살짝 푸르거나 노르스름하게. 하나하나 다른 박자로 은은하게 반짝인다
const starMat = new THREE.ShaderMaterial({
  uniforms: { uA: { value: 0 }, uT: { value: 0 }, uPx: { value: 1 } },
  vertexShader: `
    attribute vec3 tint; attribute float mag; attribute float seed;
    uniform float uA, uT, uPx; varying vec3 vC; varying float vA;
    void main() {
      float b = clamp((4.2 - mag) / 5.6, 0.0, 1.0);
      float tw = 0.78 + 0.22 * sin(uT * (1.3 + seed * 1.7) + seed * 40.0) * sin(uT * 0.37 + seed * 17.0);
      float up = (modelMatrix * vec4(position, 0.0)).y / ${R}.0;
      vA = uA * (0.35 + 0.65 * b) * tw * smoothstep(0.0, 0.18, up); // 지평선 가까이는 옅다
      vC = tint;
      gl_PointSize = uPx * (1.6 + 3.2 * b) * (0.9 + 0.1 * tw);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vC; varying float vA;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.1, r));
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

const lineMat = new THREE.LineBasicMaterial({ color: "#c9d4ff", blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, opacity: 0 });

const eq = (ra: number, dec: number, out: number[]) => {
  const a = (ra / 10) * (Math.PI / 180), d = (dec / 10) * (Math.PI / 180);
  out.push(Math.cos(d) * Math.cos(a) * R, Math.cos(d) * Math.sin(a) * R, Math.sin(d) * R);
};

export function makeSky() {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16), domeMat);
  dome.material.side = THREE.BackSide;

  const pos: number[] = [], tint: number[] = [], mag: number[] = [], seed: number[] = [], c = new THREE.Color(), white = new THREE.Color("#ffffff");
  for (const s of STARS.split(",")) {
    const [ra, dec, m, bv] = s.split(" ").map(Number);
    eq(ra, dec, pos);
    const k = Math.max(-1, Math.min(1, (bv / 10 - 0.5) / 0.8)); // 색지수 0.5 언저리는 희게, 작으면 푸르게, 크면 노르스름하게
    c.set(k < 0 ? "#b9cbff" : "#ffd9a8").lerp(white, 1 - Math.abs(k) * 0.7);
    tint.push(c.r, c.g, c.b); mag.push(m / 10); seed.push(Math.random());
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute("tint", new THREE.Float32BufferAttribute(tint, 3));
  sg.setAttribute("mag", new THREE.Float32BufferAttribute(mag, 1));
  sg.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 1));
  const stars = new THREE.Points(sg, starMat);
  const lp: number[] = [];
  for (const s of LINES.split(",")) { const [ra, dec] = s.split(" ").map(Number); eq(ra, dec, lp); }
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(lp, 3)), lineMat);

  // 둥근 하늘 → 별 → 별자리 선 → 산줄기(-100) 차례. 모두 불투명 목록에 들어가 마을보다 먼저 그린다
  dome.renderOrder = -103; lines.renderOrder = -102; stars.renderOrder = -101;
  const all = [dome, stars, lines], turn = [stars, lines];
  for (const o of all) { o.frustumCulled = false; o.matrixAutoUpdate = false; }
  const u = domeMat.uniforms;

  return {
    objects: all,
    update(cam: THREE.Camera, s: DayState, px: number) {
      dome.position.copy(cam.position);
      dome.updateMatrix();
      // 별자리는 적도좌표에 놓고 지금 항성시만큼 돌린다
      for (const o of turn) { o.matrix.copy(s.starBasis).setPosition(cam.position); o.matrixWorldNeedsUpdate = true; }
      u.uZen.value.copy(s.sky); u.uHor.value.copy(s.horizon); u.uGlow.value.copy(s.glow); u.uGlowK.value = s.glowK;
      u.uSun.value.copy(s.sunDir); u.uSunCol.value.copy(s.sunColor);
      u.uSunR.value = SUN_R * (1 + 0.35 * (1 - Math.min(1, Math.max(0, s.sunDir.y / 0.35)))); // 낮게 걸린 해는 조금 크게
      u.uMoon.value.copy(s.moonDir); u.uMoonA.value = 0.4 + 0.6 * s.night; u.uNight.value = s.night;
      starMat.uniforms.uA.value = s.starAlpha;
      starMat.uniforms.uT.value = performance.now() / 1000;
      starMat.uniforms.uPx.value = px;
      lineMat.opacity = s.starAlpha * 0.05;
      stars.visible = lines.visible = s.starAlpha > 0.001;
    },
  };
}
