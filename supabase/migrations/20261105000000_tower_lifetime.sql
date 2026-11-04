-- 탑 기본 수명 1시간 → 하루, 합장 보너스 10분 → 1시간. 합장 간격(탑마다 10분에 한 번)은 그대로다.
-- 이미 서 있는 탑의 남은 수명은 바꾸지 않는다.
alter table public.towers alter column expires_at set default now() + interval '24 hours';

create or replace function public.pray(p_tower uuid) returns jsonb
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

  update public.towers set expires_at = expires_at + interval '1 hour'
   where id = p_tower returning expires_at into v_expires;
  return jsonb_build_object('ok', true, 'expires_at', v_expires);
end $$;
