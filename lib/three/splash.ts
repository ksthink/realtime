import * as THREE from "three";
import { WATER_Y } from "../terrain";

// 웅덩이를 걸을 때 발밑에서 튀는 물방울과 작게 퍼지는 물결. 과하지 않게 몇 방울만 낸다
const DROPS = 72; // 동시에 떠 있을 수 있는 물방울 수
const PER_STEP = 5; // 한 걸음에 튀는 물방울 수
const RINGS = 8; // 동시에 퍼지는 물결 수
const RING_LIFE = 0.7; // 물결이 퍼졌다 사라지는 시간(초)
const GRAVITY = 7;
const SURFACE = WATER_Y + 0.01;

export function makeSplash() {
  const group = new THREE.Group();

  // 물방울: 위치는 CPU에서 움직이고, 크기와 투명도는 셰이더에서 정한다
  const pos = new Float32Array(DROPS * 3), vel = new Float32Array(DROPS * 3), life = new Float32Array(DROPS);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aLife", new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  const uPx = { value: 1000 };
  const drops = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uPx },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      uniform float uPx;
      attribute float aLife;
      varying float vA;
      void main() {
        vA = clamp(aLife * 2.5, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aLife > 0.0 ? uPx * projectionMatrix[1][1] * 0.03 / -mv.z : 0.0; // 월드 크기 약 3cm
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(0.9, 0.96, 0.98, smoothstep(0.5, 0.15, d) * vA * 0.85);
      }`,
  }));
  drops.frustumCulled = false;
  const size = new THREE.Vector2();
  drops.onBeforeRender = (renderer) => { uPx.value = renderer.getDrawingBufferSize(size).y; };
  group.add(drops);

  // 물결: 수면에 얇은 고리가 퍼지며 옅어진다
  const ringMat = () => new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 vP;
      void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uT;
      varying vec2 vP;
      void main() {
        float r = length(vP), edge = mix(0.25, 0.95, uT);
        float a = smoothstep(0.09, 0.0, abs(r - edge)) * (1.0 - uT) * 0.4;
        gl_FragColor = vec4(0.92, 0.97, 1.0, a);
      }`,
  });
  const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: RINGS }, () => {
    const m = new THREE.Mesh(ringGeo, ringMat());
    m.visible = false;
    m.renderOrder = 2;
    group.add(m);
    return { m, t: 0 };
  });

  let nextDrop = 0, nextRing = 0, dirty = false;
  return {
    group,
    // 발이 웅덩이에 닿은 자리(x, z)와 걷는 방향(yaw)
    emit(x: number, z: number, yaw: number) {
      for (let n = 0; n < PER_STEP; n++) {
        const i = nextDrop; nextDrop = (nextDrop + 1) % DROPS;
        const a = yaw + Math.PI + (Math.random() - 0.5) * 2.4, out = 0.35 + Math.random() * 0.5; // 주로 뒤와 옆으로
        pos[i * 3] = x + (Math.random() - 0.5) * 0.25;
        pos[i * 3 + 1] = SURFACE;
        pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.25;
        vel[i * 3] = Math.sin(a) * out;
        vel[i * 3 + 1] = 1.1 + Math.random() * 0.8;
        vel[i * 3 + 2] = Math.cos(a) * out;
        life[i] = 1;
      }
      dirty = true;
      const r = rings[nextRing]; nextRing = (nextRing + 1) % RINGS;
      r.t = 0;
      r.m.position.set(x, SURFACE, z);
      r.m.scale.setScalar(0.5);
      r.m.visible = true;
    },
    update(dt: number) {
      if (!dirty) return this.updateRings(dt);
      let alive = false;
      for (let i = 0; i < DROPS; i++) {
        if (life[i] <= 0) continue;
        vel[i * 3 + 1] -= GRAVITY * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        life[i] = pos[i * 3 + 1] < SURFACE ? 0 : life[i] - dt * 1.5; // 수면에 떨어지면 사라진다
        alive = true;
      }
      // 마지막 물방울이 사라진 프레임까지 올리고, 그 뒤로는 멈춘다
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
      dirty = alive;
      this.updateRings(dt);
    },
    updateRings(dt: number) {
      for (const r of rings) {
        if (!r.m.visible) continue;
        r.t += dt / RING_LIFE;
        if (r.t >= 1) { r.m.visible = false; continue; }
        r.m.scale.setScalar(0.5 + r.t * 0.3);
        (r.m.material as THREE.ShaderMaterial).uniforms.uT.value = r.t;
      }
    },
    dispose() {
      geo.dispose();
      drops.material.dispose();
      ringGeo.dispose();
      for (const r of rings) (r.m.material as THREE.Material).dispose();
    },
  };
}
