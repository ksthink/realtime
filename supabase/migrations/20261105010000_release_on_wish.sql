-- 소원을 빌면 탑의 소유권이 사라진다. 주인 없는 탑은 수명이 다할 때까지 마을에 남고, 합장만 받는다.
-- 빌었던 사람은 곧바로 새 탑을 시작할 수 있다. (owner_id의 unique 제약은 null끼리 충돌하지 않는다)
alter table public.towers alter column owner_id drop not null;

-- 이미 소원이 적힌 탑도 같은 규칙을 따른다
update public.towers set owner_id = null where wish is not null;

create or replace function public.set_wish(p_wish text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_wish text := left(btrim(coalesce(p_wish, '')), 24);
begin
  if auth.uid() is null or v_wish = '' then return false; end if;
  update public.towers t set wish = v_wish, owner_id = null
   where t.owner_id = auth.uid() and t.expires_at > now()
     and (select count(*) from public.stones s where s.tower_id = t.id) >= 5;
  return found;
end $$;
