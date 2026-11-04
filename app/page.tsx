"use client";

import dynamic from "next/dynamic";

// WebGL과 localStorage 세션을 쓰므로 브라우저에서만 렌더링한다
const App = dynamic(() => import("@/components/App"), { ssr: false });

export default function Page() {
  return <App />;
}
