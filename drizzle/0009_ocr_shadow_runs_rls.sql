-- OCR 그림자 실행 통계(docs/Spec.md §22): 새 테이블도 RLS 활성 + 정책 없음(0003·0005와 같은 규칙).
-- 서버만 DATABASE_URL(postgres 역할)로 접근하고 anon/authenticated 키로는 어떤 행도 읽거나 쓸 수 없다.
ALTER TABLE "ocr_shadow_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- anon·authenticated 역할은 Supabase에만 있다(PGlite·일반 Postgres에서는 건너뛴다).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "ocr_shadow_runs" FROM anon, authenticated;
  END IF;
END
$$;
