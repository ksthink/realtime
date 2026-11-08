-- 소원을 빈 탑은 빈 순간부터 3일을 살고, 합장마다 3시간씩 늘어난다(전에는 하루, 1시간).
-- 이미 소원을 빈 탑의 남은 시간은 그대로 두고, 앞으로 받는 합장부터 3시간씩 늘린다.
-- 소원을 빌지 않은 탑은 그대로 마지막 돌을 쌓고 10분이다(20261108000000_unwished_ten_minutes).

create or replace function public.set_wish(p_wish text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_wish text := left(btrim(coalesce(p_wish, '')), 24);
begin
  if auth.uid() is null or v_wish = '' then return false; end if;
  update public.towers t set wish = v_wish, owner_id = null, expires_at = now() + interval '3 days'
   where t.owner_id = auth.uid() and t.expires_at > now()
     and (select count(*) from public.stones s where s.tower_id = t.id) >= 5;
  return found;
end $$;

create or replace function public.pray(p_tower uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_expires timestamptz;
  v_last timestamptz;
  v_wished boolean;
  v_count int;
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

  -- 수명은 소원을 빈 탑만 늘어난다
  update public.towers
     set pray_count = pray_count + 1,
         expires_at = case when v_wished then expires_at + interval '3 hours' else expires_at end
   where id = p_tower returning expires_at, pray_count into v_expires, v_count;
  return jsonb_build_object('ok', true, 'expires_at', v_expires, 'extended', v_wished, 'pray_count', v_count);
end $$;
