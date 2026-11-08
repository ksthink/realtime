-- 소원을 빌지 않은 탑은 마지막으로 돌을 쌓은 뒤 10분이 지나면 사라진다(쌓은 돌도 함께, on delete cascade).
-- 돌을 쌓을 때마다 10분이 새로 시작되고, 합장으로는 늘어나지 않는다.
-- 소원을 빌면 그때부터 하루를 살고, 합장할 때마다 1시간씩 늘어난다(지금까지와 같다).

alter table public.towers alter column expires_at set default now() + interval '10 minutes';

-- 이미 서 있는, 소원 없는 탑도 같은 규칙을 따른다
update public.towers set expires_at = least(expires_at, now() + interval '10 minutes') where wish is null;

-- 돌이 탑에 쌓이면(첫돌 포함) 소원 없는 탑의 수명을 10분으로 되돌린다.
-- drop_stone을 통째로 다시 쓰지 않으려고 트리거로 둔다
create function public.unwished_tower_restart() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.towers set expires_at = now() + interval '10 minutes'
   where id = new.tower_id and wish is null;
  return null;
end $$;

create trigger stones_stacked_restart
after insert or update of tower_id on public.stones
for each row when (new.tower_id is not null)
execute function public.unwished_tower_restart();

-- 소원을 빌면 그때부터 하루
create or replace function public.set_wish(p_wish text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_wish text := left(btrim(coalesce(p_wish, '')), 24);
begin
  if auth.uid() is null or v_wish = '' then return false; end if;
  update public.towers t set wish = v_wish, owner_id = null, expires_at = now() + interval '24 hours'
   where t.owner_id = auth.uid() and t.expires_at > now()
     and (select count(*) from public.stones s where s.tower_id = t.id) >= 5;
  return found;
end $$;

-- 합장은 소원 없는 탑에도 할 수 있지만 수명은 소원을 빈 탑만 늘어난다. extended로 알려 준다
create or replace function public.pray(p_tower uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_expires timestamptz;
  v_last timestamptz;
  v_wished boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select wish is not null into v_wished from public.towers where id = p_tower and expires_at > now() for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;

  insert into public.prayers as p (tower_id, user_id) values (p_tower, v_uid)
  on conflict (tower_id, user_id) do update set prayed_at = now()
    where p.prayed_at <= now() - interval '10 minutes';
  if not found then
    select prayed_at into v_last from public.prayers where tower_id = p_tower and user_id = v_uid;
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'prayed_at', v_last);
  end if;

  if v_wished then
    update public.towers set expires_at = expires_at + interval '1 hour'
     where id = p_tower returning expires_at into v_expires;
  else
    select expires_at into v_expires from public.towers where id = p_tower;
  end if;
  return jsonb_build_object('ok', true, 'expires_at', v_expires, 'extended', v_wished);
end $$;
