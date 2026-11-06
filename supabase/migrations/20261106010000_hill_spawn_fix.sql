-- 동산 계단을 넓히고 꼭대기·나무 밑동의 걸을 수 있는 범위를 줄이면서 새로 막힌 자리의 생성 지점을 뺀다.
-- lib/terrain.ts의 hillBlocked(x, z) || onStairs(x, z)로 골랐다. 여러 번 실행해도 결과가 같다
delete from public.spawn_points where (x, z) in (values
(27.62::double precision,-6.17::double precision),
(28.42::double precision,-18.00::double precision),
(26.59::double precision,-17.82::double precision),
(33.74::double precision,-10.97::double precision)
);
