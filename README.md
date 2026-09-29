# 오프날

근무표 사진 한 장으로 **내 근무만** 뽑아 월간 달력으로 정리하고, 개인 캘린더(ICS)·읽기 전용 링크·PNG 이미지로 가족과 나누는 모바일 웹 MVP.

- 제품 기준: [`docs/Handoff.md`](docs/Handoff.md) — 확정 기획·요금 정책·디자인 원본
- 구현 설계: [`docs/Spec.md`](docs/Spec.md) — 디렉터리·DB·API·권한 경계·테스트 계약
- 작업 규칙: [`CLAUDE.md`](CLAUDE.md)

## 기술 구성

| 영역 | 선택 | 비고 |
|---|---|---|
| 앱 | Next.js 16 App Router + TypeScript | 화면과 API 한 저장소 |
| DB | PostgreSQL + Drizzle ORM | 개발·테스트는 PGlite(임베디드 Postgres), preview·운영은 `DATABASE_URL` 필수 |
| 원본 저장 | 로컬 파일(개발) / S3 호환 비공개 버킷(운영, 예: Supabase Storage) | 공개 URL 없음 |
| 로그인 | 자체 세션(HttpOnly 쿠키) + Google OAuth(arctic, PKCE) / 데모 로그인 | 아래 “로그인 수단” 참고 |
| 인식 | Anthropic Claude (`claude-opus-5-5`, 이미지 입력 + JSON 스키마 구조화 출력) / mock | 모델·effort는 환경 변수로 교체 |
| 결제 | 토스페이먼츠 결제위젯 + 서버 승인·재조회 / mock 테스트 결제 | 단건 결제, 자동 결제 없음 |
| 캘린더 | `ics` 라이브러리로 일회성 가져오기 파일 | 자동 동기화 아님 |
| 이미지 | 브라우저 Canvas로 PNG 생성 | 권한 확인 API 데이터만 사용 |

### 로그인 수단 (미확정 → 기본값 Google)

고객이 로그인 수단을 확정하지 않아 **Google OAuth 1종**을 기본 구현했습니다. Supabase Auth 대신 자체 세션을 둔 이유는 ① 비회원 인식 작업(익명 세션 쿠키)을 로그인 계정으로 넘기는 claim을 서버 트랜잭션 하나로 통제하고 ② 제공자를 바꿀 때 `src/server/auth/AuthProvider.ts` 구현만 추가하면 되기 때문입니다. 카카오·네이버·이메일 매직링크는 같은 인터페이스로 추가할 수 있습니다. DB·스토리지는 Supabase(Postgres + S3 호환 Storage)를 그대로 쓸 수 있습니다.

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
pnpm db:migrate             # .env.local의 DATABASE_URL(없으면 PGlite)에 마이그레이션 적용
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
| `DATABASE_URL` | Postgres 접속 문자열 (Supabase: Transaction pooler URL 권장) |

배포 전·스키마 변경 시 `DATABASE_URL`을 넣은 `.env.local`로 `pnpm db:migrate`를 실행합니다. 서버리스에서 동시 마이그레이션을 피하려고 운영 DB는 앱 기동 시 자동 마이그레이션하지 않습니다.

### 원본 저장소 (S3 호환)

`STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. 버킷은 **비공개**로 만듭니다. Supabase Storage는 Project Settings → Storage → S3 Connection에서 엔드포인트·키를 발급합니다. 원본은 저장 확정 직후 삭제되고, 방치된 원본은 `SOURCE_TTL_HOURS`(24시간) 뒤 정리 작업이 지웁니다. 처리업체(스토리지·AI) 쪽 보관 설정은 출시 전 별도 확인이 필요합니다.

### Google 로그인

1. Google Cloud Console → API 및 서비스 → OAuth 동의 화면 구성(범위: `openid`, `profile`, `email`)
2. 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션)
3. **승인된 리디렉션 URI**: `https://<도메인>/auth/callback` (로컬: `https://localhost:3000/auth/callback`)
4. `AUTH_PROVIDERS=google`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

로그인 취소·실패 시 인식 작업은 유지되고 같은 화면으로 돌아와 재시도할 수 있습니다.

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

- 인식(mock fixture), 결제(mock 테스트 결제), 로그인(데모 로그인) — 실제 Google·Anthropic·토스 호출은 키가 없어 실행해 보지 않았습니다(요청 형식은 단위 테스트와 공식 문서로 확인).

### 사용자 설정 대기

- Google OAuth 클라이언트, Anthropic API 키, 토스 상점 키·웹훅, 운영 Postgres·S3 버킷, 도메인, `APP_SECRET`/`CRON_SECRET`

### 출시 전 결정·확인 필요

- 로그인 수단 확정, 결제 사업자·세금·영수증·환불 문구(환불 시 이용권 회수 정책 포함 — 현재는 취소 이벤트를 기록만 하고 이용권 유지)
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
