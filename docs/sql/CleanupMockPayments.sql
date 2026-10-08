-- 주의: 베타 무료 운영(BILLING_MODE=beta_free) 전환에는 이 파일을 쓰지 않는다.
--   mock 결제 이용권을 지우면 그 달의 ICS·PNG 내보내기가 402(결제 필요)로 막힌다.
--   베타 전환은 docs/sql/ConvertMockToBeta.sql(이용권을 beta로 바꾸고 mock 결제만 삭제)을 실행한다.
--   이 파일은 테스트 결제로 받은 달을 정말로 없애야 할 때(유료 운영으로 바로 전환 등)만 쓴다.
--
-- 테스트 배포(PAYMENT_PROVIDER=mock)에서 생긴 테스트 결제 데이터 정리.
-- 같은 Supabase 프로젝트를 OFFNAL_ENV=production으로 전환하기 전에 SQL Editor에서 한 번 실행한다.
-- 테스트 결제로 받은 월 이용권은 사라진다(무료 trial 이용권은 유지). 실행 후 `pnpm db:check`로 경고가 없는지 확인한다.
begin;

delete from entitlements e
using payments p
where p.id = e.payment_id
  and p.provider = 'mock';

delete from payment_events where provider = 'mock';

delete from payments where provider = 'mock';

commit;
