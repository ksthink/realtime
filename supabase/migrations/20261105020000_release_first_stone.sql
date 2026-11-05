-- 첫 돌 무르기: 돌이 하나뿐인 내 탑을 없애고, 그 돌은 그 자리에 바닥 돌로 남긴다.
-- 돌을 먼저 탑에서 떼어야 한다. 탑을 먼저 지우면 쌓인 돌도 함께 지워진다 (on delete cascade)
create function public.release_first_stone() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tower uuid;
begin
  if v_uid is null then return false; end if;
  select id into v_tower from public.towers where owner_id = v_uid for update;
  if not found then return false; end if;
  if (select count(*) from public.stones where tower_id = v_tower) <> 1 then return false; end if;

  update public.stones set state = 'ground', holder_id = null, tower_id = null, order_index = null,
         expires_at = public.ground_lifetime()
   where tower_id = v_tower;
  delete from public.towers where id = v_tower;
  return true;
end $$;

revoke execute on function public.release_first_stone() from public, anon;
grant execute on function public.release_first_stone() to authenticated;
