import * as THREE from "three";
import { WATER_Y, onStairs, walkY } from "../terrain";
import { groundAt } from "./world";

// 땅을 눌러 걸어갈 곳을 정하면 그 자리에 둥근 물결이 퍼진다. 고리 두 개를 조금 엇갈려 띄워 퍼지는 느낌을 낸다
const POOL = 3; // 빠르게 여러 번 눌러도 이만큼만 돌려 쓴다
const LIFE = 0.6; // 한 고리가 퍼졌다 사라지는 시간(초)
const DELAY = 0.12; // 둘째 고리가 늦게 출발하는 시간(초)
const FROM = 0.15, TO = 0.9; // 고리 반지름(m)
const LIFT = 0.04; // 땅에 묻히지 않게 살짝 띄운다
const SEG = 16; // 고리 판을 이만큼 잘게 나눠 땅 굴곡을 따라 휘게 한다(납작한 판이면 비탈에서 한쪽이 땅에 묻혀 잘린다)

export function makeRipple() {
  const group = new THREE.Group();
  // 지역 좌표가 곧 미터(반지름 1까지). 물결마다 판을 따로 두고, 띄울 때 꼭짓점 높이를 그 자리 땅(물이면 수면, 계단이면 디딤판)에 맞춘다
  const makeGeo = () => new THREE.PlaneGeometry(2, 2, SEG, SEG).rotateX(-Math.PI / 2);

  const ringMat = () => new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    // 살짝 기운 땅과 겹쳐 깜빡이지 않게 앞으로 당긴다
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: `
      varying vec2 vP;
      void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uT;
      varying vec2 vP;
      void main() {
        float e = 1.0 - (1.0 - uT) * (1.0 - uT); // 처음엔 빠르게, 끝에선 느리게 퍼진다
        float r = length(vP), edge = mix(${FROM.toFixed(2)}, ${TO.toFixed(2)}, e);
        float w = mix(0.05, 0.025, uT);
        float a = smoothstep(w, 0.0, abs(r - edge)) * (1.0 - uT) * (1.0 - uT) * 0.75;
        gl_FragColor = vec4(1.0, 0.97, 0.9, a);
      }`,
  });

  // 물결 하나 = 고리 둘. 둘째 고리는 시간이 음수에서 시작해 늦게 보인다
  const ripples = Array.from({ length: POOL }, () => {
    const g = new THREE.Group();
    g.visible = false;
    const geo = makeGeo();
    const rings = [0, DELAY].map((delay) => {
      const m = new THREE.Mesh(geo, ringMat());
      m.renderOrder = 2;
      m.visible = false;
      g.add(m);
      return { m, delay, u: (m.material as THREE.ShaderMaterial).uniforms.uT };
    });
    group.add(g);
    return { g, geo, rings, t: 0 };
  });

  let next = 0;
  return {
    group,
    emit(x: number, y: number, z: number) {
      const r = ripples[next]; next = (next + 1) % POOL;
      r.t = 0;
      r.g.position.set(x, y, z);
      const pos = r.geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const px = x + pos.getX(i), pz = z + pos.getZ(i);
        pos.setY(i, (onStairs(px, pz) ? walkY(px, pz) : Math.max(groundAt(px, pz), WATER_Y)) - y + LIFT); // 계단은 디딤판 높이
      }
      pos.needsUpdate = true;
      r.geo.computeBoundingSphere();
      r.g.visible = true;
      for (const k of r.rings) k.m.visible = false;
    },
    update(dt: number) {
      for (const r of ripples) {
        if (!r.g.visible) continue;
        r.t += dt;
        if (r.t >= LIFE + DELAY) { r.g.visible = false; continue; }
        for (const k of r.rings) {
          const t = (r.t - k.delay) / LIFE;
          k.m.visible = t > 0 && t < 1;
          k.u.value = t;
        }
      }
    },
    dispose() {
      for (const r of ripples) {
        r.geo.dispose();
        for (const k of r.rings) (k.m.material as THREE.Material).dispose();
      }
    },
  };
}
