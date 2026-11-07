import * as THREE from "three";
import type { DayState } from "./daytime";
import { STARS } from "./stars";
import { FOG_TINT_GLSL, fogTintUniforms } from "./fogtint";

// 하늘: 둥근 하늘(높이에 따른 빛깔 + 해·달 원반 + 해 쪽 노을빛)과 별·별자리 선. 산줄기처럼 카메라를 따라다니고,
// 산줄기보다 먼저 그리며 깊이를 쓰지 않아 해·달·별이 산 뒤로 진다. 그리기 호출 3번

const R = 190; // 산줄기(200)보다 안, 카메라 far(260)보다 안
const SUN_R = 0.04, MOON_R = 0.032; // 원반 반지름(라디안). 실제(0.0047)보다 훨씬 크게, 귀엽게

const domeMat = new THREE.ShaderMaterial({
  uniforms: {
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, ...fogTintUniforms,
    uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uSunR: { value: SUN_R },
    uMoon: { value: new THREE.Vector3() }, uMoonA: { value: 1 }, uNight: { value: 0 },
  },
  vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uZen, uHor, uSun, uSunCol, uMoon; uniform float uSunR, uMoonA, uNight;
    ${FOG_TINT_GLSL}
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.55, d.y));
      // 해 쪽 지평선의 노을빛, 반대쪽의 푸른빛, 밤의 달 쪽 빛(땅의 안개와 같은 식이라 지평선에 이음매가 없다)
      c = fogTintLinear(c, d);
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

// 별: 선 없이 제자리에서 빛만 난다. 등급으로 크기·밝기, 색지수로 살짝 푸르거나 노르스름하게.
// 작고 또렷한 빛점 둘레에 옅은 빛무리가 번지고, 하나하나 다른 느린 박자로 은은하게 숨 쉬듯 반짝인다
const starMat = new THREE.ShaderMaterial({
  uniforms: { uA: { value: 0 }, uT: { value: 0 }, uPx: { value: 1 } },
  vertexShader: `
    attribute vec3 tint; attribute float mag; attribute float seed;
    uniform float uA, uT, uPx; varying vec3 vC; varying float vA;
    void main() {
      float b = clamp((4.2 - mag) / 5.6, 0.0, 1.0);
      float tw = 0.84 + 0.16 * sin(uT * (0.5 + seed * 0.8) + seed * 40.0) * sin(uT * 0.23 + seed * 17.0);
      float up = (modelMatrix * vec4(position, 0.0)).y / ${R}.0;
      vA = uA * (0.35 + 0.65 * b) * tw * smoothstep(0.0, 0.18, up); // 지평선 가까이는 옅다
      vC = tint;
      gl_PointSize = uPx * (3.0 + 7.0 * b) * (0.94 + 0.06 * tw); // 빛무리까지 담도록 넉넉히
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vC; varying float vA;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0; // 0 가운데 ~ 1 가장자리
      float core = exp(-r * r * 28.0), halo = exp(-r * r * 6.0) * 0.28; // 또렷한 빛점 + 옅은 빛무리
      gl_FragColor = vec4(vC, vA * (core + halo) * smoothstep(1.0, 0.7, r));
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

const eq = (ra: number, dec: number, out: number[]) => {
  const a = (ra / 10) * (Math.PI / 180), d = (dec / 10) * (Math.PI / 180);
  out.push(Math.cos(d) * Math.cos(a) * R, Math.cos(d) * Math.sin(a) * R, Math.sin(d) * R);
};

// 별똥별: 밤에 가끔(15~50초에 한 번) 하늘 높은 데서 비스듬히 미끄러져 내려와 산 너머로 사라진다.
// 가는 띠 하나(사각형)를 매 프레임 머리·꼬리 자리로 옮긴다. 산줄기보다 먼저 그려 산에 가려지며 사라진다
const meteorMat = new THREE.ShaderMaterial({
  uniforms: { uA: { value: 0 } },
  vertexShader: `
    attribute vec2 uvm; varying vec2 vU;
    void main() { vU = uvm; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float uA; varying vec2 vU; // x: 꼬리 0 → 머리 1, y: 띠 가로(-1~1)
    void main() {
      float w = 1.0 - smoothstep(0.15, 1.0, abs(vU.y) / mix(0.25, 1.0, vU.x)); // 꼬리로 갈수록 가늘게
      gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), uA * vU.x * vU.x * w);
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: false,
});
const M_SPEED = 0.55, M_TAIL = 0.16, M_W = 0.0035; // 각속도(라디안/초), 꼬리 길이(라디안), 머리 굵기(반지름 비율)

export function makeSky() {
  const mg = new THREE.BufferGeometry();
  mg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  mg.setAttribute("uvm", new THREE.Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2));
  mg.setIndex([0, 2, 1, 1, 2, 3]);
  const meteor = new THREE.Mesh(mg, meteorMat);
  meteor.visible = false;
  const m = { wait: 8 + Math.random() * 20, t: -1, dur: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), last: 0 };
  const head = new THREE.Vector3(), tail = new THREE.Vector3(), side = new THREE.Vector3(), mp = mg.attributes.position as THREE.BufferAttribute;
  const dirAt = (out: THREE.Vector3, el: number, az: number) => out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  // 시작(높이 25~55°)에서 끝(지평선 아래 6°)까지 큰 원을 따라 미끄러진다
  const along = (out: THREE.Vector3, k: number) => out.copy(m.a).lerp(m.b, k).normalize();
  const meteorTick = (dt: number, alpha: number) => {
    if (m.t < 0) {
      if (alpha < 0.4 || (m.wait -= dt) > 0) { meteor.visible = false; return; }
      const az = Math.random() * Math.PI * 2, e0 = (25 + Math.random() * 30) * (Math.PI / 180), turn = (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.45);
      dirAt(m.a, e0, az); dirAt(m.b, -6 * (Math.PI / 180), az + turn);
      m.dur = m.a.angleTo(m.b) / M_SPEED; m.t = 0;
    }
    m.t += dt;
    const k = m.t / m.dur;
    if (k >= 1) { m.t = -1; m.wait = 15 + Math.random() * 35; meteor.visible = false; return; }
    along(head, k); along(tail, Math.max(0, k - M_TAIL / (m.dur * M_SPEED)));
    side.crossVectors(head, tail).normalize().multiplyScalar(R * M_W);
    head.multiplyScalar(R); tail.multiplyScalar(R);
    mp.setXYZ(0, tail.x - side.x * 0.3, tail.y - side.y * 0.3, tail.z - side.z * 0.3); mp.setXYZ(1, tail.x + side.x * 0.3, tail.y + side.y * 0.3, tail.z + side.z * 0.3);
    mp.setXYZ(2, head.x - side.x, head.y - side.y, head.z - side.z); mp.setXYZ(3, head.x + side.x, head.y + side.y, head.z + side.z);
    mp.needsUpdate = true;
    meteorMat.uniforms.uA.value = alpha * Math.min(1, k / 0.12) * 0.85; // 갑자기 켜지지 않게 처음엔 서서히
    meteor.visible = true;
  };

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

  // 둥근 하늘 → 별 → 산줄기(-100) 차례. 모두 불투명 목록에 들어가 마을보다 먼저 그린다
  dome.renderOrder = -103; stars.renderOrder = -101; meteor.renderOrder = -100.5;
  const all = [dome, stars, meteor];
  for (const o of all) { o.frustumCulled = false; o.matrixAutoUpdate = false; }
  const u = domeMat.uniforms;

  return {
    objects: all,
    update(cam: THREE.Camera, s: DayState, px: number) {
      dome.position.copy(cam.position);
      dome.updateMatrix();
      // 별자리는 적도좌표에 놓고 지금 항성시만큼 돌린다
      stars.matrix.copy(s.starBasis).setPosition(cam.position); stars.matrixWorldNeedsUpdate = true;
      u.uZen.value.copy(s.sky); u.uHor.value.copy(s.horizon);
      u.uSun.value.copy(s.sunDir); u.uSunCol.value.copy(s.sunColor);
      u.uSunR.value = SUN_R * (1 + 0.35 * (1 - Math.min(1, Math.max(0, s.sunDir.y / 0.35)))); // 낮게 걸린 해는 조금 크게
      u.uMoon.value.copy(s.moonDir); u.uMoonA.value = 0.4 + 0.6 * s.night; u.uNight.value = s.night;
      starMat.uniforms.uA.value = s.starAlpha;
      starMat.uniforms.uT.value = performance.now() / 1000;
      starMat.uniforms.uPx.value = px;
      stars.visible = s.starAlpha > 0.001;
      const now = performance.now() / 1000, dt = Math.min(0.1, m.last ? now - m.last : 0);
      m.last = now;
      meteor.position.copy(cam.position); meteor.updateMatrix();
      meteorTick(dt, s.starAlpha);
    },
  };
}
