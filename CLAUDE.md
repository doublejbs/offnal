# 오프날 (offnal)

근무표 사진 → 내 근무 달력 → 캘린더 추가·링크 공유·이미지 저장 모바일 웹 MVP.

- 제품 기준: `docs/Handoff.md` (확정 기획·디자인 원본)
- 구현 설계: `docs/Spec.md` (디렉터리·DB·API·테스트 계약) — 작업 전 반드시 읽는다

## 명령

```bash
pnpm dev            # 개발 서버 (.env.local 필요, 데모: APP_MODE=demo)
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest 단위·통합 (PGlite 메모리 DB)
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm test:pg
                    # 통합 테스트를 실제 Postgres에서 실행 (파일마다 임시 DB 생성·삭제, CREATEDB 권한 필요).
                    # PGlite는 연결이 하나라 동시 트랜잭션이 직렬화되므로 FOR UPDATE 보장은 이 명령으로 확인한다
pnpm test:e2e       # Playwright E2E
pnpm build          # 프로덕션 빌드
pnpm db:generate    # Drizzle 마이그레이션 생성
pnpm db:migrate     # 마이그레이션 적용 (DATABASE_MIGRATION_URL → DATABASE_URL → PGlite)
pnpm db:check       # DB 연결·마이그레이션 수·RLS 확인
pnpm storage:check  # Supabase Storage(S3) 키 확인
```

## 컨벤션 요약

- 파일명 PascalCase, `index.ts(x)` 금지 (Next.js 규약 파일 `page.tsx`/`layout.tsx`/`route.ts` 등은 예외)
- 화살표 함수만, async/await, if 문 항상 `{}`, 선언·조건문 전후와 `return` 직전 빈 줄
- 문자열 유니언 대신 string enum, enum은 `src/domain/enums/`에 파일 하나씩
- re-export 금지, 경로 별칭 `@/` → `src/`
- API 라우트 핸들러는 `next/headers` 대신 `NextRequest`/`NextResponse` 쿠키만 사용 (통합 테스트에서 직접 호출)
- 로그인 전 응답·HTML에 인식된 이름·근무 데이터 금지. 권한 판정은 항상 서버
- **새 테이블을 추가하면 RLS 활성화 마이그레이션(`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)도 추가하고 `pnpm db:check`로 확인**한다 (테스트도 모든 public 테이블의 RLS를 검사한다)
- 인증은 Supabase Auth(카카오). 서버에서 Supabase 세션은 `getClaims()`로만 신뢰(`getSession()` 금지). 데모 로그인만 자체 `offnal_session`
- 사용자 문구·문서·커밋 메시지는 한국어
