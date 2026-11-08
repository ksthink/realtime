-- 접속 인원 전송(supabase/functions/live-count)을 10분마다 돌린다. 운영 프로젝트 전용이라 migrations에 두지 않는다.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 함수 주소는 공개이므로 cron만 호출할 수 있게 DB 안에서 만든 비밀값으로 확인한다
select vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'live_count_secret')
where not exists (select 1 from vault.secrets where name = 'live_count_secret');

create or replace function public.live_count_secret_ok(candidate text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'live_count_secret' and decrypted_secret = candidate);
$$;
revoke all on function public.live_count_secret_ok(text) from public, anon, authenticated;
grant execute on function public.live_count_secret_ok(text) to service_role;

select cron.schedule('live-count', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://smwdztojgizvnilzndyn.supabase.co/functions/v1/live-count',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'live_count_secret')),
    timeout_milliseconds := 15000
  );
$$);
