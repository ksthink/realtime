-- 탑이 받은 합장 수. 푯말에 ♥ (N)으로 보인다. 합장이 받아들여질 때마다 1씩 는다(같은 사람도 10분마다 다시 센다)
alter table public.towers add column if not exists pray_count int not null default 0;

-- 이미 서 있는 탑은 합장한 사람 수로 시작한다(지금까지 몇 번 했는지는 남아 있지 않다)
update public.towers t set pray_count = (select count(*) from public.prayers p where p.tower_id = t.id);

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

  -- 수명은 소원을 빈 탑만 늘어난다(20261108000000_unwished_ten_minutes)
  update public.towers
     set pray_count = pray_count + 1,
         expires_at = case when v_wished then expires_at + interval '1 hour' else expires_at end
   where id = p_tower returning expires_at, pray_count into v_expires, v_count;
  return jsonb_build_object('ok', true, 'expires_at', v_expires, 'extended', v_wished, 'pray_count', v_count);
end $$;
