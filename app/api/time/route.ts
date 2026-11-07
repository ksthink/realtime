// 서버 시각(ms). 나무지기 NPC 위치를 모든 접속자가 같은 시계로 계산하도록 쓴다
export function GET() {
  return Response.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
