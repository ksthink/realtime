// 클라이언트 표시용 규칙 값. 판정은 supabase/migrations의 RPC가 내리며, 거리 값은 그쪽과 일치해야 한다.
export const STACK_RADIUS = 1.8; // 내 첫돌에서 이 안에 떨구면 쌓이고, 밖이면 버려진다
export const TOWER_GAP = 2.0; // 다른 탑과 이만큼 떨어져야 첫돌을 놓을 수 있다
export const MAX_STONES = 10;
export const WISH_AT = 5;
export const WISH_MAX = 24;
export const PRAY_COOLDOWN_MS = 10 * 60 * 1000;
export const PICK_RANGE = 1.6;
export const PRAY_RANGE = 3.2;
export const MAX_PEOPLE = 50; // 인트로 화면에서만 막는 정원. 서버는 강제하지 않는다

// 남은 시간(ms) → 단위를 바꿔 짧게: 하루 넘게 "2일 23시간", 1시간~하루 "23시간 12분", 10분~1시간 "45분",
// 10분 안은 초까지 세는 "8:12". 긴 시간은 대략만 보여 푯말이 매초 바뀌지 않게 하고, 곧 사라질 때만 초를 센다
export function formatLife(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60), hour = Math.floor(min / 60), day = Math.floor(hour / 24);
  if (day >= 1) return `${day}일 ${hour % 24}시간`;
  if (hour >= 1) return `${hour}시간 ${min % 60}분`;
  if (min >= 10) return `${min}분`;
  return `${min}:${String(total % 60).padStart(2, "0")}`;
}
