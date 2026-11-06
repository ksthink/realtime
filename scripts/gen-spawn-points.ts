// 돌이 생길 수 있는 땅(물·산 제외) 좌표를 뽑아 마이그레이션으로 쓴다.
// 서버가 지형 함수를 몰라도 돌을 물에 빠뜨리지 않기 위해서다. 지형을 바꾸면 다시 돌릴 것.
// `ring` 인자: 넓힌 바깥 고리(70~110m)만 뽑아 insert 문을 표준출력에 쓴다 (기존 지점은 그대로 둔다).
import { writeFileSync } from "node:fs";
import { rng, terrainY, isWater, waterDistance } from "../lib/terrain";

if (process.argv[2] === "ring") {
  // 기본 분포의 70m 지점 시도 밀도(≈0.176/m²)에 맞춘 시도 횟수. 고리 안은 면적에 고르게
  const r = rng(2027), TRIES = 3974, R0 = 70, R1 = 110;
  const points: string[] = [];
  for (let i = 0; i < TRIES; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(R0 * R0 + r() * (R1 * R1 - R0 * R0));
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    // 물가 2m 안은 뺀다: 돌다리 위에 돌이 생기지 않게
    if (isWater(x, z) || terrainY(x, z) > 5 || waterDistance(x, z, 2) !== Infinity) continue;
    points.push(`(${x.toFixed(2)},${z.toFixed(2)})`);
  }
  console.log(`insert into public.spawn_points (x, z) values\n${points.join(",\n")};`);
  console.error(`${points.length} points`);
  process.exit(0);
}

const r = rng(2026);
const points: string[] = [];
while (points.length < 3000) {
  // 가운데에 더 많이: 반경을 제곱근 없이 뽑아 중심 쪽으로 몰리게 한다
  const a = r() * Math.PI * 2;
  const d = 2 + Math.pow(r(), 0.75) * 68;
  const x = Math.cos(a) * d, z = Math.sin(a) * d;
  if (isWater(x, z) || terrainY(x, z) > 5) continue;
  points.push(`(${x.toFixed(2)},${z.toFixed(2)})`);
}
writeFileSync(
  "supabase/migrations/20261104000001_spawn_points.sql",
  `-- scripts/gen-spawn-points.ts 가 생성함\ninsert into public.spawn_points (x, z) values\n${points.join(",\n")};\n`,
);
console.log(`${points.length} points`);
