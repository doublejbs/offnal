# 오프날

근무표 사진 한 장으로 **내 근무만** 뽑아 월간 달력으로 정리하고, 개인 캘린더(ICS)·읽기 전용 링크·PNG 이미지로 가족과 나누는 모바일 웹 MVP.

- 제품 기준: [`docs/Handoff.md`](docs/Handoff.md) — 확정 기획·요금 정책·디자인 원본
- 구현 설계: [`docs/Spec.md`](docs/Spec.md) — 디렉터리·DB·API·권한 경계·테스트 계약
- 작업 규칙: [`CLAUDE.md`](CLAUDE.md)

## 기술 구성

| 영역 | 선택 | 비고 |
|---|---|---|
| 앱 | Next.js 16 App Router + TypeScript | 화면과 API 한 저장소 |
| DB | Supabase Postgres + Drizzle ORM (서버가 `DATABASE_URL`로 직접 연결, 모든 테이블 RLS + 정책 없음) | 로컬 개발도 개발용 클라우드 Supabase 프로젝트. 자동 테스트·키 없는 데모만 PGlite |
| 원본 저장 | Supabase Storage 비공개 버킷(S3 호환 엔드포인트) / 로컬 파일(테스트·데모) | 공개 URL 없음 |
| 로그인 | Supabase Auth(`@supabase/ssr`, PKCE, `sb-*` 세션 쿠키) + **카카오** / 데모 로그인(자체 세션, 데모 모드 전용) | 아래 “로그인 수단” 참고 |
| 인식 | Anthropic Claude (`claude-opus-5-5`) / Google Gemini (`@google/genai`) / mock — 이미지 입력 + JSON 스키마 구조화 출력 | 제공자·모델·effort는 환경 변수로 교체 |
| 결제 | 토스페이먼츠 결제위젯 + 서버 승인·재조회 / mock 테스트 결제 | 단건 결제, 자동 결제 없음 |
| 캘린더 | `ics` 라이브러리로 일회성 가져오기 파일 | 자동 동기화 아님 |
| 이미지 | 브라우저 Canvas로 PNG 생성 | 권한 확인 API 데이터만 사용 |

### 로그인 수단 (확정: Supabase Auth + 카카오)

고객 확정(2026-09-29)에 따라 **Supabase Auth의 카카오 로그인**을 씁니다(Google 제거).

- `/auth/login?provider=kakao` → Supabase `signInWithOAuth`(PKCE, verifier는 `sb-*` 쿠키) → 카카오 동의 → `/auth/callback`에서 `exchangeCodeForSession` → 앱 `users` 행과 `auth_identities(provider='supabase', subject=Supabase user id)` 연결 + 비회원 인식 작업 claim(한 트랜잭션).
- 로그인 뒤 세션은 Supabase 세션 쿠키 자체입니다(앱 자체 `offnal_session`은 발급하지 않음). 요청마다 `auth.getClaims()`로 JWT 서명을 검증한 `sub`만 믿습니다. 세션 갱신은 `src/proxy.ts`(Next 16 Proxy)가 합니다.
- 비회원 작업은 계속 앱의 `offnal_anon` 쿠키로 통제합니다. 콜백을 끝내지 못한(앱 user 행이 없는) Supabase 세션은 비로그인으로 취급합니다.
- 데모 모드의 “데모 로그인”만 기존 자체 세션(`offnal_session`)을 씁니다.

## 빠른 시작 (데모 모드)

외부 키 없이 전체 흐름을 확인하는 개발 전용 모드입니다. 인식은 가상 fixture, 결제는 “테스트 결제” 버튼, 로그인은 “데모 로그인”이며 화면 상단에 **개발 데모 모드** 배너가 항상 보입니다.

```bash
pnpm install
cp .env.example .env.local        # 기본값이 데모 모드
pnpm dev:https                    # https://localhost:3000 (Next가 mkcert로 로컬 인증서 발급)
# 이미 3000 포트를 쓰는 서버가 있으면: pnpm dev:https --port 3001  (APP_URL도 같은 포트로)
```

`APP_URL`은 실제로 접속하는 주소와 **정확히 같아야** 합니다(CSRF Origin 검사·공유 링크에 사용).

데모 흐름: 사진 선택(아무 표 사진; 가로 300px 미만 이미지는 인식 실패 경로) → 흐린 달력 + 로그인 → 데모 로그인(표시 이름 입력) → 이름·월 선택 → “확인 필요” 날짜 수정 → 무료 저장 → 공유·ICS·PNG → 세 번째 달은 테스트 결제.

> 데모 로그인은 **PGlite(키 없는 데모) 또는 개발 전용 DB에서만** 쓰세요. 실사용자가 있는 Supabase DB에 `APP_MODE=demo`로 붙이면 데모 계정·세션이 실데이터에 섞입니다. 데모 로그인은 같은 표시 이름을 입력하면 같은 계정으로 들어갑니다. 공개된 preview에서 데모 모드를 켜면 사람끼리 계정이 겹칠 수 있으니 내부 확인용으로만 쓰세요. `OFFNAL_ENV=production`에서는 데모 모드·mock 제공자·PGlite·로컬 저장소가 **기동 단계에서 차단**됩니다.

## 명령

```bash
pnpm dev / pnpm dev:https   # 개발 서버
pnpm lint                   # ESLint (컨벤션 규칙 포함)
pnpm typecheck              # tsc --noEmit
pnpm test                   # Vitest 단위·통합 (PGlite 메모리 DB, mock 제공자)
pnpm test:e2e               # Playwright E2E (데모 모드 서버를 3100 포트로 자동 기동)
TEST_DATABASE_URL=postgres://... pnpm test:pg   # 통합 테스트를 실제 Postgres에서 (파일마다 임시 DB, CREATEDB 권한 필요)
pnpm build && pnpm start    # 프로덕션 빌드·실행
pnpm db:generate            # 스키마 변경 → drizzle/ 마이그레이션 생성
pnpm db:migrate             # .env.local의 DATABASE_MIGRATION_URL(없으면 DATABASE_URL, 둘 다 없으면 PGlite)에 마이그레이션 적용
pnpm db:check               # DATABASE_URL 연결·적용된 마이그레이션 수·모든 앱 테이블 RLS·anon 권한 확인 (비밀번호 출력 안 함)
pnpm storage:check          # S3(Supabase Storage) 키로 검사 객체 put·get·delete (비밀값 출력 안 함)
pnpm ocr:shadow-report -- --days 7   # 최근 N일 OCR 그림자 실행 집계 (DATABASE_URL 필요, 수치만 출력)
```

PGlite는 연결이 하나라 동시 트랜잭션이 직렬화됩니다. “서로 다른 세 달 동시 저장에도 무료는 두 달”을 보장하는 `FOR UPDATE` 잠금은 `pnpm test:pg`로 실제 Postgres에서 확인해야 합니다.

## 실서비스 설정

환경 변수 전체와 설명은 [`.env.example`](.env.example)에 있습니다. 숫자 한도·TTL·가격은 모두 **초기 제안값**입니다.

### 공통

| 변수 | 값 |
|---|---|
| `OFFNAL_ENV` | `production` (preview 배포는 `preview`) |
| `APP_MODE` | `live` |
| `APP_URL` | `https://<도메인>` (production은 https 필수) |
| `APP_SECRET` | 32바이트 이상 무작위 값 (`openssl rand -base64 48`) — 세션·공유 토큰 암호화 키 파생 |
| `DATABASE_URL` | Supabase Transaction pooler URL (아래 “Supabase 설정”) |
| `DATABASE_MIGRATION_URL` | Supabase Session pooler 또는 Direct URL (`pnpm db:migrate` 전용) |
| `BILLING_MODE` | `paid`(기본값, 무료 두 달 후 월 결제) \| `beta_free`(베타 무료 운영, 아래 “베타 무료 운영”) |

배포 전·스키마 변경 시 대상 DB 접속 문자열을 넣은 `.env.local`로 `pnpm db:migrate` → `pnpm db:check`를 실행합니다. 서버리스에서 동시 마이그레이션을 피하려고 운영 DB는 앱 기동 시 자동 마이그레이션하지 않습니다.

### Supabase 설정 (DB·인증·원본 저장소)

값을 넣을 곳은 모두 `.env.local`(로컬) / 배포 환경 변수입니다. 로컬 개발도 **개발용 클라우드 프로젝트**에 연결하고, 운영은 별도 프로젝트를 권장합니다.

**1. 프로젝트 만들기**

- [supabase.com](https://supabase.com) → New project. 리전은 **Northeast Asia (Seoul) `ap-northeast-2`** 권장. DB 비밀번호를 안전하게 보관합니다.

**2. API 키 → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**

- Project Settings → Data API의 Project URL(`https://<project-ref>.supabase.co`)
- Project Settings → API Keys의 **Publishable key**(`sb_publishable_...`). 예전 프로젝트는 Legacy의 `anon` 키(`NEXT_PUBLIC_SUPABASE_ANON_KEY`)도 받습니다. 공개돼도 되는 키이며, 모든 테이블이 RLS + 정책 없음이라 이 키로는 데이터에 접근할 수 없습니다. **secret / service_role 키는 앱에 넣지 않습니다.**
- 권장: Project Settings → JWT Keys에서 **비대칭 서명 키(ECC/RSA)** 사용(새 프로젝트 기본). 이때 `getClaims()`는 캐시한 공개키로 서버 안에서 서명을 검증하고, 예전 대칭 키(HS256) 프로젝트면 요청마다 Auth 서버를 호출합니다.

**3. DB 접속 문자열 → `DATABASE_URL`, `DATABASE_MIGRATION_URL`**

- 대시보드 상단 **Connect** → Connection string
  - `DATABASE_URL`: **Transaction pooler**(포트 6543, `postgres.<project-ref>` 사용자). 서버리스 함수용
  - `DATABASE_MIGRATION_URL`: **Session pooler**(포트 5432) 또는 IPv6가 되는 환경이면 Direct connection. `pnpm db:migrate` 전용
- `*.supabase.com`/`*.supabase.co` 호스트는 항상 TLS로 연결하고 **서버 인증서를 검증**합니다. Supabase DB 인증서는 공개 CA가 아닌 Supabase 자체 루트 CA(“Supabase Root 2021 CA”, 2031-04-26 만료)로 서명되므로 이 공개 인증서를 저장소에 포함했습니다(`src/server/db/certs/SupabaseRootCa2021.crt`, 대시보드 Database Settings → SSL Configuration → Download certificate와 같은 파일). 풀러(`*.pooler.supabase.com`, 6543·5432)가 이 CA로 검증되는 것을 실제 프로젝트에서 확인했습니다. 다른 CA가 필요하면 `DATABASE_SSL_ROOT_CERT`(PEM)로 덮어씁니다. 그 밖의 호스트는 libpq `sslmode`를 따르며(`verify-*`는 시스템 CA로 검증, `require`는 암호화), production에서 `sslmode=disable`은 거부합니다.
- `pnpm db:migrate` → `pnpm db:check`로 마이그레이션 수와 “RLS 미적용: 없음”, “anon/authenticated 테이블 권한: 없음”을 확인합니다. 마이그레이션 `0003_supabase_rls`가 모든 앱 테이블에 RLS를 켜고 `anon`·`authenticated` 권한을 회수합니다(서버는 테이블 소유자인 `postgres` 역할로 접속해 RLS 영향을 받지 않습니다).

**4. 원본 저장소 → `STORAGE_DRIVER=s3`, `S3_*`**

- Storage → New bucket: 이름(예: `offnal-sources`), **Public bucket 끔**, 정책(Policies)은 추가하지 않습니다 → `S3_BUCKET`
- Storage → S3 Configuration(대시보드 표기: Project Settings → Storage → S3 Connection): Endpoint → `S3_ENDPOINT`(`https://<project-ref>.storage.supabase.co/storage/v1/s3`), Region → `S3_REGION`, **New access key** → `S3_ACCESS_KEY_ID`·`S3_SECRET_ACCESS_KEY`(비밀 키는 발급 때 한 번만 보임). S3 키는 RLS를 우회하는 서버 전용 키입니다. path-style 주소는 코드에서 항상 켭니다.
- `pnpm storage:check`로 검사 객체 올리기·읽기·삭제를 확인합니다.
- 원본은 저장 확정 직후 삭제되고, 방치된 원본은 `SOURCE_TTL_HOURS`(24시간) 뒤 정리 작업이 지웁니다(Hobby 플랜의 하루 1회 cron이면 최대 약 48시간). 처리업체(스토리지·AI) 쪽 보관 설정은 출시 전 별도 확인이 필요합니다.

**5. Auth → URL Configuration**

- Site URL: `APP_URL`(운영 도메인)
- Redirect URLs: `https://<도메인>/**`, 로컬은 `https://localhost:3000/**`(콜백이 `/auth/callback?returnTo=...` 형태라 쿼리까지 허용되도록 `**` 사용). preview 도메인도 필요하면 추가합니다.

**6. 카카오 개발자 콘솔 ([developers.kakao.com](https://developers.kakao.com))**

1. 내 애플리케이션 → 애플리케이션 추가
2. 앱 설정 → 플랫폼 → **Web 사이트 도메인**: `https://<도메인>`, `https://localhost:3000`
3. 제품 설정 → 카카오 로그인 → **활성화 ON**, **Redirect URI**: `https://<project-ref>.supabase.co/auth/v1/callback`
4. 제품 설정 → 카카오 로그인 → 보안 → **Client Secret** 코드 생성·활성화
5. 제품 설정 → 카카오 로그인 → **동의항목**: 닉네임(`profile_nickname`) 필수 또는 선택 동의, 프로필 사진(`profile_image`) 선택 동의, **카카오계정(이메일)(`account_email`) 선택 동의**
   - Supabase는 카카오에 항상 `account_email profile_image profile_nickname` 범위를 요청하고, `signInWithOAuth`의 `scopes`는 이 기본값에 **추가만** 됩니다(줄일 수 없음). 동의항목에 없는 범위를 요청하면 카카오가 `KOE205` 오류를 냅니다.
   - `account_email`은 **비즈 앱**에서만 설정할 수 있습니다. 앱 설정 → 일반 → 비즈니스 정보에서 비즈 앱으로 전환하세요(사업자가 없으면 “개인 개발자 비즈 앱” 전환 가능).
   - 앱은 닉네임만 씁니다(표시 이름, 없으면 “오프날 사용자”). 이메일은 받으면 `auth_identities.email`에만 저장합니다.
6. 앱 설정 → 앱 키 → **REST API 키** 확인

**7. Supabase Auth → Sign In / Providers → Kakao**

- Kakao enabled ON, **Client ID = 카카오 REST API 키**, **Client Secret = 4번의 Client Secret 코드**
- 사용자가 이메일 동의를 하지 않아도 가입되도록 **Allow users without an email** 을 켭니다.
- 앱 환경 변수: `AUTH_PROVIDERS=kakao`(데모에서 함께 시험하려면 `kakao,dev`)

로그인 취소·실패 시 인식 작업은 유지되고 같은 화면(`?login=failed`)으로 돌아와 재시도할 수 있습니다.

### 근무표 인식 (Anthropic)

`VISION_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, 선택: `VISION_MODEL`(기본 `claude-opus-5-5`), `VISION_EFFORT`(기본 `medium`), `VISION_TIMEOUT_MS`.

- 1차: 표 구조·이름 후보·연월·코드·시간 인식 → 2차: 로그인 후 선택한 사람의 날짜별 근무 추출
- 이미지는 서버에서 긴 변 2576px JPEG로 줄여 보냅니다. 거절(refusal) 시 서버 측 fallback(`server-side-fallback-2026-07-01`)을 사용합니다.
- 사진 속 글자는 데이터로만 다루도록 시스템 프롬프트와 JSON 스키마로 제한하고, 응답은 zod로 재검증합니다.
- **인식 정확도는 검증되지 않았습니다.** 동의받은 실제 근무표로 한 사람 한 달 전체 일치율·수정 칸 수·처리 시간·비용을 측정해야 합니다.
- 업로드 전 외부 AI 처리 사실을 화면에 고지합니다.

### 근무표 인식 (Gemini, 선택)

`VISION_PROVIDER=gemini`, `GEMINI_API_KEY`(Google AI Studio 키, 서버 전용), `GEMINI_TIER`(`free` | `paid`, 기본 `free`), 선택: `VISION_MODEL`(기본 `gemini-3.7-flash`), `VISION_TIMEOUT_MS`.

- 공식 `@google/genai` SDK의 `models.generateContent`로 이미지(inline base64)와 JSON 스키마(`responseMimeType: 'application/json'` + `responseJsonSchema`)를 보냅니다. 프롬프트·스키마·zod 재검증·오류 매핑은 Anthropic과 같고, nullable 표현만 Gemini 형식(`type: [T, 'null']`)으로 한곳에서 변환합니다. thinking은 모델 기본값을 씁니다.
- **무료 티어 키는 입력(사진·프롬프트)이 Google 제품 개선(학습)에 쓰일 수 있습니다.** 실제 사용자 근무표에는 반드시 결제가 연결된 **유료 티어 키**를 쓰고 `GEMINI_TIER=paid`로 명시하세요. `OFFNAL_ENV=production`에서 `GEMINI_TIER=paid`가 없으면 기동 단계에서 차단됩니다. 무료 티어는 가상·동의받은 평가 이미지에만 씁니다.

### 인식 모델 비교 평가

```bash
pnpm vision:eval -- --dir .data/eval --models gemini-3.1-flash-lite,gemini-3.7-flash,anthropic:claude-opus-5-5 --repeat 2
```

- `--dir`의 하위 폴더마다 `image.jpg` + `truth.json`(연월, 전체 이름, 코드 정의·시간, 미정의 코드, 사람별 날짜→코드)을 둡니다. `--people 이름1,이름2`로 채점 대상을 줄이고 `--repeat N`으로 반복합니다.
- 서비스와 같은 2단계(1차 표 인식 → 이름이 일치한 행으로 사람별 2차 추출 → `normalizeExtraction`)를 모델마다 실행해 정확도(날짜 일치/31, 한 달 전체 일치), 틀린 칸·null 칸, 미정의 코드(W) 유지 여부, 연월·이름 재현율·범례 시간, 처리 시간, 토큰과 유료 단가 기준 추정 비용(업로드 1건 = 1차 + 2차 1회)을 표로 출력하고 `.data/eval/results/<timestamp>.json`에 저장합니다.
- 모델 ID만 적으면 Gemini, `anthropic:<model>`은 Claude이며 `ANTHROPIC_API_KEY`가 없으면 건너뜁니다. 단가는 `src/server/vision/eval/ModelPrices.ts`(출처·기준일 명시)에서 관리합니다.
- 정답의 날짜 값을 `null`로 두면 “빈칸·판독 불가” 칸입니다. 결과도 null이면 정답이고, 코드를 채우면 “추측”으로 따로 셉니다.
- 순위는 **종단(e2e) 정확도** 기준입니다. 모델 탓 실패(1차 no_table·unreadable, MAX_TOKENS·차단·JSON/스키마 불일치)는 그 사람의 날짜를 0점으로 넣고, 인프라 실패(재시도 후에도 429, 5xx, 타임아웃, 네트워크)는 정확도에서 빼고 따로 셉니다. 성공률과 “전 단계 성공 실행만” 정확도도 함께 출력합니다.
- 429·5xx는 지수 백오프로 몇 번 재시도하고, 서버가 제시한 대기(`retryDelay`)가 상한(120초)을 넘거나 일일 한도면 바로 실패로 기록합니다. 결과는 `.data/` 아래에만 씁니다(밖이면 실행 거부). `GEMINI_TIER`가 paid가 아니면 실제 이름·사진을 쓰지 말라는 경고를 출력합니다. 평가 이미지·정답·결과는 Git에 올리지 않습니다(`.data/`).

### OCR 그림자 모드 (선택, docs/Spec.md §22)

| 변수 | 값 |
|---|---|
| `OCR_MODE` | `off`(기본) \| `shadow` — 데모 모드·테스트에서는 항상 `off` |
| `OCR_SHADOW_SAMPLE_RATE` | `0`~`1`, 기본 `0.3` — 2차 인식 중 그림자 실행할 비율. 빈 값은 기본값(0이 아님) |
| `OCR_TIMEOUT_MS` | 기본 `60000`, 최대 `120000` — 넘으면 `timeout`으로 기록. 실행 때 2차 인식 함수의 남은 시간(maxDuration 300초 − 경과 − 10초)으로 다시 줄이고, 15초 미만이면 실행하지 않고 `skipped_budget`으로 기록 |

- `shadow`면 개인 2차 인식(`/api/recognitions/[id]/extract`)이 새 초안을 만든 뒤 `after()`로 **응답 이후에** AI 없는 OCR(`tesseract.js`)을 돌려 AI 결과와 날짜별로 비교하고 `ocr_shadow_runs`에 **수치만** 저장합니다(이름·코드·사진 키 없음). 화면·API 응답·저장되는 근무는 바뀌지 않고, OCR 오류·시간 초과는 상태 값으로만 남습니다.
- 학습 데이터(kor, eng, `4.0.0_best_int`)는 npm 패키지 `@tesseract.js-data/kor`·`@tesseract.js-data/eng`에서 읽습니다(내려받기·캐시 쓰기 없음, 평가도 같음). 워커 스크립트·WASM 코어·학습 데이터는 `next.config.ts`의 `outputFileTracingIncludes`로 2차 인식 함수에만 포함됩니다(함수 번들 약 96MB, 압축 전). Vercel에서는 언어별 워커 1개를 인스턴스 안에서 재사용하고, 인스턴스당 그림자 실행은 한 번에 1개만 돕니다(겹치면 `skipped_busy`).
- 로컬 측정(샘플 1장, 언어별 워커 1개)에서 OCR 한 번에 약 2~3초, 프로세스 RSS 약 1.1GB였습니다. 함수 메모리 한도를 확인한 뒤 켭니다.
- 결과 확인: `pnpm ocr:shadow-report -- --days 7`(상태별 건수, AI 없이 처리 가능 비율, AI 대체 비율, 불일치 칸 합계, 처리 시간·메모리 p50/p95, 콜드 스타트 비율). 행은 정리 cron이 90일 뒤 삭제합니다.

### 결제 (토스페이먼츠)

`BILLING_MODE=paid`(기본값), `PAYMENT_PROVIDER=toss`, `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`(`test_` 키면 테스트 결제). `OFFNAL_ENV=production`에서 `BILLING_MODE=paid`인데 토스 키가 없으면 기동 단계에서 차단되므로, 토스 키 없이 운영하려면 `BILLING_MODE=beta_free`(아래 “베타 무료 운영”)를 씁니다.

- 토스 개발자센터 → 웹훅: `https://<도메인>/api/payments/webhook`, 이벤트 `PAYMENT_STATUS_CHANGED`(가상계좌를 쓰면 `DEPOSIT_CALLBACK`도)
- 결제 성공 리다이렉트만으로 권한을 주지 않습니다. 서버가 승인 API 결과의 주문·금액·통화를 주문 행과 대조한 뒤에만 해당 월 이용권을 발급하고, 웹훅은 본문을 믿지 않고 토스 API로 재조회합니다.
- 가격은 `PRICE_KRW` 한 곳에서 관리합니다(기본 990원).

### 함수 지역

`vercel.json`의 `regions: ["icn1"]`로 서버 함수를 서울에서 실행합니다. DB·스토리지(Supabase)가 서울(ap-northeast-2)이라, 기본값(미국 동부 iad1)이면 요청마다 태평양 왕복이 생겨 느려집니다. Supabase 리전을 바꾸면 이 값도 함께 바꿉니다.

### 정리 작업 (cron)

`CRON_SECRET`(32자 이상). `vercel.json`이 **매일 03:00 KST(`0 18 * * *`, UTC 기준)** `/api/cron/cleanup`을 호출하며 Vercel Cron은 `Authorization: Bearer $CRON_SECRET`을 자동으로 붙입니다. 현재 프로젝트가 **Vercel Hobby 플랜**이라 하루 1회만 허용되기 때문입니다. 그래서 만료된 원본 사진은 TTL 24시간 + 하루 1회 정리로 **최대 약 48시간까지** 남을 수 있습니다. 매시 정리(`0 * * * *`)로 24시간을 지키려면 Pro 플랜이 필요합니다. 다른 호스팅에서는 같은 헤더로 주기 호출하면 됩니다.

### 배포 (Vercel 기준)

**Anthropic·토스 키 없이 먼저 띄우는 테스트 배포**: 실제 Supabase(카카오 로그인·DB·Storage)에 인식·결제만 mock으로 둡니다. production에서는 mock이 기동 단계에서 차단되므로 **`OFFNAL_ENV=preview`로 등록**해야 합니다(Vercel의 Production 환경 변수로 넣더라도 `OFFNAL_ENV=preview`). 모든 화면 상단에 “테스트 환경 · 근무표 인식과 결제는 예시·테스트로 동작해요. 실제 청구 없음” 배너가 뜨고, 결제는 “테스트 결제 · 실제 청구 없음” 버튼으로만 진행되며, 데모 로그인은 꺼져 있습니다.

| 변수 | 테스트 배포 값 |
|---|---|
| `OFFNAL_ENV` / `APP_MODE` | `preview` / `live` |
| `APP_URL`, `APP_SECRET`, `CRON_SECRET` | 배포 도메인(https), 무작위 값 |
| `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 위 “Supabase 설정” |
| `STORAGE_DRIVER`, `S3_*` | `s3`와 Supabase Storage 값 (live 기본값도 `s3`) |
| `AUTH_PROVIDERS` | `kakao` |
| `VISION_PROVIDER` / `PAYMENT_PROVIDER` | `mock` / `mock` |

**테스트 결제 데이터 주의**: mock 결제로 받은 월 이용권은 DB에 `payments.provider='mock'`으로 남습니다. mock 결제를 쓰는 테스트 배포는 **운영과 다른 Supabase 프로젝트**를 쓰는 것을 권장합니다. 같은 프로젝트를 운영으로 올릴 때는 `OFFNAL_ENV=production`으로 바꾸기 **전에** Supabase SQL Editor에서 정리 SQL을 실행하고 `pnpm db:check`에 경고가 없는지 확인하세요. **베타 무료 운영으로 올릴 때는 [`docs/sql/ConvertMockToBeta.sql`](docs/sql/ConvertMockToBeta.sql)**(이용권을 `beta`로 바꾸고 mock 결제만 삭제, 아래 “베타 무료 운영”)을 씁니다. [`docs/sql/CleanupMockPayments.sql`](docs/sql/CleanupMockPayments.sql)(mock 결제에 연결된 이용권 → mock 결제 이벤트 → mock 결제 순으로 삭제)은 테스트 결제로 받은 달의 이용권까지 지워 그 달의 ICS·PNG가 402로 막히므로 베타 전환에는 쓰지 않습니다. `db:check`는 mock 결제·이용권이 남아 있으면 경고를 출력합니다. mock 인식으로 만든 가상 근무 데이터도 남으므로 별도 프로젝트가 가장 깔끔합니다.

키가 준비되면 `VISION_PROVIDER=anthropic`+`ANTHROPIC_API_KEY`, `PAYMENT_PROVIDER=toss`+토스 키로 바꾸고 `OFFNAL_ENV=production`으로 올립니다. 토스 키 없이 먼저 운영하려면 아래 “베타 무료 운영”을 따릅니다. 빌드(`next build`)는 환경 변수·DB에 접근하지 않으므로(모든 화면이 요청 시 렌더링) 값이 비어 있어도 빌드는 통과하고, 잘못된 설정은 첫 요청에서 드러납니다. Supabase 값이 없으면 `src/proxy.ts`는 아무것도 하지 않습니다.

1. 위 환경 변수를 Production/Preview에 각각 등록(preview는 `OFFNAL_ENV=preview`, 테스트 키 사용 권장)
2. `pnpm db:migrate`로 대상 DB에 마이그레이션 적용
3. 배포 후 `/api/config/public`에서 `appMode: "live"` 확인
4. 업로드 한도 4MB는 Vercel 함수 요청 본문 한도(약 4.5MB) 때문이며, 화면이 업로드 전에 사진을 줄입니다.
5. IP 기준 한도는 신뢰할 수 있는 프록시(Vercel)가 `x-forwarded-for`를 설정한다고 가정합니다. 다른 환경에서는 `src/server/http/ClientIp.ts`를 맞춰야 합니다.

#### 베타 무료 운영 (BILLING_MODE=beta_free)

결제 없이 베타로 서비스를 엽니다(Spec §20). 결제 코드는 그대로 두고 설정 하나로 잠급니다.

- 모든 달을 무료로 등록합니다. 저장하면 그 달에 `beta` 이용권이 생기고(trial 차감 없음, 월 개수 제한 없음) ICS·PNG도 그대로 받을 수 있습니다.
- 결제 API(`POST /api/payments`·`/api/payments/confirm`·`/api/payments/webhook`)는 404, `/checkout/**`는 찾을 수 없음 화면입니다. 토스 키를 검사하지 않습니다.
- 화면에서 가격·무료 개월 수·결제·이용권 문구를 숨기고, 워드마크 옆에 `베타` 라벨을 둡니다. 테스트 결제 배너도 뜨지 않습니다.

| 변수 | 베타 운영 값 |
|---|---|
| `OFFNAL_ENV` | `production` |
| `BILLING_MODE` | `beta_free` |
| `PAYMENT_PROVIDER` | **삭제** (`mock`은 production에서 기동 차단) |
| `GEMINI_TIER` | `paid` (`VISION_PROVIDER=gemini`일 때 production 필수 — 실제 근무표가 학습에 쓰이지 않게) |
| `CRON_SECRET` | 32자 이상 무작위 값 |

테스트 배포(mock 결제)를 쓰던 같은 Supabase 프로젝트를 베타 운영으로 올리는 순서:

1. 베타 무료 모드 변경을 `main`에 머지
2. `DATABASE_MIGRATION_URL`을 넣은 `.env.local`로 `pnpm db:migrate` (0007 `entitlements_source_check`에 `beta` 추가)
3. `pnpm db:check` — 마이그레이션 `적용 8 / 저장소 8` 확인 (mock 경고는 이 단계에서는 남아 있어도 됩니다)
4. Vercel Production 환경 변수를 위 표대로 바꿈 (`PAYMENT_PROVIDER` 삭제)
5. 재배포 (환경 변수는 새 배포부터 적용). Preview 배포가 같은 Supabase DB를 쓰면 Preview 환경 변수도 `BILLING_MODE=beta_free`로 설정하거나 별도 DB를 쓰세요.
6. Supabase SQL Editor에서 [`docs/sql/ConvertMockToBeta.sql`](docs/sql/ConvertMockToBeta.sql) 전체를 실행 — 한 트랜잭션으로 mock 결제 이용권·`trial` 이용권을 `beta`로 바꾸고(정식 결제 때 무료 두 달 보존), 이용권 없는 공개 월을 `beta`로 채우고, mock 결제 이벤트·결제를 삭제합니다. 여러 번 실행해도 결과가 같습니다. 마지막 확인 쿼리에서 trial·mock·이용권 없는 공개 월이 모두 0인지 보고, `pnpm db:check`에 mock 경고가 없는지 다시 확인합니다.
7. `/api/config/public`에서 `billingMode: "beta_free"`, `isMockPayment: false` 확인

**나중에 결제를 켤 때**: `BILLING_MODE=paid`와 `PAYMENT_PROVIDER=toss`(또는 삭제 유지) + `TOSS_CLIENT_KEY`·`TOSS_SECRET_KEY`를 넣고 재배포합니다(위 “결제 (토스페이먼츠)”). 베타 동안 등록한 달은 `beta` 이용권이 남아 `EXISTING`으로 계속 열리고(그 달을 결제하려 하면 409 `ALREADY_ENTITLED`), 무료 두 달은 `trial` 행만 세므로 그때부터 새로 적용됩니다. 데이터 변환은 필요 없습니다.

## 공유 미리보기(OG)

- 카카오톡·메신저 미리보기는 루트 레이아웃(`src/server/metadata/SiteMetadata.ts`)의 og/twitter 태그를 읽습니다. 이미지·링크 주소는 `APP_URL` 기준 절대 URL이 되므로 배포 환경의 `APP_URL`이 실제 도메인이어야 합니다.
- 공유 링크(`/s/:token`)는 표시 이름·월·근무 없이 고정 문구(`공유받은 근무표`)만 내보냅니다. 개인 화면(`/recognitions`·`/drafts`·`/calendar`·`/checkout`)은 noindex입니다.
- 이미지 다시 만들기: `pnpm exec tsx scripts/GenerateBrandImages.ts` → `public/og-image.png`(1200×630), `src/app/icon.png`(512), `src/app/apple-icon.png`(180). 한국어 글꼴이 필요하므로 macOS(Apple SD Gothic Neo)에서 실행하고, 결과 PNG와 가운데 630×630 영역(카카오가 1:1로 자를 수 있음)을 눈으로 확인한 뒤 커밋합니다.
- 카카오는 미리보기를 캐시합니다. 이미지·문구를 바꾼 뒤에는 [카카오 개발자 도구](https://developers.kakao.com/tool/debugger/sharing) '공유 디버거'에서 해당 URL의 캐시를 초기화하세요.

## 구현 상태

### 실제 구현 (키만 넣으면 동작하는 코드)

- 비회원 업로드 → 표 인식 → 흐린 미리보기(중립 플레이스홀더, 인증 전 응답·HTML에 이름·근무 없음) → 로그인 → 같은 작업 claim → 이름·월 선택 → 개인 추출 → 수정 → 저장
- 로그인한 사용자는 블러 없이 이름 선택으로 바로 이동, 로그인 취소·실패 시 작업 유지, 만료 시 재업로드 안내, 인식 실패는 원인·재시도 제공
- 확인 필요 칸(null)은 저장 차단, 사용자 정의 코드·휴무 여부·시간(다음 날 종료) 편집, 원본 비교·확대, 이름 미발견 시 직접 입력
- 월별 이용권: 계정당 서로 다른 두 달 무료(첫 확정 저장 시 차감), 같은 달 재저장 무료, 세 번째 달부터 단건 결제, 삭제해도 소진 이력 유지 — 모두 서버 트랜잭션에서 판정. `BILLING_MODE=beta_free`에서는 모든 달이 무료(`beta` 이용권)이고 결제 경로가 닫힙니다.
- 읽기 전용 공유 링크(공개 월 선택, 재발급·중지, no-store·noindex·no-referrer), ICS(Asia/Seoul→UTC, 야간 다음 날 종료, 휴무 기본 제외), PNG
- 업로드 검증(시그니처·크기·픽셀), 익명 세션·IP·계정별 한도, 원본 자동 삭제, CSRF Origin 검사, 보안 헤더

### 개발 모드에서만 검증

- 인식(mock fixture), 결제(mock 테스트 결제), 로그인(데모 로그인) — 실제 Supabase(카카오 로그인·DB·Storage)·Anthropic·토스 호출은 키가 없어 실행해 보지 않았습니다. 카카오 로그인 흐름은 가짜 Supabase 클라이언트로, RLS 마이그레이션은 Supabase 역할을 흉내 낸 PGlite로 통합 테스트했습니다.

### 사용자 설정 대기

- Supabase 프로젝트(URL·publishable 키·DB 접속 문자열·Storage 버킷·S3 키·URL Configuration), 카카오 앱(REST API 키·Client Secret·동의항목·비즈 앱 전환), Anthropic API 키, 토스 상점 키·웹훅, 도메인, `APP_SECRET`/`CRON_SECRET`

### 출시 전 결정·확인 필요

- 결제 사업자·세금·영수증·환불 문구(환불 시 이용권 회수 정책 포함 — 현재는 취소 이벤트를 기록만 하고 이용권 유지)
- 가상계좌: 정리 작업이 24시간 넘은 대기 주문을 취소하므로 가상계좌를 켜려면 입금 기한과 맞춰야 합니다(카드·간편결제만 쓰면 무관).
- 재인식 한도·업로드 한도·보관 기간 실측 후 조정
- 인식된 근무 시간 확인은 화면(체크박스)에서만 강제합니다.
- 취소한 초안의 원본은 같은 작업에서 다른 사람·다른 달을 다시 뽑을 수 있도록 작업 만료(24시간) 때 삭제합니다.
- CSP는 `frame-ancestors 'none'`만 적용했습니다. 토스 위젯 도메인을 포함한 전체 CSP는 결제 연동 확정 후 설계합니다.
- 실제 기기(iOS/Android)·Apple/Google 캘린더의 ICS 가져오기, 모바일 공유 시트 동작은 **미검증**입니다.

## 폴더 구조

```
src/app/            화면(page.tsx)과 API(route.ts)
src/components/     화면 컴포넌트 (*View.tsx + Use*State.ts)
src/client/         브라우저 전용: ApiClient, 이미지 축소, PNG 렌더러, 공유/다운로드, 토스 위젯
src/domain/         순수 도메인 로직·enum·타입·API DTO
src/server/         설정, DB, 인증, 저장소, 인식·결제 어댑터, 서비스
drizzle/            SQL 마이그레이션
tests/unit, tests/integration, e2e/
```
