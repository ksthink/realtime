import * as THREE from "three";
import { rng } from "../terrain";

// 시드 → 모양. 지오메트리·재질은 풀로 공유하고 서버가 정한 반경·높이는 스케일로 맞춘다.
const SHAPE_COUNT = 16;
const COLOR_COUNT = 10;
let shapes: THREE.BufferGeometry[] | null = null;
let materials: THREE.Material[] | null = null;

function buildShape(seed: number) {
  const r = rng(seed * 7919 + 13);
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position, v = new THREE.Vector3();
  const f = [1.3 + r() * 2, 1.3 + r() * 2, 1.3 + r() * 2], ph = [r() * 6, r() * 6, r() * 6], amp = 0.08 + r() * 0.14;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * f[0] + ph[0]) * Math.sin(v.y * f[1] + ph[1]) + Math.cos(v.z * f[2] + ph[2]) * 0.7 + Math.sin((v.x + v.y + v.z) * 3.1 + ph[0]) * 0.4;
    v.multiplyScalar(1 + n * amp);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // 경계 상자를 중심 원점, 크기 1로 정규화
  geo.computeBoundingBox();
  const c = geo.boundingBox!.getCenter(new THREE.Vector3()), s = geo.boundingBox!.getSize(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(1 / s.x, 1 / s.y, 1 / s.z);
  geo.computeVertexNormals();
  return geo;
}

export function stoneGeometry(seed: number) {
  shapes ??= Array.from({ length: SHAPE_COUNT }, (_, i) => buildShape(i));
  return shapes[Math.abs(seed) % SHAPE_COUNT];
}

function stoneMaterial(seed: number) {
  materials ??= Array.from({ length: COLOR_COUNT }, (_, i) => {
    const r = rng(i * 131 + 5);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.08 + r() * 0.08, 0.08 + r() * 0.1, 0.45 + r() * 0.3),
      roughness: 0.95,
      flatShading: true,
    });
  });
  return materials[Math.abs(seed >> 4) % COLOR_COUNT];
}

export function makeStoneMesh(seed: number, radius: number, height: number) {
  const mesh = new THREE.Mesh(stoneGeometry(seed), stoneMaterial(seed));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.scale.set(radius * 2, height, radius * 2);
  mesh.rotation.y = rng(seed)() * Math.PI * 2;
  return mesh;
}

// 줍기 대상 돌의 은빛 표시: 바닥의 둥근 빛, 옅은 수직 빛줄기, 작은 입자 몇 개.
// 실제 조명을 쓰지 않아 주변 돌과 땅의 밝기는 그대로다
const SILVER = "vec3(0.88, 0.92, 0.98)";
const SPARKS = 6;

export function makePickGlow() {
  const uniforms = { uK: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1000 } };
  const group = new THREE.Group();
  group.visible = false;
  const common = { uniforms, transparent: true, depthWrite: false, fog: false };

  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      ...common,
      vertexShader: `
        varying vec2 vP;
        void main() {
          vP = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uK;
        varying vec2 vP;
        void main() {
          float fall = 1.0 - clamp(length(vP), 0.0, 1.0);
          gl_FragColor = vec4(${SILVER}, pow(fall, 1.3) * 0.72 * uK);
        }`,
    }),
  );
  disc.position.y = 0.03; // 땅에 파묻히지 않게 살짝 띄운다

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 1, 24, 1, true).translate(0, 0.5, 0),
    new THREE.ShaderMaterial({
      ...common,
      vertexShader: `
        varying float vH;
        varying vec3 vN;
        varying vec3 vWorld;
        void main() {
          vH = position.y;
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform float uK;
        varying float vH;
        varying vec3 vN;
        varying vec3 vWorld;
        void main() {
          // 위로 갈수록, 기둥의 양옆으로 갈수록 사라진다
          float facing = abs(dot(normalize(vN), normalize(cameraPosition - vWorld)));
          float up = pow(1.0 - vH, 2.2);
          gl_FragColor = vec4(${SILVER}, up * facing * facing * 0.28 * uK);
        }`,
    }),
  );

  // 입자는 시간으로만 계산한다. 위치 배열을 프레임마다 고치지 않는다
  const seeds = new Float32Array(SPARKS * 3);
  for (let i = 0; i < SPARKS; i++) {
    seeds[i * 3] = i * 2.399963; // 황금각으로 둘레에 고르게 놓는다
    seeds[i * 3 + 1] = 0.25 + ((i * 0.37) % 0.4);
    seeds[i * 3 + 2] = i / SPARKS;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  sparkGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
  const sparks = new THREE.Points(
    sparkGeo,
    new THREE.ShaderMaterial({
      ...common,
      vertexShader: `
        uniform float uTime;
        uniform float uPx;
        attribute vec3 aSeed;
        varying float vA;
        void main() {
          float t = fract(uTime * 0.2 + aSeed.z);
          float a = aSeed.x + t * 0.8;
          vec3 p = vec3(cos(a) * aSeed.y, 0.08 + t * 1.05, sin(a) * aSeed.y);
          vA = sin(t * 3.14159);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPx * projectionMatrix[1][1] * 0.022 / -mv.z; // 월드 크기 약 4.4cm
        }`,
      fragmentShader: `
        uniform float uK;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(${SILVER}, smoothstep(0.5, 0.1, d) * vA * 0.75 * uK);
        }`,
    }),
  );
  sparks.frustumCulled = false;
  const size = new THREE.Vector2();
  sparks.onBeforeRender = (renderer) => { uniforms.uPx.value = renderer.getDrawingBufferSize(size).y; };

  group.add(disc, beam, sparks);
  return {
    group,
    uniforms,
    dispose() {
      for (const o of [disc, beam, sparks]) { o.geometry.dispose(); o.material.dispose(); }
    },
  };
}
