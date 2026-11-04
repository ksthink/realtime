// 클라이언트 표시용 규칙 값. 판정은 supabase/migrations의 RPC가 내리며, 거리 값은 그쪽과 일치해야 한다.
export const STACK_RADIUS = 1.8; // 내 첫돌에서 이 안에 떨구면 쌓이고, 밖이면 버려진다
export const TOWER_GAP = 2.0; // 다른 탑과 이만큼 떨어져야 첫돌을 놓을 수 있다
export const MAX_STONES = 10;
export const WISH_AT = 5;
export const WISH_MAX = 24;
export const PRAY_COOLDOWN_MS = 10 * 60 * 1000;
export const PICK_RANGE = 1.6;
export const PRAY_RANGE = 3.2;
