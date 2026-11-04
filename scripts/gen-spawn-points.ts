// 돌이 생길 수 있는 땅(물·산 제외) 좌표를 뽑아 마이그레이션으로 쓴다.
// 서버가 지형 함수를 몰라도 돌을 물에 빠뜨리지 않기 위해서다. 지형을 바꾸면 다시 돌릴 것.
import { writeFileSync } from "node:fs";
import { rng, terrainY, isWater } from "../lib/terrain";

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
