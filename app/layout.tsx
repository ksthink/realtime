import type { Metadata, Viewport } from "next";
import { Gowun_Dodum } from "next/font/google";
import "./globals.css";

const font = Gowun_Dodum({ weight: "400", subsets: ["latin"], display: "swap" });

const TITLE = "이뤄져요, 돌탑의 숲";
const DESCRIPTION = "함께 돌을 쌓고 소원을 비는 실시간 마을. 지나가던 사람의 합장이 탑의 수명을 늘려요.";

// 공유 미리보기 그림은 app/opengraph-image.tsx가 만든다. 절대 주소가 필요해 배포 주소를 NEXT_PUBLIC_SITE_URL로 받는다(없으면 Vercel 주소)
export const metadata: Metadata = {
  ...(process.env.NEXT_PUBLIC_SITE_URL && { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL) }),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", locale: "ko_KR", siteName: TITLE },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  verification: { other: { "metamoa-site-verification": "pJ_yfWYtZ_3XTTEaZUHUAa" } },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={font.className}>{children}</body>
    </html>
  );
}
