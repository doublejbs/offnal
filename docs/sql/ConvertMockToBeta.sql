-- 테스트 배포(PAYMENT_PROVIDER=mock) 데이터를 베타 무료 운영(BILLING_MODE=beta_free)용으로 변환한다 (Spec §20.5).
--
-- 목적
--   - mock 결제로 받은 월 이용권과 테스트 기간의 trial 이용권을 모두 beta 이용권으로 바꾼다.
--     (2026-10-08 결정: trial을 beta로 바꿔 정식 결제 때 무료 두 달을 그대로 남긴다.)
--   - 이용권 없이 남은 공개 월을 beta 이용권으로 채워 ICS·PNG 내보내기가 402로 막히지 않게 한다.
--   - mock 결제 이벤트·결제 행을 지워 `pnpm db:check`의 mock 경고를 없앤다.
--   - docs/sql/CleanupMockPayments.sql은 베타 전환에 쓰지 않는다(이용권을 지워 그 달 ICS·PNG가 402가 된다).
--
-- 언제 실행하나
--   - 마이그레이션 0007(entitlements_source_check에 'beta' 추가)이 적용된 뒤 — `pnpm db:check`로 8개 적용 확인.
--   - Vercel 환경 변수를 BILLING_MODE=beta_free(OFFNAL_ENV=production, PAYMENT_PROVIDER 삭제)로 바꾼 뒤 재배포가 완료된 후.
--     (이유: 환경 전환 전에 이 SQL을 실행하면 구 배포가 계속 같은 DB에서 trial 행을 만들 수 있으므로, beta_free 배포 후에 SQL을 실행해야 안전하다.)
--   - Supabase 대시보드 SQL Editor에서 이 파일 전체를 한 번에 실행한다. 한 트랜잭션이라 중간에 실패하면 모두 되돌아간다.
--   - 여러 번 실행해도 결과가 같다(두 번째 실행부터는 바뀌는 행이 없다).
--
-- 실행 전 진단 (읽기 전용 — 필요하면 주석을 풀어 따로 실행)
--   select source, (payment_id is null) as no_payment, count(*) from entitlements group by 1, 2 order by 1, 2;
--   select provider, status, count(*) from payments group by 1, 2 order by 1, 2;
--   select provider, count(*) from payment_events group by 1 order by 1;
--   select count(*) as months_without_entitlement
--   from published_months pm
--   join calendars c on c.id = pm.calendar_id
--   where not exists (
--     select 1 from entitlements e where e.user_id = c.owner_id and e.year_month = pm.year_month
--   );
--   select count(*) as applied_migrations from drizzle.__drizzle_migrations;

begin;

-- 1. mock 결제에 연결된 이용권 → beta (결제 연결은 끊는다)
update entitlements e
set source = 'beta', payment_id = null
from payments p
where p.id = e.payment_id
  and p.provider = 'mock';

-- 2. 테스트 기간의 trial 이용권 → beta (정식 결제 때 무료 두 달 보존)
update entitlements
set source = 'beta'
where source = 'trial';

-- 3. 이용권 없는 공개 월 → beta 이용권 채우기
--    published_months는 개인 달력(calendars, 사용자당 1개)만 담는다. 팀 월(team_rosters)은 개인 이용권을 쓰지 않으므로 대상이 아니다.
insert into entitlements (user_id, year_month, source)
select c.owner_id, pm.year_month, 'beta'
from published_months pm
join calendars c on c.id = pm.calendar_id
on conflict (user_id, year_month) do nothing;

-- 4. mock 결제 이벤트 → mock 결제 삭제
delete from payment_events
where provider = 'mock';

delete from payments
where provider = 'mock';

commit;

-- 실행 후 확인: trial·mock이 모두 0이고, 이용권 없는 공개 월이 0이어야 한다. 이어서 `pnpm db:check`에 mock 경고가 없는지 확인한다.
select
  (select count(*) from entitlements where source = 'trial') as trial_entitlements,
  (select count(*) from entitlements where source = 'beta') as beta_entitlements,
  (select count(*) from payments where provider = 'mock') as mock_payments,
  (select count(*) from payment_events where provider = 'mock') as mock_payment_events,
  (
    select count(*)
    from published_months pm
    join calendars c on c.id = pm.calendar_id
    where not exists (
      select 1 from entitlements e where e.user_id = c.owner_id and e.year_month = pm.year_month
    )
  ) as months_without_entitlement;
