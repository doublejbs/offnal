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
