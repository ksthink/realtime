import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// 링크를 공유할 때 보이는 미리보기 그림: 게임 이름과 말랑이 캐릭터, 돌탑
export const alt = "이뤄져요, 돌탑의 숲 — 말랑이 캐릭터와 돌탑";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#4a3f52";

// 돌 하나: 아래가 조금 평평한 둥근 돌
function Stone({ w, h, color }: { w: number; h: number; color: string }) {
  return <div style={{ width: w, height: h, borderRadius: "50%", background: color, boxShadow: "inset 0 -6px 0 rgba(0,0,0,0.08)", marginTop: -4 }} />;
}

function Tower({ stones, left, bottom }: { stones: [number, number, string][]; left: number; bottom: number }) {
  return (
    <div style={{ position: "absolute", left, bottom, display: "flex", flexDirection: "column-reverse", alignItems: "center" }}>
      {stones.map(([w, h, c], i) => <Stone key={i} w={w} h={h} color={c} />)}
    </div>
  );
}

// 말랑이: 둥근 몸통, 점 눈, 분홍 코, 웃는 입, 가는 팔다리
function Malang() {
  const limb = "#e9d3da";
  return (
    <div style={{ position: "absolute", right: 150, bottom: 96, width: 330, height: 420, display: "flex" }}>
      {/* 다리 */}
      <div style={{ position: "absolute", left: 120, top: 300, width: 26, height: 100, borderRadius: 13, background: limb }} />
      <div style={{ position: "absolute", left: 184, top: 300, width: 26, height: 100, borderRadius: 13, background: limb }} />
      <div style={{ position: "absolute", left: 104, top: 386, width: 50, height: 24, borderRadius: 12, background: limb }} />
      <div style={{ position: "absolute", left: 180, top: 386, width: 50, height: 24, borderRadius: 12, background: limb }} />
      {/* 팔: 한쪽은 흔든다 */}
      <div style={{ position: "absolute", left: -40, top: 186, width: 90, height: 24, borderRadius: 12, background: limb, transform: "rotate(28deg)" }} />
      <div style={{ position: "absolute", left: 278, top: 108, width: 96, height: 24, borderRadius: 12, background: limb, transform: "rotate(-52deg)" }} />
      <div style={{ position: "absolute", left: 340, top: 62, width: 40, height: 40, borderRadius: 20, background: limb }} />
      {/* 몸통 */}
      <div style={{ position: "absolute", left: 25, top: 20, width: 290, height: 300, borderRadius: "50%", background: "radial-gradient(circle at 35% 28%, #f6dde3 0%, #e7c3cf 42%, #b8c3de 100%)", boxShadow: "0 18px 36px rgba(74,63,82,0.18)" }} />
      {/* 얼굴 */}
      <div style={{ position: "absolute", left: 128, top: 140, width: 18, height: 22, borderRadius: 11, background: "#2f2833" }} />
      <div style={{ position: "absolute", left: 196, top: 140, width: 18, height: 22, borderRadius: 11, background: "#2f2833" }} />
      <div style={{ position: "absolute", left: 162, top: 172, width: 18, height: 16, borderRadius: 9, background: "#ef8c96" }} />
      <div style={{ position: "absolute", left: 146, top: 178, width: 50, height: 28, borderBottom: "5px solid #2f2833", borderRadius: "0 0 26px 26px" }} />
      <div style={{ position: "absolute", left: 92, top: 178, width: 34, height: 18, borderRadius: 9, background: "rgba(239,140,150,0.35)" }} />
      <div style={{ position: "absolute", left: 216, top: 178, width: 34, height: 18, borderRadius: 9, background: "rgba(239,140,150,0.35)" }} />
    </div>
  );
}

export default async function OpengraphImage() {
  const font = await readFile(join(process.cwd(), "public/font/ONE-Mobile-Title.ttf"));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "linear-gradient(180deg, #dbe5f0 0%, #e8eef0 100%)", fontFamily: "ONE Mobile Title" }}>
        {/* 먼 산(어렴풋하게), 땅, 숲 */}
        <div style={{ position: "absolute", left: -120, top: 230, width: 700, height: 260, borderRadius: "50%", background: "#cdd8e4" }} />
        <div style={{ position: "absolute", left: 470, top: 250, width: 820, height: 240, borderRadius: "50%", background: "#d3dde8" }} />
        <div style={{ position: "absolute", left: 0, top: 352, width: 1200, height: 278, background: "linear-gradient(180deg, #cfe0b9 0%, #b9cf9d 100%)" }} />
        <div style={{ position: "absolute", left: 0, top: 320, width: 1200, height: 60, display: "flex" }}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
            <div key={i} style={{ width: 120, height: 70, marginLeft: i ? -20 : -10, borderRadius: "50%", background: i % 2 ? "#a9c78f" : "#9dbd85" }} />
          ))}
        </div>
        {/* 돌탑 */}
        <Tower left={92} bottom={60} stones={[[118, 46, "#cfc6b8"], [100, 40, "#bdb4a6"], [84, 36, "#d8cfc2"], [66, 30, "#c4baab"], [50, 26, "#d2c9bb"]]} />
        <Tower left={560} bottom={74} stones={[[92, 38, "#c9c0b2"], [76, 32, "#d6cdc0"], [60, 28, "#beb5a7"]]} />
        <Malang />
        {/* 이름 */}
        <div style={{ position: "absolute", left: 96, top: 74, display: "flex", flexDirection: "column", color: INK }}>
          <div style={{ fontSize: 92, lineHeight: 1.1 }}>이뤄져요,</div>
          <div style={{ fontSize: 92, lineHeight: 1.1 }}>돌탑의 숲</div>
          <div style={{ marginTop: 22, fontSize: 30, color: "#6f6478" }}>함께 돌을 쌓고 소원을 비는 마을</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "ONE Mobile Title", data: font, style: "normal", weight: 400 }] },
  );
}
