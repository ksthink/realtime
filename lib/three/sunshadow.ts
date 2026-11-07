import * as THREE from "three";

// 해(밤에는 달) 그림자 빛의 그림자 상자를 빛 높이에 맞춘다.
// 그림자 지도에서는 물체와 그 그림자가 같은 칸에 찍히므로, 상자의 가로·세로는 그림자를 받는 쪽(내 둘레 땅)만 덮으면 된다.
// 해가 낮을수록 땅이 빛 쪽에서 납작하게 보이므로 세로를 줄여 더 촘촘히 쓰고,
// 대신 해 쪽 멀리서 긴 그림자를 드리우는 나무까지 담도록 상자를 빛 쪽으로 깊게 늘린다.
const R = 26; // 상자 가운데에서 이만큼(m) 둘레의 땅이 그림자를 받는다
const AHEAD = 6; // 상자 가운데를 카메라가 보는 쪽으로 이만큼 민다(뒤쪽 땅은 화면에 덜 나온다)
const H_UP = 10, H_DOWN = 8; // 그림자를 받는 높이 범위: 나무 꼭대기까지, 동산 위에서 내려다본 아래 땅까지
const H_CAST = 13; // 그림자를 드리우는 것의 가장 높은 곳(큰 나무)
const REACH_MAX = 70; // 해 쪽으로 이만큼(m)까지 그림자를 드리우는 것을 담는다
const BIAS_M = 0.048; // 깊이 치우침(m). 상자 깊이가 바뀌어도 같은 거리로 둔다

const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const q = (v: number) => Math.ceil(v * 2) / 2; // 0.5m 단위로 올려, 해가 조금씩 움직여도 투영 행렬은 가끔만 새로 만든다

// at: 내 자리(발밑), dir: 빛이 오는 쪽(단위 벡터), view: 화면 카메라(보는 쪽으로 상자를 민다)
export function fitSunShadow(light: THREE.DirectionalLight, at: THREE.Vector3, dir: THREE.Vector3, view?: THREE.Camera) {
  const sh = light.shadow, cam = sh.camera;
  const s = Math.max(dir.y, 0.1), c = Math.sqrt(1 - s * s);
  const top = q(R * s + H_UP * c), bottom = -q(R * s + H_DOWN * c);
  const dist = q(R * c + Math.min(H_CAST / s, REACH_MAX) + 2), far = q(dist + R * c + H_DOWN * s + 4);
  if (cam.top !== top || cam.bottom !== bottom || cam.far !== far || cam.right !== R) {
    cam.left = -R; cam.right = R; cam.top = top; cam.bottom = bottom; cam.near = 0.5; cam.far = far;
    cam.updateProjectionMatrix();
    sh.bias = -BIAS_M / (far - cam.near);
  }
  // 땅을 비스듬히 비추는 낮은 해에서 생기는 줄무늬를 막는다: 땅 위 그림자 칸 크기의 절반만큼 면 바깥으로 밀어 본다
  sh.normalBias = (0.5 * (top - bottom)) / sh.mapSize.y / s;

  _c.copy(at);
  if (view) {
    view.getWorldDirection(_f).setY(0);
    if (_f.lengthSq() > 1e-6) _c.addScaledVector(_f.normalize(), AHEAD);
  }
  // 상자를 그림자 칸 크기 단위로만 옮겨, 걸을 때 그림자 가장자리가 지글거리지 않게 한다
  _x.crossVectors(UP, dir);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  _x.normalize(); _y.crossVectors(dir, _x);
  const tx = (2 * R) / sh.mapSize.x, ty = (top - bottom) / sh.mapSize.y;
  const a = _c.dot(_x), b = _c.dot(_y);
  _c.addScaledVector(_x, Math.round(a / tx) * tx - a).addScaledVector(_y, Math.round(b / ty) * ty - b);

  light.position.copy(_c).addScaledVector(dir, dist);
  light.target.position.copy(_c);
  light.target.updateMatrixWorld();
}
