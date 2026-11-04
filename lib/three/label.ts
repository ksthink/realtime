import * as THREE from "three";

// 탑 위 말풍선: 소원(있으면)과 "누구의 탑 · 남은 N분"
export class TowerLabel {
  sprite: THREE.Sprite;
  private cv = document.createElement("canvas");
  private tex: THREE.CanvasTexture;
  private key = "";

  constructor(private font: string) {
    this.cv.width = 640;
    this.cv.height = 200;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true, fog: false, toneMapped: false }));
    this.sprite.scale.set(3.2, 1, 1);
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 6;
  }

  set(wish: string | null, sub: string, urgent: boolean, mine: boolean) {
    const key = `${wish}|${sub}|${urgent}|${mine}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.cv.getContext("2d")!;
    ctx.clearRect(0, 0, 640, 200);
    ctx.textAlign = "center";
    ctx.font = `30px ${this.font}`;
    const subW = ctx.measureText(sub).width;
    ctx.font = `42px ${this.font}`;
    const wishW = wish ? ctx.measureText(wish).width : 0;
    const w = Math.min(630, Math.max(subW, wishW) + 56), h = wish ? 124 : 66, y = 172 - h;
    ctx.fillStyle = "rgba(255,252,246,.94)";
    ctx.beginPath();
    ctx.roundRect(320 - w / 2, y, w, h, 22);
    ctx.fill();
    ctx.fillStyle = mine ? "#f29a8a" : "rgba(255,252,246,.94)";
    ctx.beginPath();
    ctx.moveTo(306, 172); ctx.lineTo(334, 172); ctx.lineTo(320, 196);
    ctx.fill();
    if (wish) {
      ctx.fillStyle = "#4a3f52";
      ctx.fillText(wish, 320, y + 54, 600);
    }
    ctx.font = `30px ${this.font}`;
    ctx.fillStyle = urgent ? "#d4574a" : "#8b7f93";
    ctx.fillText(sub, 320, y + (wish ? 102 : 44), 600);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}

// 합장 때 탑에서 떠오르는 "+10분"
export function floatingText(text: string, font: string) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 96;
  const ctx = cv.getContext("2d")!;
  ctx.font = `48px ${font}`;
  ctx.textAlign = "center";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = "#e0795f";
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false, toneMapped: false }));
  sp.scale.set(1.6, 0.6, 1);
  sp.renderOrder = 7;
  return sp;
}
