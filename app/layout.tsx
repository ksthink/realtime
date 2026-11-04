import type { Metadata, Viewport } from "next";
import { Gowun_Dodum } from "next/font/google";
import "./globals.css";

const font = Gowun_Dodum({ weight: "400", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "어서 놔요, 소원 돌탑",
  description: "함께 돌을 쌓고 소원을 비는 실시간 마을. 지나가던 사람의 합장이 탑의 수명을 늘려요.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={font.className}>{children}</body>
    </html>
  );
}
