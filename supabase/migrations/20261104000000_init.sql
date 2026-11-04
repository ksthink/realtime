-- 돌탑 마을 스키마. 클라이언트는 읽기만 하고, 모든 게임 판정은 아래 RPC가 서버에서 내린다.
-- (캐릭터 저장만 RLS 아래 직접 쓰기 허용)

create table public.characters (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 12),
  seed       int  not null,
  top_color  text not null check (top_color ~ '^#[0-9a-fA-F]{6}$'),
  bottom_color text not null check (bottom_color ~ '^#[0-9a-fA-F]{6}$'),
  body       text not null check (char_length(body) <= 8000), -- 빚은 몸통 정점 (base64 int16)
  last_seen  timestamptz not null default now()
);

create table public.towers (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null unique references auth.users(id) on delete cascade, -- 1인 1탑
  owner_name text not null,
  x double precision not null,
  z double precision not null,
  wish       text check (char_length(wish) <= 24),
  expires_at timestamptz not null default now() + interval '1 hour',
  created_at timestamptz not null default now()
);

create table public.stones (
  id          uuid primary key default gen_random_uuid(),
  seed        int not null,
  radius      double precision not null,  -- 접지 반경
  height      double precision not null,
  state       text not null default 'ground' check (state in ('ground','held','stacked')),
  holder_id   uuid references auth.users(id) on delete set null,
  tower_id    uuid references public.towers(id) on delete cascade, -- 탑이 사라지면 쌓인 돌도 사라진다
  order_index int check (order_index between 0 and 9),            -- 10단 상한
  x double precision not null,
  z double precision not null,
  expires_at  timestamptz,                -- 바닥 돌만 수명이 있다
  created_at  timestamptz not null default now(),
  unique (tower_id, order_index),
  check ((state = 'stacked') = (tower_id is not null)),
  check ((state = 'ground') = (expires_at is not null))
);
create index stones_state on public.stones (state);
create unique index stones_one_held_per_user on public.stones (holder_id) where state = 'held';

create table public.prayers (
  tower_id  uuid not null references public.towers(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  prayed_at timestamptz not null default now(),
  primary key (tower_id, user_id)
);

create table public.world_state (
  id int primary key default 1 check (id = 1),
  last_tick timestamptz not null default 'epoch'
);
insert into public.world_state default values;

-- 물과 산을 피한 돌 생성 지점. 다음 마이그레이션에서 채운다 (scripts/gen-spawn-points.ts)
create table public.spawn_points (
  x double precision not null,
  z double precision not null
);

-- 권한: 읽기 공개, 쓰기는 RPC로만
alter table public.characters   enable row level security;
alter table public.towers       enable row level security;
alter table public.stones       enable row level security;
alter table public.prayers      enable row level security;
alter table public.world_state  enable row level security;
alter table public.spawn_points enable row level security;

revoke all on public.characters, public.towers, public.stones, public.prayers,
              public.world_state, public.spawn_points from anon, authenticated;
grant select on public.characters, public.towers, public.stones to anon, authenticated;
grant select on public.prayers to authenticated;
grant insert (user_id, name, seed, top_color, bottom_color, body), update (user_id, name, seed, top_color, bottom_color, body) on public.characters to authenticated;

create policy "characters: read all"  on public.characters for select using (true);
create policy "characters: insert own" on public.characters for insert to authenticated with check (auth.uid() = user_id);
create policy "characters: update own" on public.characters for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "towers: read all"      on public.towers for select using (true);
create policy "stones: read all"      on public.stones for select using (true);
create policy "prayers: read own"     on public.prayers for select to authenticated using (auth.uid() = user_id);

-- 바닥 돌의 수명: 4~12분 랜덤
create function public.ground_lifetime() returns timestamptz
language sql volatile set search_path = '' as $$
  select now() + (240 + random() * 480) * interval '1 second';
$$;

-- 돌 줍기: 먼저 도착한 요청만 성공. 한 사람은 한 개만 들 수 있다
create function public.pick_stone(p_stone uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  update public.stones
     set state = 'held', holder_id = v_uid, expires_at = null
   where id = p_stone and state = 'ground' and expires_at > now();
  return found;
exception when unique_violation then
  return false; -- 이미 다른 돌을 들고 있다
end $$;

-- 돌 내려놓기: 첫돌이면 탑 시작, 내 첫돌 근처면 쌓기(불안정하면 탑 전체 붕괴), 그 밖엔 버리기.
-- 안정성 판정과 어긋남은 서버가 정한다. 클라이언트는 결과만 그린다.
create function public.drop_stone(p_stone uuid, p_x double precision, p_z double precision) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  STACK_RADIUS constant double precision := 1.8;  -- 이 안에 떨구면 내 탑에 쌓인다 (클라이언트 lib/rules.ts와 일치)
  TOWER_GAP    constant double precision := 2.0;  -- 탑끼리 최소 간격: 첫돌을 놓을 수 있는 거리
  MAX_STONES   constant int := 10;
  v_uid uuid := auth.uid();
  v_stone public.stones;
  v_tower public.towers;
  v_below public.stones;
  v_name text;
  v_count int;
  v_contact double precision;
  v_ratio double precision;
  v_wob double precision;
  v_ox double precision;
  v_oz double precision;
  v_a public.stones;
  v_b public.stones;
  v_cx double precision;
  v_cz double precision;
  v_w double precision;
  v_support double precision;
  v_collapse boolean := false;
  v_angle double precision;
  v_dist double precision;
begin
  if v_uid is null or p_x is null or p_z is null
     or p_x = 'NaN'::double precision or p_z = 'NaN'::double precision
     or sqrt(p_x * p_x + p_z * p_z) > 80 then
    return jsonb_build_object('result', 'rejected');
  end if;

  select * into v_stone from public.stones
   where id = p_stone and state = 'held' and holder_id = v_uid for update;
  if not found then return jsonb_build_object('result', 'rejected'); end if;

  -- 수명이 다한 내 탑은 먼저 치운다 (1인 1탑 제약 때문)
  delete from public.towers where owner_id = v_uid and expires_at <= now();
  select * into v_tower from public.towers where owner_id = v_uid for update;

  if not found then
    -- 첫돌: 남의 탑에 너무 가까우면 탑을 시작할 수 없고 그냥 바닥에 놓인다
    if exists (select 1 from public.towers t
                where t.expires_at > now()
                  and sqrt((t.x - p_x) ^ 2 + (t.z - p_z) ^ 2) < TOWER_GAP) then
      update public.stones set state = 'ground', holder_id = null, x = p_x, z = p_z,
             expires_at = public.ground_lifetime() where id = p_stone;
      return jsonb_build_object('result', 'too_close');
    end if;
    select name into v_name from public.characters where user_id = v_uid;
    insert into public.towers (owner_id, owner_name, x, z)
    values (v_uid, coalesce(v_name, '말랑이'), p_x, p_z) returning * into v_tower;
    update public.stones set state = 'stacked', holder_id = null, tower_id = v_tower.id,
           order_index = 0, x = p_x, z = p_z, expires_at = null where id = p_stone;
    return jsonb_build_object('result', 'first', 'tower_id', v_tower.id);
  end if;

  select count(*) into v_count from public.stones where tower_id = v_tower.id;

  -- 첫돌에서 멀면(또는 10단이 다 찼으면) 버리기. 다시 주울 수 있다
  if sqrt((v_tower.x - p_x) ^ 2 + (v_tower.z - p_z) ^ 2) > STACK_RADIUS or v_count >= MAX_STONES then
    update public.stones set state = 'ground', holder_id = null, x = p_x, z = p_z,
           expires_at = public.ground_lifetime() where id = p_stone;
    return jsonb_build_object('result', case when v_count >= MAX_STONES then 'full' else 'discarded' end);
  end if;

  -- 안착 위치: 아래 돌에서 어긋난다. 작은 돌 위에 큰 돌을 올릴수록 더 크게 어긋난다
  select * into v_below from public.stones where tower_id = v_tower.id and order_index = v_count - 1;
  v_contact := least(v_stone.radius, v_below.radius);
  v_ratio   := greatest(0, v_stone.radius / v_below.radius - 1);
  v_wob     := v_contact * (0.35 + v_ratio * 0.9);
  v_ox := v_below.x + (random() - 0.5) * 2 * v_wob;
  v_oz := v_below.z + (random() - 0.5) * 2 * v_wob;

  update public.stones set state = 'stacked', holder_id = null, tower_id = v_tower.id,
         order_index = v_count, x = v_ox, z = v_oz, expires_at = null where id = p_stone;

  -- 안정 판정: 각 층 위 돌들의 무게중심(무게 ∝ 면적 × 높이)이 접촉면을 벗어나면 붕괴
  for k in 0 .. v_count - 1 loop
    select * into v_a from public.stones where tower_id = v_tower.id and order_index = k;
    select * into v_b from public.stones where tower_id = v_tower.id and order_index = k + 1;
    select sum(s.x * s.radius ^ 2 * s.height), sum(s.z * s.radius ^ 2 * s.height), sum(s.radius ^ 2 * s.height)
      into v_cx, v_cz, v_w
      from public.stones s where s.tower_id = v_tower.id and s.order_index > k;
    v_ratio   := greatest(0, v_b.radius / v_a.radius - 1);
    v_support := least(v_a.radius, v_b.radius) * 0.8 / (1 + v_ratio * 1.5);
    if sqrt((v_cx / v_w - v_a.x) ^ 2 + (v_cz / v_w - v_a.z) ^ 2) > v_support then
      v_collapse := true;
      exit;
    end if;
  end loop;

  if not v_collapse then
    return jsonb_build_object('result', 'stacked', 'tower_id', v_tower.id, 'count', v_count + 1);
  end if;

  -- 붕괴: 탑과 소원은 삭제, 돌은 전부 주변에 흩어져 다시 주울 수 있는 바닥 돌이 된다
  for v_a in select * from public.stones where tower_id = v_tower.id for update loop
    v_angle := random() * 2 * pi();
    v_dist  := 0.8 + random() * 2.2;
    update public.stones set state = 'ground', holder_id = null, tower_id = null, order_index = null,
           x = v_tower.x + cos(v_angle) * v_dist, z = v_tower.z + sin(v_angle) * v_dist,
           expires_at = public.ground_lifetime()
     where id = v_a.id;
  end loop;
  delete from public.towers where id = v_tower.id;
  return jsonb_build_object('result', 'collapsed');
end $$;

-- 합장: 같은 사람은 같은 탑에 10분에 한 번. 수명 +10분, 상한 없음
create function public.pray(p_tower uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_expires timestamptz;
  v_last timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  perform 1 from public.towers where id = p_tower and expires_at > now() for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;

  insert into public.prayers as p (tower_id, user_id) values (p_tower, v_uid)
  on conflict (tower_id, user_id) do update set prayed_at = now()
    where p.prayed_at <= now() - interval '10 minutes';
  if not found then
    select prayed_at into v_last from public.prayers where tower_id = p_tower and user_id = v_uid;
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'prayed_at', v_last);
  end if;

  update public.towers set expires_at = expires_at + interval '10 minutes'
   where id = p_tower returning expires_at into v_expires;
  return jsonb_build_object('ok', true, 'expires_at', v_expires);
end $$;

-- 소원: 5단 이상인 내 탑에 24자까지
create function public.set_wish(p_wish text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_wish text := left(btrim(coalesce(p_wish, '')), 24);
begin
  if auth.uid() is null or v_wish = '' then return false; end if;
  update public.towers t set wish = v_wish
   where t.owner_id = auth.uid() and t.expires_at > now()
     and (select count(*) from public.stones s where s.tower_id = t.id) >= 5;
  return found;
end $$;

-- 월드 유지보수. 접속자들이 15초마다 호출하고, 실제 작업은 8초에 한 번만 돈다.
-- 접속자가 없으면 돌 필요가 없으므로 cron을 두지 않는다.
create function public.world_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  TARGET_GROUND constant int := 240;
  v_missing int;
begin
  if auth.uid() is null then return; end if;
  update public.characters set last_seen = now() where user_id = auth.uid();

  update public.world_state set last_tick = now()
   where id = 1 and last_tick < now() - interval '8 seconds';
  if not found then return; end if;

  delete from public.towers where expires_at <= now();
  delete from public.stones where state = 'ground' and expires_at <= now();

  -- 돌을 든 채 사라진 사람의 돌은 주웠던 자리로 돌아간다
  update public.stones s set state = 'ground', holder_id = null, expires_at = public.ground_lifetime()
   where s.state = 'held'
     and not exists (select 1 from public.characters c
                      where c.user_id = s.holder_id and c.last_seen > now() - interval '60 seconds');

  select greatest(0, TARGET_GROUND - count(*)) into v_missing from public.stones where state = 'ground';
  if v_missing > 0 then
    insert into public.stones (seed, radius, height, x, z, expires_at)
    -- 지점 추첨을 안쪽 쿼리로 분리한다. 같은 수준에서 order by random()과 크기의 random()을 함께 쓰면
    -- Postgres가 같은 값으로 처리해 작은 돌만 뽑힌다
    select (random() * 2147483647)::int, q.r, q.r * (0.45 + random() * 0.45), q.x, q.z, public.ground_lifetime()
      from (select p.x, p.z, 0.2 + random() * 0.3 as r
              from (select x, z from public.spawn_points order by random() limit v_missing offset 0) p) q;
  end if;
end $$;

revoke execute on function public.ground_lifetime() from public, anon, authenticated;
revoke execute on function public.pick_stone(uuid), public.drop_stone(uuid, double precision, double precision),
                 public.pray(uuid), public.set_wish(text), public.world_tick() from public, anon;
grant execute on function public.pick_stone(uuid), public.drop_stone(uuid, double precision, double precision),
                 public.pray(uuid), public.set_wish(text), public.world_tick() to authenticated;

-- 실시간 전파
alter publication supabase_realtime add table public.stones, public.towers;
