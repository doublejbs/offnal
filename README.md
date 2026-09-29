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
| 인식 | Anthropic Claude (`claude-opus-5-5`, 이미지 입력 + JSON 스키마 구조화 출력) / mock | 모델·effort는 환경 변수로 교체 |
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

> 데모 로그인은 같은 표시 이름을 입력하면 같은 계정으로 들어갑니다. 공개된 preview에서 데모 모드를 켜면 사람끼리 계정이 겹칠 수 있으니 내부 확인용으로만 쓰세요. `OFFNAL_ENV=production`에서는 데모 모드·mock 제공자·PGlite·로컬 저장소가 **기동 단계에서 차단**됩니다.

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
- `*.supabase.com`/`*.supabase.co` 호스트는 자동으로 TLS로 연결합니다. Supabase DB 인증서는 Supabase 자체 루트 CA로 서명되므로, 인증서까지 검증하려면 Project Settings → Database → SSL Configuration에서 인증서를 받아 `DATABASE_SSL_ROOT_CERT`에 PEM을 넣습니다(없으면 암호화만).
- `pnpm db:migrate` → `pnpm db:check`로 마이그레이션 수와 “RLS 미적용: 없음”, “anon/authenticated 테이블 권한: 없음”을 확인합니다. 마이그레이션 `0003_supabase_rls`가 모든 앱 테이블에 RLS를 켜고 `anon`·`authenticated` 권한을 회수합니다(서버는 테이블 소유자인 `postgres` 역할로 접속해 RLS 영향을 받지 않습니다).

**4. 원본 저장소 → `STORAGE_DRIVER=s3`, `S3_*`**

- Storage → New bucket: 이름(예: `offnal-sources`), **Public bucket 끔**, 정책(Policies)은 추가하지 않습니다 → `S3_BUCKET`
- Storage → S3 Configuration(대시보드 표기: Project Settings → Storage → S3 Connection): Endpoint → `S3_ENDPOINT`(`https://<project-ref>.storage.supabase.co/storage/v1/s3`), Region → `S3_REGION`, **New access key** → `S3_ACCESS_KEY_ID`·`S3_SECRET_ACCESS_KEY`(비밀 키는 발급 때 한 번만 보임). S3 키는 RLS를 우회하는 서버 전용 키입니다. path-style 주소는 코드에서 항상 켭니다.
- `pnpm storage:check`로 검사 객체 올리기·읽기·삭제를 확인합니다.
- 원본은 저장 확정 직후 삭제되고, 방치된 원본은 `SOURCE_TTL_HOURS`(24시간) 뒤 정리 작업이 지웁니다. 처리업체(스토리지·AI) 쪽 보관 설정은 출시 전 별도 확인이 필요합니다.

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

### 결제 (토스페이먼츠)

`PAYMENT_PROVIDER=toss`, `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`(`test_` 키면 테스트 결제).

- 토스 개발자센터 → 웹훅: `https://<도메인>/api/payments/webhook`, 이벤트 `PAYMENT_STATUS_CHANGED`(가상계좌를 쓰면 `DEPOSIT_CALLBACK`도)
- 결제 성공 리다이렉트만으로 권한을 주지 않습니다. 서버가 승인 API 결과의 주문·금액·통화를 주문 행과 대조한 뒤에만 해당 월 이용권을 발급하고, 웹훅은 본문을 믿지 않고 토스 API로 재조회합니다.
- 가격은 `PRICE_KRW` 한 곳에서 관리합니다(기본 1,900원).

### 정리 작업 (cron)

`CRON_SECRET`(32자 이상). `vercel.json`이 매시 `/api/cron/cleanup`을 호출하며 Vercel Cron은 `Authorization: Bearer $CRON_SECRET`을 자동으로 붙입니다. **Vercel Hobby 플랜은 하루 1회 cron만 허용**하므로 Pro 플랜이 아니면 `schedule`을 `0 3 * * *` 등으로 바꾸세요. 다른 호스팅에서는 같은 헤더로 주기 호출하면 됩니다.

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

키가 준비되면 `VISION_PROVIDER=anthropic`+`ANTHROPIC_API_KEY`, `PAYMENT_PROVIDER=toss`+토스 키로 바꾸고 `OFFNAL_ENV=production`으로 올립니다. 빌드(`next build`)는 환경 변수·DB에 접근하지 않으므로(모든 화면이 요청 시 렌더링) 값이 비어 있어도 빌드는 통과하고, 잘못된 설정은 첫 요청에서 드러납니다. Supabase 값이 없으면 `src/proxy.ts`는 아무것도 하지 않습니다.

1. 위 환경 변수를 Production/Preview에 각각 등록(preview는 `OFFNAL_ENV=preview`, 테스트 키 사용 권장)
2. `pnpm db:migrate`로 대상 DB에 마이그레이션 적용
3. 배포 후 `/api/config/public`에서 `appMode: "live"` 확인
4. 업로드 한도 4MB는 Vercel 함수 요청 본문 한도(약 4.5MB) 때문이며, 화면이 업로드 전에 사진을 줄입니다.
5. IP 기준 한도는 신뢰할 수 있는 프록시(Vercel)가 `x-forwarded-for`를 설정한다고 가정합니다. 다른 환경에서는 `src/server/http/ClientIp.ts`를 맞춰야 합니다.

## 구현 상태

### 실제 구현 (키만 넣으면 동작하는 코드)

- 비회원 업로드 → 표 인식 → 흐린 미리보기(중립 플레이스홀더, 인증 전 응답·HTML에 이름·근무 없음) → 로그인 → 같은 작업 claim → 이름·월 선택 → 개인 추출 → 수정 → 저장
- 로그인한 사용자는 블러 없이 이름 선택으로 바로 이동, 로그인 취소·실패 시 작업 유지, 만료 시 재업로드 안내, 인식 실패는 원인·재시도 제공
- 확인 필요 칸(null)은 저장 차단, 사용자 정의 코드·휴무 여부·시간(다음 날 종료) 편집, 원본 비교·확대, 이름 미발견 시 직접 입력
- 월별 이용권: 계정당 서로 다른 두 달 무료(첫 확정 저장 시 차감), 같은 달 재저장 무료, 세 번째 달부터 단건 결제, 삭제해도 소진 이력 유지 — 모두 서버 트랜잭션에서 판정
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
