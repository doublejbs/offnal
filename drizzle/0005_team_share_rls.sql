-- 팀 공유(docs/TeamShareSpec.md §5): 새 테이블도 RLS 활성 + 정책 없음(0003과 같은 규칙).
-- 서버만 DATABASE_URL(postgres 역할)로 접근하고 anon/authenticated 키로는 어떤 행도 읽거나 쓸 수 없다.
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_rosters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_roster_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_roster_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_change_acks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_shared_team_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- anon·authenticated 역할은 Supabase에만 있다(PGlite·일반 Postgres에서는 건너뛴다).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "teams", "team_members", "team_invites", "team_rosters", "team_roster_rows",
      "team_roster_changes", "member_change_acks", "member_shared_team_months" FROM anon, authenticated;
  END IF;
END
$$;
