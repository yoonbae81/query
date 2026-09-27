# 보안

OWASP ASVS 5.0.0을 기준으로 정리한 문서다. 기본 설정은 **로컬 단일 사용자**를 전제로 하며, 외부에 노출할 때는 아래의 설정 가이드를 따른다.

## 인증

- `API_TOKEN`을 설정하면 REST(`/api`), MCP, 확장 WebSocket 모두 인증이 필요하다. REST/MCP는 `Authorization: Bearer`, 브라우저 WebSocket은 헤더를 못 붙이므로 `?token=`도 허용한다.
- 토큰 비교는 상수 시간(`timingSafeEqual`)으로 하고, 어느 토큰과 틀렸는지 정보가 새지 않게 끝까지 비교한다.
- 인증 실패는 IP당 10회/5분을 넘으면 429로 차단한다(성공 시 초기화).
- **기동 가드**: `QUERY_HOST`가 loopback(127.0.0.1 등)이 아닌데 `API_TOKEN`이 비어 있으면 서버는 시작을 거부한다. 인증 없이 외부에 노출되는 일을 구조적으로 막는다.

## 요청 방어

- **Origin 검증**: 브라우저 요청은 동일 출처 또는 `ALLOWED_ORIGINS`·확장(chrome-extension) Origin만 허용하고, 상태 변경 메서드는 `application/json` Content-Type을 강제한다(CSRF 완화).
- **속도 제한**: IP당 분당 요청 수 제한(`RATE_LIMIT_PER_MINUTE`, 기본 300).
- **본문 제한**: 크기(`MAX_BODY_BYTES`)·Content-Type(JSON만)을 강제하고, 경로 식별자는 `^[A-Za-z0-9_-]{1,64}$` 화이트리스트로 검증한다.
- **보안 헤더**: CSP(`default-src 'none'; script-src 'self'`, `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP. API 응답은 `Cache-Control: no-store`.

## 데이터 처리

- **SQL**: 모든 쿼리는 파라미터 바인딩. 검색어의 `%`/`_`/`\`는 LIKE용으로 이스케이프한다.
- **파일**: 답변 파일 경로는 읽기·삭제 시 답변 디렉터리 안으로 제한하고(경로 탐색 차단, Windows 대소문자 무시 비교 포함), 파일명은 검증된 ID로 서버가 생성한다.
- **XSS**: AI 답변 마크다운은 DOMPurify로 정화한 뒤 렌더링하고, 링크는 `target="_blank" rel="noopener noreferrer"`를 강제한다.
- **로그**: URL의 쿼리스트링(토큰)은 제거하고 기록한다. 요청 로그는 실패(4xx/5xx)와 느린 요청만 남긴다.

## 설정 가이드

| 항목 | 설명 |
|---|---|
| `API_TOKEN` | 외부 접근이 가능한 주소로 열 때 필수. 쉼표로 여러 개 등록 가능 |
| `ALLOWED_ORIGINS` | 웹 UI를 다른 Origin(예: 리버스 프록시 도메인)에서 쓸 때 추가 |
| `TRUST_PROXY` | 리버스 프록시 뒤에서 `X-Forwarded-For`를 신뢰할 때만 `true`(rate limit의 IP 판단에 영향) |
| `QUERY_HOST` | 기본 `127.0.0.1`. 외부 노출 시 토큰 필수(위 기동 가드) |

웹 UI는 401을 받으면 토큰을 묻고 브라우저(localStorage)에 저장한다. 확장은 설정 페이지에서 입력한 토큰을 `chrome.storage`에 보관한다.

## 외부에 노출할 때

1. `API_TOKEN`을 설정한다(기동 가드가 강제한다).
2. TLS 종단 프록시(리버스 프록시) 뒤에 두고 `BASE_PATH`·`ALLOWED_ORIGINS`·`TRUST_PROXY`를 맞춘다.
3. 본 프로젝트는 개인적 사용을 전제로 하며, 다중 사용자·계정 모델은 제공하지 않는다.
