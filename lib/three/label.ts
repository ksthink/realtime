import * as THREE from "three";

const W = 640, H = 400; // 펼친 소원까지 담도록 높게 잡는다. 말풍선은 아래쪽 BASE에 붙어 위로 자란다
const BASE = H - 28; // 말풍선 아래 변. 그 밑은 꼬리
const PX_PER_UNIT = 200; // 월드 1단위에 들어가는 캔버스 픽셀
const TEXT_W = 600;
const WISH_LINES = 2; // 접었을 때 보이는 소원 줄 수
const WISH_LINES_OPEN = 6; // 펼쳤을 때 캔버스에 들어가는 최대 줄 수

// 띄어쓰기에서 줄을 나누고, 한 단어가 한 줄보다 길면 글자 단위로 나눈다
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const joined = line ? `${line} ${word}` : word;
    if (ctx.measureText(joined).width <= maxW) { line = joined; continue; }
    if (line) lines.push(line);
    line = "";
    for (const ch of word) {
      if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ""; }
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// 넘치는 줄을 잘라 마지막 보이는 줄 끝에 말줄임표를 붙인다
function ellipsize(ctx: CanvasRenderingContext2D, lines: string[], count: number, maxW: number) {
  const chars = [...lines[count - 1]];
  while (chars.length && ctx.measureText(`${chars.join("")}…"`).width > maxW) chars.pop();
  return [...lines.slice(0, count - 1), `${chars.join("")}…"`];
}

// 탑 위 말풍선. 소원이 있으면 이름 / "소원" / 남은 시간, 없으면 sub 한 줄("누구의 탑 · 남은 시간")
export class TowerLabel {
  sprite: THREE.Sprite;
  private cv = document.createElement("canvas");
  private tex: THREE.CanvasTexture;
  private key = "";
  private truncated = false;
  private expanded = false;
  private box = { left: 0, right: 0, top: 0 }; // 지금 그려진 말풍선. 투명한 곳의 클릭을 거른다

  constructor(private font: string) {
    this.cv.width = W;
    this.cv.height = H;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true, fog: false, toneMapped: false }));
    this.setSize(1);
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 6;
  }

  setSize(k: number) {
    this.sprite.scale.set((W / PX_PER_UNIT) * k, (H / PX_PER_UNIT) * k, 1);
  }

  // uv(스프라이트 위 좌표)가 말풍선 위인가
  // pad(캔버스 픽셀)만큼 넉넉히 본다. 이미 펼친 푯말은 넉넉히 봐서 가장자리에서 접혔다 펼쳤다 하지 않게 한다
  contains(uv: THREE.Vector2, pad = 0) {
    const x = uv.x * W, y = (1 - uv.y) * H;
    return x >= this.box.left - pad && x <= this.box.right + pad && y >= this.box.top - pad && y <= BASE + pad;
  }

  // 잘린 소원만 펼치고 접을 수 있다
  toggle() {
    if (this.truncated) this.expanded = !this.expanded;
  }

  // 조금 떨어진 탑: 내용 없이 「…」만 있는 작은 말풍선
  setBrief(mine: boolean) {
    const key = `brief|${mine}`;
    if (key === this.key) return;
    this.key = key;
    this.truncated = false;
    const ctx = this.cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const w = 120, h = 66, y = BASE - h;
    this.box = { left: W / 2 - w / 2, right: W / 2 + w / 2, top: y };
    ctx.fillStyle = "rgba(255,252,246,.94)";
    ctx.beginPath();
    ctx.roundRect(W / 2 - w / 2, y, w, h, 22);
    ctx.fill();
    ctx.fillStyle = mine ? "#f29a8a" : "rgba(255,252,246,.94)";
    ctx.beginPath();
    ctx.moveTo(W / 2 - 14, BASE); ctx.lineTo(W / 2 + 14, BASE); ctx.lineTo(W / 2, BASE + 24);
    ctx.fill();
    ctx.fillStyle = "#6f6478";
    for (const dx of [-26, 0, 26]) {
      ctx.beginPath();
      ctx.arc(W / 2 + dx, y + h / 2, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    this.tex.needsUpdate = true;
  }

  // 단계가 바뀔 때 부드럽게 나타나고 사라진다
  setOpacity(a: number) {
    this.sprite.material.opacity = a;
    this.sprite.visible = a > 0;
  }

  set(name: string, wish: string | null, sub: string, urgent: boolean, mine: boolean) {
    const key = `${name}|${wish}|${sub}|${urgent}|${mine}|${this.expanded}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.cv.getContext("2d")!;
    const nameFont = `bold 32px ${this.font}`, wishFont = `40px ${this.font}`, subFont = `${wish ? 24 : 30}px ${this.font}`;
    const widthOf = (text: string, font: string) => { ctx.font = font; return ctx.measureText(text).width; };

    let lines: string[] = [];
    if (wish) {
      ctx.font = wishFont;
      const all = wrap(ctx, `"${wish}"`, TEXT_W);
      this.truncated = all.length > WISH_LINES;
      const shown = this.expanded ? WISH_LINES_OPEN : WISH_LINES;
      lines = all.length > shown ? ellipsize(ctx, all, shown, TEXT_W) : all;
    } else this.truncated = false;
    if (!this.truncated) this.expanded = false;

    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    const textW = wish
      ? Math.max(widthOf(name, nameFont), widthOf(sub, subFont), ...lines.map((l) => widthOf(l, wishFont)))
      : widthOf(sub, subFont);
    const w = Math.min(630, textW + 56), h = wish ? 150 + (lines.length - 1) * 48 : 66, y = BASE - h;
    this.box = { left: W / 2 - w / 2, right: W / 2 + w / 2, top: y };
    ctx.fillStyle = "rgba(255,252,246,.94)";
    ctx.beginPath();
    ctx.roundRect(W / 2 - w / 2, y, w, h, 22);
    ctx.fill();
    ctx.fillStyle = mine ? "#f29a8a" : "rgba(255,252,246,.94)";
    ctx.beginPath();
    ctx.moveTo(W / 2 - 14, BASE); ctx.lineTo(W / 2 + 14, BASE); ctx.lineTo(W / 2, BASE + 24);
    ctx.fill();
    if (wish) {
      ctx.fillStyle = "#4a3f52";
      ctx.font = nameFont;
      ctx.fillText(name, W / 2, y + 42, TEXT_W);
      ctx.font = wishFont;
      lines.forEach((line, i) => ctx.fillText(line, W / 2, y + 92 + i * 48));
    }
    ctx.font = subFont;
    ctx.fillStyle = urgent ? "#d4574a" : "#6f6478";
    ctx.fillText(sub, W / 2, y + (wish ? 130 + (lines.length - 1) * 48 : 44), TEXT_W);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}

// 합장 때 탑에서 떠오르는 "+1시간"
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
