# 오프날 — Claude 구현 지시서

작성일: 2026-09-29

이 파일은 새 대화에서 이 프로젝트를 처음 접하는 Claude에게 전달하는 독립적인 개발 명세다. 이전 대화나 외부 파일이 없어도 작업할 수 있도록 확정 기획과 최신 디자인 원본을 포함한다.

## 1. Claude에게 내리는 작업 지시

너는 오프날의 풀스택 개발 담당자다. 아래 기획과 디자인을 바탕으로 실제 동작하는 모바일 웹 MVP를 구현하라. 계획만 제시하고 멈추지 말고, 저장소 조사 → 구현 → 핵심 검증 → 실행 방법 정리까지 진행하라.

먼저 현재 저장소의 AGENTS.md, README, 패키지·폴더 구조, 기존 인증·DB·배포 환경을 확인한다. 기존 프로젝트가 있으면 기존 구조를 존중한다. 새 프로젝트라면 아래 기본 기술안을 적용하되, 이 기술안은 고객이 확정한 요구사항과 구분한다.

- 서비스명은 **오프날**이다. 이름을 새로 제안하지 않는다.
- 제품의 핵심은 **근무표 사진 → 내 근무 달력 → 개인 캘린더 추가·링크 공유·이미지 저장**이다.
- 모바일 웹을 구현한다. 소개용 랜딩 페이지만 만들지 않는다.
- 우선순위는 업로드, 로그인 전 블러, 개인 일정 수정, 저장, 공유, 내보내기다.
- 실제 외부 연동에 필요한 키가 없으면 해당 어댑터와 설정 문서를 완성하고, 개발 전용 데모 모드로 검증한다. 나머지 개발을 중단하지 않는다.
- 데모와 실제 동작을 구분한다. 실서비스 모드에서 로그인·인식·결제가 성공한 척하지 않는다.
- API 키·시크릿·서비스 계정 키는 서버에만 둔다. 실제 값이 없는 .env.example을 제공한다.
- 작업 완료 시 구현된 기능, 미연결 기능, 필요한 사용자 설정, 검증 결과, 실행 명령을 정확히 보고한다.

### 제품 범위

대상은 자신의 근무를 개인 캘린더에 옮기고 가족·연인에게 전달하는 교대근무자다. 원본 표에는 동료 정보가 있을 수 있지만 서비스의 영구 저장·공유 대상은 선택한 개인의 근무뿐이다.

추가하지 않을 기능: 병동 근무표 생성·자동 배정, 교환 승인, 채팅, 친구 관계, 커플 일정 교집합, 푸시 알림, 네이티브 앱, 자동 갱신 캘린더 구독. OAuth로 외부 캘린더에 직접 쓰는 기능도 1차 범위에 넣지 않는다.

## 2. 가장 중요한 확정 사용자 경험

비회원 신규 사용자:

사진 선택 → 업로드 → 표 인식 → **흐린 달력 미리보기 + 로그인** → 로그인 → 내 이름·연월 선택 → 개인 일정 추출 → 인식 결과 확인·수정 → 무료 권한 확인 또는 결제 → 확정 저장 → 공유·내보내기.

로그인한 사용자:

사진 선택 → 표 인식 → 이름·연월 선택 → 개인 일정 추출 → 확인·수정 → 해당 월 권한 확인 → 저장.

**로그인은 사진을 올리기 전이 아니라 인식이 끝난 직후에 요구한다.** 이미 로그인한 사람에게는 다시 블러를 보여주지 않는다.

첫 번째 표 인식에서는 표 구조·이름 후보·연월·근무 코드·시간을 읽는다. 로그인 전에는 아직 개인이 선택되지 않았으므로 “내 달력 완성”이라고 과장하지 않는다. 문구는 “근무표를 읽었어요. 내 달력을 확인해 보세요.”를 사용한다. 특정 사람의 전체 일정을 뽑는 두 번째 처리는 로그인 및 이름 선택 후 수행해도 된다.

블러 화면에서는 일정 배치와 달력 형태만 살짝 보이게 한다. 실제 이름·상세 근무 데이터는 인증 전 API 응답과 HTML에 넣지 않는다. 시안처럼 중립적인 플레이스홀더를 흐리게 표현한다. CSS blur는 접근 제어가 아니다.

로그인 취소·실패 시 인식 작업을 유지한다. 다시 로그인해도 사진 재업로드를 요구하지 않는다. 임시 작업 만료 시에는 만료를 설명하고 재업로드를 안내한다. 인식 실패는 블러 화면으로 숨기지 말고 재시도를 제공한다.

## 3. 요금 정책 구현 계약

| 항목 | 규칙 |
|---|---|
| 무료 | 계정별 서로 다른 YYYY-MM 두 개 |
| 유료 | 세 번째 고유 월부터 대상 월 한 달분 1,900원 |
| 결제 | 단건 구매, 자동 결제 없음 |
| 차감 | 해당 월의 첫 확정 저장 성공 시 무료 월 소진 |
| 미소진 | 사진 업로드, 로그인, 인식, 오류, 초안 취소 |
| 같은 월 | 수정·재등록 무료, 월 이용권 재구매 없음 |
| 기존 월 | 이후 새 월을 구매하지 않아도 열람·수정·내보내기 유지 |
| 결제 전 | 새 월 결과 미리보기·수동 수정 가능 |
| 결제 후 | 해당 월 영구 저장·공유·ICS·PNG 내보내기 가능 |
| 삭제 | 달력을 지워도 이용권·무료 소진 이력은 유지 |

가격 1,900원은 이번 구현의 기본값이며 설정 한 곳에서 관리한다. 결제 사업자, 세금 처리와 환불 문구는 출시 전에 확정할 항목이다. 법률 문구나 환불 가능 범위를 임의로 단정하지 않는다.

월 단위 권한은 서버에서 검증한다. 클라이언트 플래그·localStorage로 무료 횟수나 구매 권한을 판정하지 않는다. 한 사용자의 서로 다른 세 월 동시 발행에도 무료 권한은 두 개만 부여되어야 한다. 같은 월 요청 재시도는 중복 결제·차감을 만들지 않는다.

## 4. 새 저장소의 기본 기술안 — 확정 제품 요구와 별개

기존 기반이 없을 때의 제안:

- Next.js App Router + TypeScript로 UI와 서버 엔드포인트 구성.
- PostgreSQL 기반 저장소와 객체 스토리지, 인증은 Supabase를 기본 후보로 사용.
- 로그인은 Google OAuth 1종을 기본 구현 후보로 두고 이메일 방식 또는 다른 제공자 변경이 가능하도록 경계를 둔다. 로그인 수단은 아직 사용자가 확정하지 않았으므로 README에 선택 근거와 설정 절차를 남긴다.
- 이미지 인식은 서버 전용 VisionProvider 어댑터. 모델·제공자는 환경 설정으로 교체한다. 기본 제공자를 선택할 때 현재 공식 문서로 이미지 입력과 구조화 출력 지원을 확인한다. 오래된 샘플 모델명과 가격을 고정하지 않는다.
- 결제는 PaymentProvider 어댑터와 샌드박스 경로를 먼저 구성한다. 사업자 선정·상점 키 없이 실결제 완료를 주장하지 않는다.
- 시안의 단일 HTML을 그대로 제품 코드로 쓰지 말고 도메인 로직, 서버, 화면 컴포넌트로 분리한다.
- 설치 시점의 공식 문서와 호환 버전을 확인하고 lockfile을 커밋한다. 새 프레임워크 도입이 목적이 아니다.

장시간 이미지 인식은 영속 작업으로 처리하고 짧은 상태 조회를 제공한다. 호스팅 환경의 요청 시간 제한을 확인한다. 서버리스에서 응답 이후 떠 있는 비보장 백그라운드 Promise에 작업을 맡기지 않는다. 초기에는 검증된 작업 실행 방식 하나를 선택하고 불필요한 큐·마이크로서비스를 추가하지 않는다.

## 5. 화면·컴포넌트 구조 제안

| 라우트 예시 | 역할 |
|---|---|
| / | 사진 업로드, 두 달 무료·이후 가격 안내 |
| /recognitions/:id | 처리 상태, 비회원 블러 미리보기 |
| /auth/callback | 인증 후 임시 작업 연결 및 원래 흐름 복귀 |
| /recognitions/:id/select | 로그인 후 이름·연월 선택 |
| /drafts/:id | 원본 비교, 개인 일정 수정, 근무 시간 확인 |
| /calendar/:yearMonth | 소유자의 월간 달력 |
| /checkout/:yearMonth | 대상 월 단건 구매 |
| /s/:token | 로그인 없는 읽기 전용 공유 달력 |

주요 컴포넌트: UploadPanel, RecognitionProgress, BlurredPreviewGate, PersonMonthSelector, SourcePreview, MonthGrid, ShiftEditor, ShiftTimeEditor, ExportSheet, ShareSettings, MonthCheckout, EmptyState, RecoverableError.

모바일은 한 열로 구성한다. 원본 비교와 편집은 화면 이동 없이 이어지게 한다. 큰 화면에서도 날짜 선택·수정 경로가 동일해야 한다. 시안의 화면 선택 드롭다운, 예시 데이터 배너, 시뮬레이션 안내 버튼은 개발용 데모에서만 사용한다.

## 6. 서버 데이터와 API 계약 제안

구현상 이름은 조정 가능하나 아래 권한 경계는 유지한다.

### 저장 데이터

- User: 사용자 ID, 표시 이름, timezone.
- Calendar: 사용자별 하나, 소유자, 공유 활성 여부, token hash, 공유 표시 이름.
- RecognitionJob: 익명 세션 소유권 또는 사용자 소유권, 단계, 오류 코드, 업로드 경로, 만료 시각. 인식된 타인 이름 후보는 임시 데이터다.
- Draft: 선택한 개인, 대상 월, 날짜별 근무, 검토 상태, 원본 작업 ID, 만료 시각, 수정 버전. 공개 데이터와 분리한다.
- PublishedMonth: calendarId + yearMonth 고유, 현재 공개 revision, 공개 허용 여부, 최종 수정 시각.
- ShiftDefinition: 코드·표시명·시작/종료 시각·다음 날 종료 여부·휴무 여부. 과거 달력이 나중에 정의를 수정해도 의도치 않게 변하지 않게 버전 또는 월별 스냅샷 사용.
- ShiftEntry: 실제 날짜, 근무 코드, 검토 상태. 날짜 누락과 휴무를 별개로 표현.
- Entitlement: userId + yearMonth 고유, trial/purchase, 결제 참조.
- Payment: 서버 생성 주문 ID, 사용자·대상 월·금액·통화, 제공자 ID, 상태, 멱등 키.

### 엔드포인트 예시

| API | 권한과 동작 |
|---|---|
| POST /api/recognitions | 익명 세션 또는 사용자에 업로드 작업 귀속, 제한·파일 검증 |
| GET /api/recognitions/:id/status | 소유한 세션/계정에 상태만 반환, 로그인 전 개인정보 없음 |
| POST /api/recognitions/:id/claim | 인증 후 임시 세션 소유권 증명, 중복 연결 방지 |
| GET /api/recognitions/:id/candidates | 로그인한 소유자만 이름 후보·월·코드 확인 |
| POST /api/recognitions/:id/extract | 선택 행·월로 개인 일정 추출, 같은 요청 재시도 중복 방지 |
| PATCH /api/drafts/:id | 소유자만 수정, 이전 revision 충돌 시 덮어쓰지 않음 |
| POST /api/drafts/:id/publish | 검토 완료·월 권한 확인, 트랜잭션으로 권한 부여/차감과 확정 저장 |
| POST /api/payments | 서버 기준 월·가격으로 주문 생성 |
| POST /api/payments/confirm 또는 webhook | 제공자 검증 후 권한 부여, 중복 이벤트 무해 처리 |
| POST /api/calendar/share | 소유자가 공유 활성·공개 월을 선택 |
| POST /api/calendar/share/rotate | 이전 링크 즉시 무효화 |
| DELETE /api/calendar/share | 공유 중지 |
| GET /api/shared/:token | 공개 허용된 월의 개인 일정만 반환 |
| GET /api/calendar/:yearMonth/export.ics | 로그인한 소유자의 해당 월 권한 확인 |

PNG는 권한을 확인한 확정 일정으로 생성한다. 서버 생성 또는 클라이언트 생성 중 하나를 선택하되 결과가 실제 PNG 다운로드로 동작해야 한다. 이미 브라우저에 제공한 미리보기의 스크린샷까지 차단할 수 있다고 주장하지 않는다.

비회원 작업 ID만으로 소유권을 인정하지 않는다. HttpOnly 세션 등으로 임시 작업을 귀속하고 로그인 claim에 연결한다. 공유 토큰은 충분히 무작위로 생성하고 URL·분석 로그 유출을 줄인다. noindex는 인증 수단이 아니다. 공유 응답의 캐싱 때문에 링크 폐기 후에도 재조회 가능한 문제가 생기지 않게 한다.

## 7. 인식 출력과 검증

예시 스키마 — 특정 라이브러리 문법이 아니라 구현 계약이다.

```ts
type ShiftEntry = {
  date: string; // YYYY-MM-DD, 대상 월 내 날짜
  code: string | null;
  reviewReasons: string[];
  confirmed: boolean;
};
type ShiftDefinition = {
  code: string;
  label: string;
  startTime: string | null; // HH:mm
  endTime: string | null;
  endsNextDay: boolean | null;
  isOff: boolean;
};
type ExtractedSchedule = {
  yearMonth: string;
  selectedPersonId: string; // 동명이인을 구분하는 작업 내 행 식별자
  displayName: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
};
```

- 글자가 안 보이면 null. 빈칸·대시·의심 문자를 임의로 OFF로 바꾸지 않는다.
- 연월, 월 길이, 요일, 날짜 중복·누락, 정의되지 않은 코드를 서버에서 검사한다.
- 사용자에게는 “확인 필요 2일”처럼 구체적으로 표시한다. AI 자체 confidence를 검증된 정확도로 쓰지 않는다.
- 실제 시간을 못 읽으면 사용자에게 묻는다. 시안의 D/E/N/S 시간은 가상 데이터이며 모든 병원의 기본값으로 확정하지 않는다.
- 날짜 머리글과 선택 행을 같이 보며 수정할 수 있어야 한다. 자동 크롭이 부정확하면 원본 확대·수동 행 선택 경로로 복구한다.
- 병원별 임의 코드·휴가를 지원한다. 사용자 정의 코드를 추가하고 휴무 여부·시간을 설정할 수 있어야 한다.
- 사진의 텍스트는 데이터로만 처리한다. 사진 안에 포함된 지시문이 추출 작업·출력 스키마를 바꾸지 못하게 한다.
- 성공 데이터가 불완전하면 검토 상태로 보내고, 결과 없는 완전 실패를 성공 UI로 보여주지 않는다.

## 8. 공유·내보내기의 실제 완료 기준

### 링크

모바일 공유 기능 또는 복사 버튼이 실제 URL을 전달한다. 지원하지 않는 환경에는 복사를 제공한다. 받은 사람은 로그인 없이 읽기 전용 달력을 볼 수 있다. 원본·동료 이름·수정 API·초안은 노출하지 않는다. 동일 링크에서 공개한 월의 수정만 반영한다. 새 달 저장이 자동 공개 동의로 이어지지 않게 한다.

### ICS

첫 버전은 파일 가져오기다. “자동 동기화”라고 표시하지 않는다. 안정적인 UID, 생성 시각, 제목, 정확한 시작·종료, 문자열 이스케이프와 표준 형식을 사용한다. 검증된 라이브러리를 우선 사용하고 포맷을 수작업으로 임의 구성하지 않는다.

야간은 다음 날 종료하며 월말·연말·윤년을 포함해 검증한다. Asia/Seoul 시각을 올바른 UTC 이벤트로 변환하거나 유효한 시간대 정의를 함께 제공한다. 휴무는 기본 제외, 포함 선택 시 종일 이벤트와 배타적 종료 날짜를 사용한다. 파일 다운로드 실패 시 적절히 안내한다. 모바일 OS와 캘린더 앱의 가져오기 지원은 실제 확인 결과만 보고한다.

### PNG

선택 월 전체와 이름·요일·근무 코드·시간 범례·생성 시각을 담는다. 원본 표와 편집 버튼·결제 UI는 제외한다. 한국어 폰트 로딩을 기다린 뒤 생성하고, 모바일에서 읽을 수 있는 해상도와 다크 모드와 무관한 공유 이미지 가독성을 확보한다. 모바일 저장·공유 취소는 오류 성공으로 오인하지 않는다.

## 9. 예외·보안·비용 처리

- 업로드 MIME·파일 시그니처·크기·픽셀 수 검증, 비공개 원본 저장.
- 익명 세션/IP와 계정 기준 인식 요청 제한. 정확한 제한값은 설정 가능하게 하고 초기값은 README에 제안값이라고 명시한다.
- AI 호출 타임아웃·제한된 재시도·멱등 처리, 실패 시 사용자 초안과 기존 공개 월 보호.
- 원본 및 크롭 이미지 삭제 작업, 누락 시 재시도. 최대 보관 24시간은 초기 제안값이며 구성 가능하게 둔다.
- 만료로 로그인 재시도가 불가능해졌을 때 원인을 숨기지 않는다.
- 임시 작업과 결제 대기 초안의 TTL을 구분한다. 원본 만료 후에도 사용자가 로그인해 확인한 개인 초안은 제품 정책에 맞춰 복구 가능해야 한다.
- 결제 성공은 서버 검증으로만 판정한다. amount, currency, user, order, target month를 검증한다.
- 실패한 결제 뒤 초안은 유지, 기존 공개 달력은 유지. 결제 성공 후 발행 실패가 나도 재결제 없이 재발행할 수 있어야 한다.
- 개발 모드는 production에서 활성화할 수 없게 한다. mock 결제와 mock 인식은 시각적으로 구별하고 테스트 전용이다.
- 분석 이벤트에 원본·실명·근무 상세·공유 토큰을 넣지 않는다.

## 10. 구현 순서

1. 저장소 파악 및 핵심 구조 결정. 기존 설정을 유지하고 구현 계획을 짧게 알린다.
2. 도메인 타입·검증·마이그레이션·권한 경계·개발용 fixture를 만든다.
3. 시안 기반 반응형 UI를 구현한다. 신규 사용자는 업로드부터 시작한다. 디자인 파일이 블러 화면으로 시작하는 것은 그 화면을 검토하기 위한 설정일 뿐이다.
4. 실제 계정·저장·익명 인식 작업 claim을 연결한다. 키가 없으면 어댑터와 개발 모드까지 완성한다.
5. 업로드와 두 단계 AI 인식, 이름 선택, 날짜·시간 수정, 확정 저장을 연결한다.
6. 읽기 전용 공유와 ICS/PNG 내보내기를 구현한다.
7. 무료 두 월 권한과 단건 결제를 연결한다. 결제 사업자 계정 미제공 상태라면 샌드박스와 설정 절차를 완료하고 미연결 상태를 보고한다.
8. 핵심 테스트와 모바일 UI 검증 후 실행·배포·설정 문서를 작성한다.

설계 결정을 사용자에게 매번 묻지 말고 합리적인 기본값을 사용하되, 소셜 로그인 앱 등록·실결제 사업자 계약·운영 키·도메인 등 외부 계정이 필요한 항목은 사용자에게 필요한 설정을 한 번에 정리한다. 외부 작업이 막혀도 관련 없는 개발은 계속한다.

## 11. 필수 검증 목록

- 비회원 업로드 → 인식 완료 블러 → 로그인 복귀 → 동일 작업 이름 선택 → 수정 → 무료 저장.
- 로그인 전 네트워크 응답·HTML·접근성 트리에 실제 이름과 근무 상세 없음.
- 타 세션/계정의 작업 ID와 draft ID로 접근 불가.
- 인식 실패 때 성공 블러가 나타나지 않음, 재시도 가능.
- null 날짜가 남은 상태에서 확정 저장 불가. 근무 시간 미확정 시 수정 경로 제공.
- 같은 월 재등록 시 무료 횟수 추가 차감 없음. 세 번째 고유 월은 결제 필요.
- 여러 월 동시 확정으로 무료 월이 두 개를 초과하지 않음.
- 결제 실패·중복 callback·중복 webhook에 잘못된 권한 발급 없음.
- 초안 수정이 공개 달력을 바꾸지 않고 확정 시에만 반영됨.
- 공유 중지·재발급 시 이전 링크 조회 불가, 공개 안 한 월도 조회 불가.
- 실제 PNG 파일과 ICS 파일 생성. 야간 10월 31일 시작 → 11월 1일 종료, 12월 31일 → 다음 연도, 윤년 검증.
- 최소 320px·390px·768px 너비, 긴 한국어 이름·사용자 코드, 키보드 조작·확대 상태 확인.
- 프로덕션 빌드 성공. 테스트하지 못한 실제 기기·외부 결제·인식 정확도는 미검증으로 보고.

숫자 자체를 KPI 목표로 임의 확정하지 않는다. 관찰할 지표는 월 전체 일치율, 수정 칸 수, 처리 지연·비용, 두 번째 달 등록, 공유 재방문, 세 번째 달 구매다.

## 12. Claude가 최종 전달할 결과

- 실행 가능한 소스와 lockfile.
- DB 마이그레이션·접근 정책 및 개발용 fixture.
- .env.example과 제공자별 필요한 키·OAuth redirect URI·webhook 설정 문서.
- 로컬 실행, 테스트, 빌드, 배포 방법을 담은 README.
- 실제 구현 / 개발 모드 / 설정 대기 기능을 구분한 완료 보고.
- UI 캡처 또는 동작 확인 방법, 필수 테스트 결과, 남은 차단 요인.

아래 부록 A는 현재 제품 기획 원문이다. 본 지시서의 기술 선택은 제안이며, 부록 A와 위에서 명시한 고객 확정 흐름이 제품 동작의 기준이다. 부록 B는 최신 디자인 참고 HTML이다.

## 부록 A. 현재 제품 기획

# 오프날 — 제품 기획 및 디자인 v0.2

작성일: 2026-09-29 · 서비스명: 오프날

## 1. 제품 정의

근무표 사진에서 본인의 일정만 추출해 개인 캘린더에 넣고, 가족·연인에게 링크 또는 이미지로 공유하는 모바일 웹.

첫 고객은 근무를 개인 캘린더에 직접 입력하면서 주변 사람에게도 별도로 전달하는 교대근무자다. 주된 고객 가치는 월별 수동 입력과 중복 전달을 줄이는 것이다. 사진 인식은 진입 기능이며, 다음 달 재등록과 공유 링크 재방문을 통해 반복 가치를 검증한다.

성공 가설: 무료 두 달 동안 개인 캘린더 추가와 공유를 경험한 고객 일부가 세 번째 달 등록을 실제로 구매한다. 지불 의사나 시장 규모는 아직 검증되지 않았다.

## 2. 합의한 범위와 이번 설계의 제안

| 구분 | 내용 |
|---|---|
| 합의 | 모바일 웹, 사진 인식, 개인 달력, 캘린더 추가, 링크 공유, 이미지 저장 |
| 합의 | 서로 다른 두 달 무료, 이후 한 달분 1,900원 단건 구매, 자동 결제 없음 |
| 합의 | 같은 달 수정 시 재결제 없음, 기존 달력과 링크는 미구매 후에도 유지 |
| 합의 | 사진 업로드·인식 후 흐린 달력 미리보기, 로그인 후 이름 선택·결과 확인. 계정당 개인 달력 하나 |
| 설계 제안 | 인식·확인 후 결제, 무료 이용권은 월별 첫 확정 저장 시 차감 |
| 설계 제안 | 1차 출시 캘린더 추가는 ICS 일회성 가져오기, 자동 갱신 구독은 후속 |
| 미확정 | 실제 재인식 제한 수, 로그인 수단, 결제 사업자, 출시 가격·환불 정책 |

## 3. 첫 출시 기능

1. JPG/PNG 사진 또는 스크린샷 1장을 등록한다. 모바일 HEIC는 변환 지원 여부를 구현 시 검증하고, 미지원 시 JPG/PNG 변환 방법을 안내한다.
2. 비회원 상태에서 연·월, 이름 목록, 근무 코드·시간과 표 구조를 인식한다. 성공하면 흐린 달력 형태와 로그인 버튼을 보여준다. 인식된 개인정보·상세 근무 데이터는 인증 전 브라우저에 내려주지 않는다. 로그인 후 이름을 선택한다. 이름을 못 찾으면 직접 입력하거나 원본에서 행을 선택한다.
3. 선택한 사람의 날짜별 근무를 추출해 초안으로 표시한다.
4. 월·이름·시간과 날짜별 근무를 수정하고 확인한다. 확인되지 않은 칸은 저장을 막고 위치를 알려준다.
5. 로그인 후 무료 이용권 또는 구매 권한으로 해당 월을 확정 저장한다.
6. ICS 일정 파일, 읽기 전용 링크, 월간 PNG 이미지를 제공한다.
7. 같은 달 수정은 새 초안으로 작성하고 확정할 때 기존 공개 데이터를 한 번에 교체한다.

제외: 병동 전체 근무표 생성, 근무 교환, 근무 배정, 친구·채팅, 두 사람의 공통 휴무, 알림, 네이티브 앱, 자동 갱신 캘린더 구독.

## 4. 화면과 사용자 흐름

| 화면 | 주요 내용 | 주요 행동 |
|---|---|---|
| 사진 등록 | 두 달 무료와 이후 가격, 사진 선택, 원본 처리 안내 | 사진 선택 |
| 인식 중 | 현재 처리 단계, 취소·재시도 | 완료 시 블러 미리보기·로그인으로 이동 |
| 인식 완료·로그인 | 흐린 달력 형태, 인식 완료 문구, 두 달 무료 및 이후 가격 | 로그인하고 무료로 확인 |
| 이름·월 선택 | 이름 후보, 연·월 입력, 미발견 대안 | 내 일정 가져오기 |
| 결과 확인 | 본인 행 원본과 날짜 머리글, 월간 달력, 확인 필요 칸, 근무 시간 | 날짜 수정, 확인 후 저장 |
| 계정 연결 | 인식 작업 보존 설명, 로그인 실패·취소 시 재시도 | 비회원 인식 작업을 계정으로 이전 후 이름 선택 |
| 결제 | 대상 연·월, 1,900원, 포함 기능, 단건 구매 안내 | 결제 후 저장 |
| 내 달력 | 월 전환, 근무·휴무 수, 날짜별 상세, 수정 | 캘린더 추가, 공유 |
| 공유 패널 | 읽기 전용 링크, 이미지 미리보기, 캘린더 추가 방식 | 공유·저장 |
| 받은 달력 | 표시 이름, 해당 월, 일정 상세, 최종 수정 시각 | 월 전환, 날짜 확인 |

무료: 사진 등록 → 인식 → 블러 미리보기 → 로그인 → 이름 선택 → 결과 확인 → 확정 저장 → 내 달력 → 공유.

유료: 사진 등록 → 인식 → 블러 미리보기 → 로그인 → 이름 선택 → 결과 확인 → 해당 월 권한 확인 → 결제 → 확정 저장 → 내 달력.

원본 사진은 결과 확인 화면에서만 사용한다. 공유 페이지·공유 이미지에는 선택하지 않은 사람의 이름, 근무, 병원 정보, 원본을 포함하지 않는다.

### 로그인 전 미리보기 원칙

- 로그인 전에는 개인을 선택하지 않았으므로 특정인의 완성 달력이라고 표시하지 않는다. 문구는 “근무표를 읽었어요. 내 달력을 확인해 보세요.”로 한다.
- 달력 모양은 중립 플레이스홀더에 블러를 적용한다. 실제 이름·근무표를 CSS 블러로만 숨기지 않으며 HTML, 접근성 트리, API 응답에도 상세 데이터를 포함하지 않는다.
- 원본·파싱 결과는 비공개 임시 작업으로 보존한다. 인증 성공 시 임시 세션 소유권과 만료를 검증하고 계정에 연결한다. 로그인 취소·실패 시 재업로드 없이 재시도할 수 있고, 만료됐으면 재업로드를 안내한다.
- 이미 로그인한 사용자는 블러와 로그인 단계를 건너뛰어 이름 선택으로 이동한다.
- 인식 실패·표 미검출은 로그인 유도로 가리지 않고 실패 원인과 재촬영·수동 입력 경로를 먼저 안내한다.
- 비회원 인식 요청에도 세션·IP별 제한과 만료를 적용해 반복 요청 비용을 제한한다.
- 로그인 자체로 무료 월을 소진하지 않는다. 기존대로 월 확정 저장 시 차감한다.

## 5. 이용권 규칙

- 월은 결제일부터 30일이 아니라 Asia/Seoul 기준 YYYY-MM이다.
- 무료 두 달은 계정별 서로 다른 YYYY-MM 두 개를 의미한다. 연속된 두 달일 필요는 없다.
- 사진 업로드·인식 실패·초안 취소는 무료 이용권을 소진하지 않는다.
- 로그인한 사용자가 처음 확정 저장할 때 해당 월을 무료 또는 유료 권한에 연결한다.
- 한 달에 여러 번 수정·재업로드해도 월 이용권은 다시 차감하지 않는다. 달력을 삭제해도 이미 소비한 무료 월 이력은 복구하지 않는다.
- 결제 전 새 월의 전체 미리보기와 수동 수정은 가능하다. 저장·링크 반영·ICS·이미지 내보내기는 해당 월 권한이 필요하다.
- 기존 권한이 있는 월은 이후 새 월을 구매하지 않아도 열람·수정·내보내기를 유지한다.
- 구매 취소·결제 실패 시 초안을 보존하고, 기존 공개 달력에는 변화가 없다.
- 계정별 일일 제한과 월별 재인식 상한을 둔다. 최초 운영값은 실측 후 확정한다. 자동 재시도와 서비스 오류는 사용자 한도에서 제외한다. 한도를 넘겨도 수동 수정은 가능하다.
- 가격 화면에서 단건 구매, 대상 월, 총 결제액을 명시한다. 세금 처리·영수증·환불 문구는 결제 연동 전에 확정한다.

## 6. 인식과 수정 원칙

- 읽을 수 없는 값은 null. 빈칸·대시를 OFF로 자동 추측하지 않는다.
- 연·월과 요일, 날짜 수, 중복 날짜, 허용 근무 코드를 코드로 검증한다.
- 사람이 맞는지와 날짜 정렬을 사용자가 확인할 수 있도록 날짜 머리글과 본인 행을 함께 보여준다. 자르기 좌표 자체도 오류가 날 수 있으므로 원본 확대 대안을 제공한다.
- 병원별 코드는 다를 수 있다. D/E/N/S/OFF 기본값 외 사용자 정의 코드와 휴가를 허용한다.
- 인식된 시간은 확인받는다. 시간이 없으면 직접 입력하게 하며 임의의 표준 시간을 확정하지 않는다.
- AI의 자체 확률 점수를 정확도처럼 표시하지 않는다. 사용자 화면에는 확인이 필요한 날짜와 이유만 표시한다.
- 야간 종료 시각은 다음 날 여부를 별도 값으로 가진다. 원본에 명시되지 않았으면 사용자에게 확인받는다.
- 원본 미등록·파일 오류·흐린 사진·월 미인식·이름 중복·날짜 누락 각각 재시도 또는 수동 입력 경로를 제공한다.

## 7. 공유와 캘린더 정책

### 읽기 전용 링크

추측하기 어려운 토큰으로 개인 달력을 조회한다. 로그인 없이 접근하며 링크 소유자는 재전달할 수 있다. 검색 노출을 막고 접근 제한을 별도로 구현한다. 표시 이름은 수정 가능하다. 소유자는 공유 중지·링크 재발급이 가능하다. 기존 링크 중지는 과거에 저장한 이미지나 ICS를 회수하지 못한다. 링크 활성 시 공개된 월 범위를 명확히 보여주며, 다음 달 등록 때 같은 링크 공개 여부를 다시 확인한다.

### 캘린더 추가

1차 출시에서는 ICS 일회성 가져오기. 날짜·실제 출퇴근 시간·다음 날 종료를 반영하고 시간대는 Asia/Seoul을 명시한다. 휴무 포함 여부는 기본 해제 옵션으로 제공한다. 반복 가져오기는 앱에 따라 중복될 수 있음을 안내하며 최신 파일을 다시 가져와도 수정이 자동 반영된다고 약속하지 않는다. Apple·Google 등 실제 대상 앱과 모바일 브라우저의 가져오기 동작은 구현 단계에서 각각 검증한다. 동일 이벤트의 식별자는 안정적으로 유지한다.

자동 갱신 구독과 OAuth 직접 쓰기는 후속 기능이며 이번 MVP 일정에 포함하지 않는다.

### 이미지

한 달 전체, 표시 이름, 연·월, 요일, 근무 코드와 시간 범례, 생성 시각을 포함한다. PNG로 저장하며 원본 표는 포함하지 않는다. 휴대폰에서 글자가 읽히는 해상도로 만든다. 링크를 바꿔도 이미 전달한 이미지는 변경되지 않는다. 모바일 공유 기능을 사용할 수 없으면 다운로드 대안을 제공한다.

## 8. 디자인 방향

서비스명은 ‘오프날’로 확정했다. 시안의 이름·근무 데이터는 가상 예시다. 실제 첨부 사진의 타인 정보를 디자인 자산으로 재사용하지 않는다.

- 방향: 개인 일정 도구. 제품의 중심은 월간 달력과 내보내기 행동이다.
- 밝은 바탕과 진한 본문, 파란색 주요 행동. 다크 모드에 대응한다.
- D는 파랑, E는 보라, N은 짙은 남색, S는 황토색, OFF는 중립 회색. 모든 상태를 글자와 함께 표현한다.
- 기본 본문 16px, 보조 13~14px, 큰 제목 28~32px. 모바일 날짜 칸은 최소한의 숫자와 근무 배지를 담는다.
- 클릭 영역은 약 44px 이상을 목표로 한다. 수정은 날짜 선택 후 하단 편집 영역으로 진행한다.
- 원본과 변환 결과 비교가 필요한 화면은 정보 밀도를 높이고, 공유 화면은 읽기에 집중한다.
- 확인 필요 상태는 주황 계열 배지와 텍스트로 표시한다. 단순 색상 차이에 의존하지 않는다.
- 주요 동작은 화면별 하나를 우선한다: 등록 / 확인 / 저장 / 구매. 완료 화면에서는 세 가지 내보내기 행동을 같은 위치에 배치한다.
- 인식 중은 실제 단계와 지연 안내를 제공한다. 허위 정확도, 허위 남은 시간은 표시하지 않는다.

## 9. 최소 데이터 모델

| 엔터티 | 핵심 필드 |
|---|---|
| User | id, displayName, timezone |
| Calendar | id, ownerId, displayName, shareEnabled, shareTokenHash |
| MonthSchedule | calendarId, yearMonth, status, revision, publishedAt |
| ShiftDefinition | id, code, label, startTime, endTime, endsNextDay, isOff |
| ShiftEntry | monthScheduleId, date, definitionId, reviewReason, confirmed |
| RecognitionJob | ownerOrSessionId, status, sourceExpiryAt, errorCode |
| Entitlement | userId, yearMonth, source: trial/purchase, paymentId |
| Payment | id, userId, yearMonth, amount, status, providerReference |

서버는 소유권·월 권한·공개 여부를 검사한다. 결제 성공 리다이렉트만으로 권한을 발급하지 않는다. 결제 검증 및 중복 처리 방지를 거친 뒤 월 권한을 부여한다. 같은 월의 무료 차감·구매·발행은 동시 요청에도 중복되지 않게 한다.

## 10. 개인정보와 원본 수명

원본은 비공개 임시 저장하며 공유 링크로 접근할 수 없다. 확정·취소 후 삭제하고, 방치된 원본과 임시 파생 이미지에는 짧은 자동 만료를 둔다. 제안 만료는 24시간이며 실제 처리업체 보관 설정과 함께 출시 전에 확정한다. 외부 AI 처리 여부를 업로드 전에 고지한다. 원본 이미지를 분석 로그나 사용자 행동 분석 시스템에 넣지 않는다. 다른 근무자의 전체 스케줄을 영구 저장하지 않는다.

## 11. 구현 순서와 완료 기준

1. 핵심 화면: 업로드, 이름 선택, 날짜 수정, 개인·공유 달력. 320px 이상에서 가로 넘침 없이 주요 행동을 완료할 수 있어야 한다.
2. 인식 파이프라인: 동의받은 다양한 표로 평가한다. 글자 정확도보다 한 사람 한 달 전체 일치율, 수동 수정 칸 수, 처리 비용·시간을 측정한다.
3. 저장·계정·공유: 새 초안이 기존 공개 달력을 덮지 않는지, 타인 계정과 원본에 접근할 수 없는지 검증한다.
4. 내보내기: 야간 날짜 경계, 월말·연말, 휴무 제외, PNG 가독성, 지원 캘린더의 ICS 가져오기를 검증한다.
5. 결제: 세 번째 고유 월, 같은 달 재등록, 결제 실패, 결제 재시도, 중복 알림, 무료 차감 원자성을 검증한다.
6. 소규모 출시: 두 번째 달 재등록, 공유 링크 재방문, 세 번째 달 실제 구매를 관찰한다.

분석 이벤트에는 이름·원본·근무 상세를 넣지 않는다. 업로드 시작, 인식 완료, 확인 완료, 월 발행, 각 내보내기 사용, 다음 월 재등록, 결제 노출·성공을 수집한다. 대조가 필요한 원본은 별도 동의를 받아 보관 기간을 정한다.

## 12. 이번 산출물의 범위

기획과 화면 동작을 검토하는 단계다. 대화 내 시안은 예시 데이터로 등록, 인식 완료 블러 미리보기, 로그인 유도, 이름 선택, 수정, 저장, 공유·내보내기 선택, 결제 화면을 탐색한다. 실제 AI 인식, 계정 인증, 결제, 외부 공유, 캘린더 쓰기는 연결하지 않았다. 실제 서비스 제작 때 위 정책과 상태를 구현한다.


## 부록 B. 최신 디자인 참고 원본

이 HTML은 시각·동선 검토용 프로토타입이다. 그대로 실서비스로 배포하지 않는다. 가상 이름과 일정만 사용한다. 실제 사진, 인증, 결제, 다운로드는 연결되어 있지 않다.

실서비스 이식 시 유의:

- `.viz-dotted-background`와 외부 호스트의 `lucide` 전역 의존성은 앱 내 레이아웃과 설치한 아이콘 컴포넌트로 바꾼다.
- 상단 화면 선택기와 시안 배너는 개발 전용이다.
- 블러가 첫 화면인 것은 이번 디자인 검토를 위한 설정이다. 서비스 진입점은 사진 업로드다.
- `complete()`의 미확인 값을 E로 채우는 동작은 시연용이다. 제품에는 옮기지 말고 null을 사용자가 확인할 때까지 유지한다.
- 버튼의 성공 메시지는 제품 기능이 아니다. 실제 서버 처리 결과에 연결한다.
- 시안에 고정된 월, 이름, 시간, 가격 외 무료 상태 문구를 실제 데이터와 권한에 연결한다.
- 시안의 대상 월 입력 제한을 제거하고 임의의 유효한 월을 지원한다.
- 로그인 제공자는 아직 확정되지 않았다. 로그인 버튼 다음에 구현한 제공자의 실제 인증을 연결한다.
- 부록 A의 이름 미발견, 커스텀 코드, 시간 편집, 원본 확대, 공유 중지 등은 시안에 일부만 표현되어 있어도 MVP 요구에 포함된다.
- 기존 시안은 JavaScript 문법 확인만 수행했다. 실행 환경에 브라우저 바이너리가 없어 시각 렌더링·클릭 흐름 테스트는 미완료다. 구현하면서 직접 검증한다.

```html
<div id="shift-design" class="viz-dotted-background">
<style>
#shift-design {color-scheme:light dark;padding:16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--p-bg:light-dark(#fff,#151a25);--p-ink:light-dark(#172034,#eef2fc);--p-sub:light-dark(#667085,#a2adc0);--p-line:light-dark(#e7ebf2,#30394b);--p-soft:light-dark(#f4f6fb,#202839);--p-blue:light-dark(#3155e7,#91a7ff);--p-bluefill:light-dark(#edf1ff,#28345a)}
#shift-design *{box-sizing:border-box} #shift-design button,#shift-design input,#shift-design select{font:inherit} #shift-design button{color:inherit;cursor:pointer} #shift-design .frame{max-width:430px;margin:auto;background:var(--p-bg);color:var(--p-ink);border:1px solid var(--p-line);border-radius:26px;overflow:hidden} #shift-design .previewbar{padding:10px 18px;background:var(--p-soft);display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;color:var(--p-sub)} #shift-design .previewbar select{max-width:145px;border:0;background:transparent;color:var(--p-ink);padding:6px;font-size:13px} #shift-design header{padding:22px 22px 12px;display:flex;align-items:center;justify-content:space-between} #shift-design .wordmark{font-size:19px;font-weight:600;letter-spacing:-1px} #shift-design .wordmark span{color:var(--p-blue)} #shift-design .tiny{font-size:12px;color:var(--p-sub)} #shift-design .main{padding:18px 22px 24px;min-height:545px} #shift-design h2{font-size:29px;line-height:1.3;letter-spacing:-1px;font-weight:600;margin:10px 0 12px} #shift-design h3{font-size:18px;margin:0 0 10px;font-weight:600} #shift-design p{font-size:14px;line-height:1.65;color:var(--p-sub);margin:8px 0 20px} #shift-design .label{font-size:12px;color:var(--p-blue);font-weight:600;letter-spacing:.4px} #shift-design .primary,#shift-design .secondary{min-height:49px;padding:13px 16px;border-radius:13px;border:0;width:100%;font-size:15px;font-weight:500} #shift-design .primary{background:light-dark(#3155e7,#91a7ff);color:light-dark(#fff,#15214b)} #shift-design .primary:disabled{opacity:.45;cursor:default} #shift-design .secondary{background:var(--p-soft);color:var(--p-ink)} #shift-design .textbutton{background:none;border:0;padding:8px 0;color:var(--p-sub);font-size:13px;min-height:36px} #shift-design .stack{display:grid;gap:10px} #shift-design .block{padding:18px;border-radius:16px;background:var(--p-soft);margin:20px 0} #shift-design .uploadbox{border:1.5px dashed var(--p-line);border-radius:18px;padding:24px 18px;text-align:center;margin:22px 0 14px} #shift-design .uploadicon{display:inline-flex;color:var(--p-blue);background:var(--p-bluefill);border-radius:14px;padding:15px;margin-bottom:13px} #shift-design .uploadbox h3{font-size:16px} #shift-design .uploadbox p{font-size:13px;margin:8px 0 18px} #shift-design .hint{font-size:12px;text-align:center;line-height:1.6;color:var(--p-sub);margin:14px 0} #shift-design .benefits{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;font-size:12px;color:var(--p-sub);margin:22px 0} #shift-design .benefits span{display:flex;gap:5px;align-items:center} #shift-design .field{display:grid;gap:8px;margin:18px 0;font-size:14px} #shift-design input,#shift-design select{background:var(--p-bg);color:var(--p-ink);border:1px solid var(--p-line);padding:12px;border-radius:10px;min-width:0;font-size:16px} #shift-design .person{display:flex;align-items:center;justify-content:space-between;padding:15px;border:1px solid var(--p-line);border-radius:12px;font-size:15px;margin-bottom:9px} #shift-design .person:has(input:checked){border-color:var(--p-blue);background:var(--p-bluefill)} #shift-design .person input{accent-color:var(--p-blue);width:18px;height:18px} #shift-design .calendarhead{display:flex;justify-content:space-between;align-items:end;margin:12px 0 20px} #shift-design .calendarhead h2{margin:5px 0 0;font-size:27px} #shift-design .week,#shift-design .grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px} #shift-design .week{text-align:center;font-size:12px;color:var(--p-sub);margin-bottom:9px} #shift-design .day{display:flex;flex-direction:column;align-items:center;gap:7px;padding:9px 1px;min-height:66px;border:0;border-radius:10px;background:transparent;font-size:13px;font-variant-numeric:tabular-nums;min-width:0} #shift-design .day[aria-pressed=true]{box-shadow:inset 0 0 0 2px var(--p-blue);background:var(--p-bluefill)} #shift-design .badge{font-size:11px;border-radius:5px;min-width:29px;padding:3px 2px;text-align:center;font-weight:500} #shift-design .D{color:light-dark(#2455be,#a9c8ff);background:light-dark(#e9f1ff,#263a5b)} #shift-design .E{color:light-dark(#7844a7,#d6b5ff);background:light-dark(#f1e9fa,#433054)} #shift-design .N{color:light-dark(#384c79,#bdd0ff);background:light-dark(#e5eaf4,#2e3955)} #shift-design .S{color:light-dark(#8c611f,#f1d09e);background:light-dark(#fff0d8,#4a3b27)} #shift-design .OFF{color:var(--p-sub);background:var(--p-soft)} #shift-design .unknown{color:light-dark(#99550d,#ffcb87);background:light-dark(#fff0dc,#493722)} #shift-design .warning{padding:12px 14px;border-radius:12px;font-size:13px;line-height:1.5;background:light-dark(#fff2df,#453626);color:light-dark(#8c5310,#ffce94);margin:14px 0} #shift-design .legend{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--p-sub);margin:13px 0 20px} #shift-design .editor{padding:16px;background:var(--p-soft);border-radius:14px;margin:12px 0} #shift-design .edithead{display:flex;justify-content:space-between;align-items:center;font-size:14px;margin-bottom:12px} #shift-design .choices{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px} #shift-design .choices button{border:1px solid var(--p-line);background:var(--p-bg);border-radius:8px;min-height:44px;font-size:12px;padding:3px} #shift-design .choices button[aria-pressed=true]{border-color:var(--p-blue);color:var(--p-blue)} #shift-design .time{font-size:13px;color:var(--p-sub);margin-top:12px} #shift-design .actionrow{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px} #shift-design .actionrow button{font-size:14px} #shift-design .rowbutton{width:100%;display:flex;align-items:center;gap:13px;border:1px solid var(--p-line);background:var(--p-bg);border-radius:14px;text-align:left;padding:17px;margin:10px 0} #shift-design .rowbutton strong{display:block;font-size:15px;font-weight:500} #shift-design .rowbutton small{display:block;font-size:12px;color:var(--p-sub);margin-top:5px;line-height:1.4} #shift-design .rowbutton i{color:var(--p-blue)} #shift-design .price{font-size:37px;font-weight:600;letter-spacing:-1px;margin:12px 0} #shift-design .receipt{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--p-line);font-size:14px} #shift-design .check{display:flex;gap:8px;font-size:13px;line-height:1.5;color:var(--p-sub);margin:15px 0;align-items:start} #shift-design .check input{margin-top:3px;accent-color:var(--p-blue)} #shift-design .notice{font-size:13px;line-height:1.6;padding:15px;background:var(--p-bluefill);border-radius:12px;margin:15px 0;color:var(--p-ink)} #shift-design .bottom{padding-top:20px} #shift-design .back{display:flex;align-items:center;gap:5px;border:0;background:none;color:var(--p-sub);font-size:13px;padding:0 0 10px;min-height:30px} #shift-design #sd-message:empty{display:none} #shift-design #sd-message{padding:12px 22px;background:var(--p-bluefill);color:var(--p-ink);font-size:13px;line-height:1.5} #shift-design .crop{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;border:1px solid var(--p-line);font-size:12px;text-align:center;margin-top:10px} #shift-design .crop span{padding:8px 2px;background:var(--p-bg)} #shift-design .crop .raw{color:var(--p-sub);background:var(--p-soft)}
@media(max-width:360px){#shift-design .main{padding:16px 13px 22px}#shift-design header{padding-left:16px;padding-right:16px}#shift-design .day{min-height:64px}#shift-design .badge{min-width:27px}}
#shift-design .teaser{position:relative;border:1px solid var(--p-line);border-radius:18px;overflow:hidden;margin:20px 0;background:var(--p-bg);padding:14px 8px} #shift-design .teaser-content{filter:blur(5px);opacity:.55;user-select:none;pointer-events:none} #shift-design .teaser-content .fake-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px} #shift-design .fake-cell{height:43px;display:flex;align-items:center;justify-content:center} #shift-design .fake-cell span{display:block;width:25px;height:13px;border-radius:4px;background:var(--p-bluefill)} #shift-design .teaser-lock{position:absolute;inset:0;display:flex;align-items:center;justify-content:center} #shift-design .lock-label{background:var(--p-bg);padding:12px 17px;border-radius:30px;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--p-ink);box-shadow:0 2px 12px light-dark(#17203415,#00000030)}
</style>
<div class="frame">
 <div class="previewbar"><span>디자인 시안 · 예시 데이터</span><select id="sd-screen" aria-label="화면 선택"><option value="upload">사진 등록</option><option value="login">인식 완료·로그인</option><option value="person">이름 선택</option><option value="review">인식 결과 확인</option><option value="calendar">내 달력</option><option value="share">공유·내보내기</option><option value="public">받은 달력</option><option value="payment">세 번째 달 결제</option></select></div>
 <header><div class="wordmark">오프<span>날</span></div><span class="tiny">내 근무, 함께 보는 달력</span></header>
 <main class="main" id="sd-main"></main><div id="sd-message" role="status" aria-live="polite"></div>
</div>
<script>
(()=>{
 const root=document.getElementById('shift-design'), main=root.querySelector('#sd-main'), picker=root.querySelector('#sd-screen'), message=root.querySelector('#sd-message');
 const initial=['OFF','D','D','E','E','OFF','S','D','D','OFF','OFF','E','E',null,'N','N','OFF','OFF','D','D','E','E','OFF','S','OFF','D','D','E','OFF','OFF','S'];
 let shifts=[...initial], screen='upload', selected=14, name='김하루', reviewDone=false, exported=false;
 const names=['일','월','화','수','목','금','토'];
 const times={D:'07:00–16:00',E:'13:00–22:00',N:'21:30–다음 날 07:30',S:'10:00–19:00',OFF:'휴무'};
 const icon=n=>`<i data-lucide="${n}" aria-hidden="true"></i>`;
 const button=(t,a,cls='primary')=>`<button type="button" class="${cls} cursor-interaction" data-action="${a}">${t}</button>`;
 const back=(s='calendar')=>`<button type="button" class="back cursor-interaction" data-action="${s}">${icon('chevron-left')}돌아가기</button>`;
 function cal(edit=false){let h='<div class="week">'+names.map(d=>`<span>${d}</span>`).join('')+'</div><div class="grid">'+'<span></span>'.repeat(4);shifts.forEach((s,i)=>{h+=`<button type="button" class="day cursor-interaction" data-day="${i+1}" aria-label="10월 ${i+1}일 ${s||'확인 필요'}" aria-pressed="${selected===i+1}"><span>${i+1}</span><span class="badge ${s||'unknown'}">${s||'확인'}</span></button>`});return h+'</div><div class="legend"><span>D 오전</span><span>E 오후</span><span>N 야간</span><span>S 중간</span><span>OFF 휴무</span></div>'}
 function editor(){const s=shifts[selected-1];return `<div class="editor"><div class="edithead"><strong>10월 ${selected}일 (${names[(selected+3)%7]})</strong><span class="tiny">근무 수정</span></div><div class="choices">${['D','E','N','S','OFF','?'].map(c=>`<button type="button" class="cursor-interaction" data-code="${c}" aria-pressed="${c===(s||'?')}">${c==='?'?'미확인':c}</button>`).join('')}</div><div class="time">${s?times[s]:'원본을 확인하고 근무를 선택해 주세요.'}</div></div>`}
 function complete(){shifts=shifts.map(s=>s||'E');reviewDone=true}
 function render(next){screen=next;picker.value=['upload','login','person','review','calendar','share','public','payment'].includes(next)?next:'share';message.textContent='';let h='';
 if(next==='login')h=`<div class="label">근무표 인식 완료</div><h2>근무표를 읽었어요.<br>내 달력을 확인해 보세요.</h2><p>로그인하면 내 이름을 선택하고<br>근무를 확인·수정할 수 있어요.</p><div class="teaser" aria-label="로그인 후 확인 가능한 달력 미리보기"><div class="teaser-content" aria-hidden="true"><div class="week">${names.map(n=>`<span>${n}</span>`).join('')}</div><div class="fake-grid">${Array.from({length:35},()=>'<div class="fake-cell"><span></span></div>').join('')}</div></div><div class="teaser-lock"><span class="lock-label">${icon('lock-keyhole')}로그인하고 내 근무 확인</span></div></div>${button('로그인하고 무료로 확인','login-continue')}<div class="hint">처음 두 달 무료 · 카드 등록 없이 시작<br>세 번째 달부터 한 달분 1,900원 · 자동 결제 없음</div><div class="notice">업로드한 사진은 다시 올리지 않아도 돼요.<br>로그인 후 이어서 확인할 수 있어요.</div><div style="text-align:center">${button('다른 사진 올리기','upload','textbutton')}</div>`;
 if(next==='upload')h=`<div class="label">처음 두 달은 무료</div><h2>근무표 한 장이면<br>이번 달 준비 끝.</h2><p>내 근무만 달력으로 정리하고<br>가족과 친구에게 공유해 보세요.</p><div class="uploadbox"><div class="uploadicon">${icon('scan-line')}</div><h3>근무표 사진을 올려 주세요</h3><p>표 전체와 날짜가 선명하게 보이는 사진</p>${button('사진 선택','demo-upload')}</div><div class="hint">이 시안에서는 예시 근무표로 진행해요.</div><div class="benefits"><span>${icon('calendar-plus')}캘린더 추가</span><span>${icon('link')}링크 공유</span><span>${icon('image')}이미지 저장</span></div><div class="block"><h3>두 달 써보고 결정하세요</h3><p style="margin:0">세 번째 달부터 한 달분 1,900원.<br>필요한 달만 구매하고, 자동 결제는 없어요.</p></div><div class="hint">원본은 AI로 분석하며 공유 화면에는 포함되지 않아요.<br>확인·저장 후 원본을 삭제해요.</div>`;
 if(next==='person')h=`${back('upload')}<div class="label">1 / 2 · 내 근무 찾기</div><h2>어느 분의 근무표인가요?</h2><p>이름과 대상 월을 확인해 주세요.</p><label class="field">근무표 대상 월<input type="month" value="2026-10" id="sd-month" aria-label="근무표 대상 월"></label><div class="tiny" style="margin-bottom:12px">인식된 이름 · 예시</div>${['김하루','이여름','박지우'].map(n=>`<label class="person"><span>${n}</span><input type="radio" name="sd-person" value="${n}" ${n===name?'checked':''}></label>`).join('')}<div class="bottom">${button('내 근무 확인하기','review')}</div>${button('이름이 없어요','name-missing','textbutton')}`;
 if(next==='review'){const missing=shifts.filter(s=>!s).length;h=`${back('person')}<div class="label">2 / 2 · 인식 결과 확인</div><h2>내 근무가 맞는지<br>확인해 주세요.</h2><div class="tiny">${name} · 2026년 10월 · 날짜를 눌러 수정</div>${missing?'<div class="warning">확인 필요한 날짜가 1개 있어요. 14일 근무를 선택해 주세요.</div>':'<div class="notice">모든 날짜가 채워졌어요. 근무 시간도 확인해 주세요.</div>'}<div class="crop" aria-label="예시 원본 일부의 텍스트 재현"><span>11일</span><span>12일</span><span>13일</span><span>14일</span><span>15일</span><span>16일</span><span>17일</span><span class="raw">OFF</span><span class="raw">E</span><span class="raw">E</span><span class="raw">E?</span><span class="raw">N</span><span class="raw">N</span><span class="raw">OFF</span></div><div class="tiny" style="margin:6px 0 14px">원본 비교 영역 예시 · 실제 사진 아님</div>${cal(true)}${editor()}<details><summary style="font-size:13px;margin:14px 0">근무 시간 확인</summary><div class="time">D 07:00–16:00 · E 13:00–22:00<br>N 21:30–다음 날 07:30 · S 10:00–19:00</div></details><button type="button" class="primary cursor-interaction" data-action="save" ${missing?'disabled':''}>확인하고 무료로 저장</button><div class="hint">첫 번째 무료 월로 저장돼요.</div>`}
 if(next==='calendar'||next==='public'){complete();const pub=next==='public',off=shifts.filter(s=>s==='OFF').length;h=`<div class="label">${pub?'함께 보는 근무표':'내 달력'}</div><div class="calendarhead"><div><div class="tiny">${name}님의 근무</div><h2>2026년 10월</h2></div><span class="tiny">근무 ${31-off} · 휴무 ${off}</span></div>${cal()}<div class="editor"><div class="edithead"><strong>10월 ${selected}일 (${names[(selected+3)%7]})</strong><span class="badge ${shifts[selected-1]}">${shifts[selected-1]}</span></div><div class="time">${times[shifts[selected-1]]}</div></div>${pub?'<div class="hint">예시 수정 시각 · 9월 29일 18:30<br>공유받은 달력은 읽기 전용이에요.</div>':`${button('공유·내보내기','share')}<div class="actionrow">${button('근무 수정','review','secondary')}${button('다음 달 등록','upload','secondary')}</div><div class="hint">첫 번째 무료 월 · 무료로 한 달 더 이용할 수 있어요.</div>`}`}
 if(next==='share')h=`${back()}<div class="label">2026년 10월 · ${name}</div><h2>내 일정을<br>편한 방식으로.</h2><p>함께 보는 사람은 가입하지 않아도 돼요.</p><button type="button" class="rowbutton cursor-interaction" data-action="link">${icon('link')}<span><strong>링크로 공유</strong><small>근무가 바뀌어도 같은 링크에서 확인</small></span></button><button type="button" class="rowbutton cursor-interaction" data-action="ics">${icon('calendar-plus')}<span><strong>내 캘린더에 추가</strong><small>약속과 출퇴근 시간을 한곳에서 확인</small></span></button><button type="button" class="rowbutton cursor-interaction" data-action="image">${icon('image')}<span><strong>달력 이미지 저장</strong><small>카톡으로 보내거나 사진첩에 보관</small></span></button><div class="block"><h3>내 일정만 공유해요</h3><p style="margin:0">동료들의 이름과 원본 근무표는<br>공유 화면에 표시되지 않아요.</p></div>`;
 if(next==='link')h=`${back('share')}<h2>같은 링크로<br>매달 함께.</h2><p>공개할 이름과 월을 확인해 주세요.</p><div class="block"><div class="receipt"><span>표시 이름</span><strong>${name}</strong></div><div class="receipt"><span>공개 월</span><strong>2026년 10월</strong></div></div><div class="notice">링크를 가진 사람은 누구나 볼 수 있고 다시 전달할 수 있어요.</div>${button('받은 사람 화면 미리보기','public')}<div style="margin-top:10px">${button('공유 링크 만들기','link-demo','secondary')}</div><div class="hint">공유 중지와 링크 재발급은 내 달력에서 관리해요.</div>`;
 if(next==='ics')h=`${back('share')}<h2>내 캘린더에<br>근무를 추가해요.</h2><p>2026년 10월 · ${name}</p><div class="block"><h3>출퇴근 시간을 함께</h3><p style="margin:0">D · 07:00–16:00<br>E · 13:00–22:00<br>N · 21:30–다음 날 07:30<br>S · 10:00–19:00</p></div><label class="check"><input type="checkbox">휴무도 종일 일정으로 추가</label><div class="notice">한 번 가져오는 방식이에요. 이후 근무 변경은 자동 반영되지 않아요. 다시 가져오면 일정이 중복될 수 있어요.</div>${button('일정 파일 받기','ics-demo')}<div class="hint">ICS 형식 · 한국 시간 기준</div>`;
 if(next==='image'){complete();h=`${back('share')}<h2>한 장으로 공유해요.</h2><p>${name}의 2026년 10월 · 이미지 미리보기</p>${cal()}<div class="hint">D 07–16 · E 13–22 · N 21:30–다음 날 07:30<br>S 10–19 · OFF 휴무<br>예시 생성 시각 2026.09.29 18:30</div>${button('이미지 저장','image-demo')}<div class="hint">저장된 이미지는 이후 근무 변경이 반영되지 않아요.</div>`}
 if(next==='payment')h=`${back()}<div class="label">무료 두 달을 모두 이용했어요</div><h2>필요한 달만,<br>가볍게 이어가세요.</h2><p>12월 근무표 인식과 확인을 마쳤어요.<br>구매하면 저장하고 공유할 수 있어요.</p><div class="block"><div class="tiny">2026년 12월 이용권</div><div class="price">1,900<span style="font-size:17px;font-weight:400">원</span></div><div class="receipt"><span>이번 달 근무표 저장</span><span>포함</span></div><div class="receipt"><span>캘린더 추가 · 링크 · 이미지</span><span>포함</span></div><div class="receipt"><span>같은 달 근무 수정</span><span>포함</span></div><p style="margin:14px 0 0;font-size:13px">단건 구매예요. 다음 달 자동 결제는 없어요.</p></div>${button('1,900원 결제하고 저장','pay-demo')}<div style="text-align:center">${button('나중에 할게요','calendar','textbutton')}</div><div class="hint">구매하지 않아도 기존 달력은 그대로 볼 수 있어요.<br>시안의 결제 버튼은 실제 결제를 진행하지 않아요.</div>`;
 main.innerHTML=h; if(window.lucide)window.lucide.createIcons({attrs:{width:18,height:18}});
 }
 root.addEventListener('change',e=>{if(e.target===picker){if(['calendar','share','public'].includes(picker.value))complete();render(picker.value)}if(e.target.name==='sd-person')name=e.target.value; if(e.target.id==='sd-month'&&e.target.value!=='2026-10'){e.target.value='2026-10';message.textContent='이번 시안은 2026년 10월 예시로 확인할 수 있어요.'}});
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.day){selected=Number(b.dataset.day);render(screen);return}if(b.dataset.code){shifts[selected-1]=b.dataset.code==='?'?null:b.dataset.code;render('review');return}const a=b.dataset.action;if(!a)return;if(a==='demo-upload'){render('login');return}if(a==='login-continue'){render('person');message.textContent='시안에서는 로그인을 완료한 상태로 이어져요. 실제 인증은 연결되지 않았어요.';return}if(a==='save'){reviewDone=true;render('calendar');message.textContent='첫 번째 무료 월로 예시 달력을 저장했어요.';return}if(a==='name-missing'){message.textContent='이름을 직접 입력하거나 원본에서 내 행을 선택하는 경로를 제공할 예정이에요.';return}if(a.endsWith('-demo')){message.textContent=a==='pay-demo'?'결제 화면을 확인했어요. 실제 결제는 연결하지 않았어요.':a==='link-demo'?'실제 공유 링크는 서비스 구현 후 생성돼요. 미리보기로 받은 사람 화면을 확인해 주세요.':a==='ics-demo'?'실제 일정 파일 생성은 서비스 구현에 포함돼요. 이 시안에서는 다운로드하지 않아요.':'실제 이미지 저장은 서비스 구현에 포함돼요. 이 시안에서는 미리보기만 제공해요.';return}render(a)});
 render('login');
})();
</script>
</div>

```
