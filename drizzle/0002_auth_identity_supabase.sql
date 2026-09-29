-- Google 로그인 제거: 이전 제공자 행은 새 CHECK를 통과하지 못하므로 먼저 지운다(운영 데이터 없음).
DELETE FROM "auth_identities" WHERE "provider" NOT IN ('supabase', 'dev');--> statement-breakpoint
ALTER TABLE "auth_identities" DROP CONSTRAINT "auth_identities_provider_check";--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_provider_check" CHECK ("auth_identities"."provider" in ('supabase', 'dev'));
