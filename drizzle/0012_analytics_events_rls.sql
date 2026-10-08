-- 지표 이벤트(docs/Spec.md §23): 새 테이블도 RLS 활성 + 정책 없음(0003·0005·0009와 같은 규칙).
-- 서버만 DATABASE_URL(postgres 역할)로 접근하고 anon/authenticated 키로는 어떤 행도 읽거나 쓸 수 없다.
ALTER TABLE "analytics_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- anon·authenticated 역할은 Supabase에만 있다(PGlite·일반 Postgres에서는 건너뛴다).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "analytics_events" FROM anon, authenticated;
  END IF;
END
$$;
