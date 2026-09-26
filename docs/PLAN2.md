# Query — 개발 명세서 v2 (브라우저 확장 방식)

PLAN.md(Playwright 워커 방식)를 대체하는 재설계안이다. **질문은 웹서버에 쌓아 두고, 사용자가 이미 로그인해 둔 브라우저(Vivaldi/Chrome)의 확장 프로그램이 대상 사이트(Perplexity 등)에서 직접 질의해 결과를 서버로 돌려보낸다.**

- 후속 변경(카테고리·프롬프트 저장소·데이터 디렉터리 정리·웹 UI 재디자인·다중 provider 계획)은 [PLAN3.md](PLAN3.md)에 있다. 그 사이 바뀐 경로(`user/database/`, `user/prompts/`, 답변 파일명)는 PLAN3가 기준이다.
- PLAN.md는 이 문서가 다루지 않는 항목(§2의 "유지" 표)의 기준 문서로 계속 유효하다.
- 이 문서의 결정 사항은 모두 사용자 확인을 마쳤다(§11). 스택 세부(§12.2)는 구현 중 발견한 사실에 따라 조정하며, 조정 시 이 문서에 기록한다.

## 1. 재설계 배경과 개요

### 1.1 배경 (PLAN §6.4에서 관찰한 사실)
- Perplexity는 Cloudflare 봇 검증(Turnstile)을 사용하며, 자동화 브라우저(Playwright, 저장된 세션 재사용 포함)는 검증 화면에서 멈춘다.
- 로그인 자동화는 이메일 인증번호(Gmail API)까지 필요했고, 이 경로 전체가 사이트 정책·UI 변경에 취약하다.
- 사용자가 실제로 로그인해 둔 브라우저 안에서 동작하면 위 문제(봇 검증, 로그인 자동화, 인증번호)가 모두 사라진다.

### 1.2 개요
- **웹서버**는 큐·저장·API·웹 UI·MCP를 담당한다(PLAN과 동일). 질의 등록은 확장 상태와 무관하게 언제나 가능하며 서버에 계속 쌓인다.
- **브라우저 확장**은 "워커" 역할을 한다. 사용자가 확장을 **ON**으로 두면 서버에 접속해 자신이 처리 가능한 provider(현재 열려 있는 탭의 사이트)를 알리고, 대기 중인 질의를 **가져가서(claim)** 해당 사이트의 방식으로 질의한 뒤 결과를 서버로 보낸다.
- 서버가 확장에 밀어 넣지(push) 않는다. **확장이 가져간다(pull).** PLAN의 "원자적 클레임"이 그대로 쓰이므로 큐 정합성 규칙이 유지된다.
- 처리는 **브라우저가 켜져 있고 확장이 ON일 때만** 진행된다. "서버 24시간 무인 처리"는 목표에서 제외한다. 큐는 24시간 동작한다.
- MVP 범위는 **Perplexity 콘텐츠 스크립트 1개**다. Claude/Gemini/ChatGPT는 사이트별 콘텐츠 스크립트 모듈을 추가하는 방식으로 확장한다.
- 그 외 PLAN §1의 원칙(기본 Perplexity 단독, 다중 provider 동시 질의, 새 대화로 1회 질의, 답변 작성 지침 공통 적용, 벌크 등록, 답변 파일 저장, MVP 무인증)은 그대로다.

## 2. PLAN.md와의 관계

| 항목 | 처리 |
|---|---|
| §4 REST API (등록/벌크/provider 추가/ask/조회/SSE/retry/답변 작성 지침) | **유지**. 단 `GET /providers` 응답 필드 변경(§5.3) |
| §5 웹 UI | **본 문서 §13으로 이전**(디자인 가이드라인 포함, 확장 연결 상태 반영). 이후 UI 기준은 §13 |
| §7 MCP | **유지** |
| §3 데이터 모델 | **변경**: 컬럼 추가(§3) |
| §3.1 보관 정책 | 유지. 정리 작업은 API 프로세스의 백그라운드 태스크로 이동(§4.4) |
| §6 워커/Playwright/로그인/Gmail | **폐기**. 확장 프로토콜(§4)과 확장 설계(§6)로 대체 |
| §6.5 재시도 정책 | **변경**: 오류 유형별 처리(§4.3) |
| §6.7 답변 파일 저장 | 유지 (저장 시점만 "결과 수신 시") |
| §8 배포 | **변경**: worker 서비스 없음(§8) |

## 3. 데이터 모델 변경

`query_results`에 다음을 추가한다.

```sql
lease_expires_at TIMESTAMP,   -- processing 상태의 임대 만료 시각 (§4.4)
claimed_by TEXT               -- 작업을 가져간 확장 클라이언트 ID (디버깅용)
```

- 나머지(`status`, `priority`, `retry_count`, `next_attempt_at`, `progress_message`, `system_prompt_snapshot` 등)와 규칙(UTC 저장, KST 표시, ID 규칙, UNIQUE(query_id, provider), WAL)은 PLAN §3, §3.0과 동일하다.
- `system_prompt_snapshot`은 **작업을 claim하는 시점**의 답변 작성 지침로 기록한다(PLAN의 "처리 시점"과 같은 의미).

## 4. 서버 ↔ 확장 프로토콜

### 4.1 전송 (확정: WebSocket)
- 엔드포인트: `GET /ext/ws` (basePath 하위, 예 `/query/ext/ws`). reverse proxy는 WebSocket 업그레이드를 전달해야 한다.
- 연결은 확장의 서비스 워커가 유지하며, 확장이 ON인 동안에만 연결한다. 30초 이내 주기로 `ping`을 보낸다(MV3 서비스 워커 수명 유지 및 끊김 감지 겸용).
- 인증: MVP는 무인증. 다만 연결 수락 지점에 인증 훅(`get_current_user`와 동일 계열, no-op)을 둔다. **향후 확장과 웹 UI 모두 토큰을 사용**하며, 토큰은 확장 설정에 저장하고 WebSocket 연결 시 전달한다(설정 `AUTH_TOKEN`, 비어 있으면 무인증). 이 훅 외의 코드는 인증 도입 시 변경되지 않아야 한다.

### 4.2 메시지 (JSON)

| 방향 | type | 필드 | 의미 |
|---|---|---|---|
| ext→srv | `hello` | `client_id`, `version`, `providers:[{id, state}]` | 접속 직후 처리 가능 provider 통지. `state`: `ready` / `login_required` / `no_tab` |
| ext→srv | `state` | `providers:[{id, state}]` | 탭 열림·닫힘, 로그인 상태 변화 시 갱신 |
| ext→srv | `claim` | `provider` | 해당 provider의 다음 작업 요청 (idle일 때만 전송) |
| srv→ext | `job` | `result_id`, `provider`, `prompt`, `lease_seconds` | 작업 배정. `prompt`는 서버가 만든 최종 입력문 |
| srv→ext | `idle` | `provider` | 가져갈 작업 없음 |
| srv→ext | `wake` | — | 새 pending 등록/재시도 대기 종료. idle 상태의 확장은 `claim`을 다시 보낸다 |
| ext→srv | `progress` | `result_id`, `message` | 진행 단계 (`progress_message`에 저장, 임대 연장) |
| ext→srv | `result` | `result_id`, `answer`, `citations` | 성공 |
| ext→srv | `error` | `result_id`, `code`, `message` | 실패 (§4.3) |
| 양방향 | `ping`/`pong` | — | 연결 유지 |

- **순차 처리(확정)**: 확장은 한 번에 하나의 `job`만 처리한다. 서버는 이미 임대 중인 클라이언트/provider 조합의 추가 `claim`을 `idle`로 거절한다.
- **프롬프트 조합**: 서버가 `{question}\n\n---\n\n{답변 작성 지침}`(질문 먼저, 지침은 뒤)으로 합쳐 `prompt`로 전달한다(지침이 비면 질문만). 확장은 이를 그대로 입력한다.
- claim은 PLAN §6.1의 원자적 클레임과 우선순위 규칙(`priority DESC, created_at ASC`, `next_attempt_at` 경과)을 그대로 쓰되 **요청한 provider로 필터링**한다. 여러 클라이언트가 접속해도 한 결과는 한 클라이언트만 가져간다.

### 4.3 오류 코드와 재시도
| code | 의미 | 서버 처리 |
|---|---|---|
| `login_required` | 사이트에 로그인되어 있지 않음 | **재시도 횟수를 늘리지 않고** `pending`으로 되돌림. 해당 provider를 offline으로 표시 |
| `timeout` | 답변 완료를 시간 내 감지하지 못함 | PLAN §6.5 재시도 정책(횟수 증가, backoff) |
| `selector_missing` | 화면 구조가 달라 요소를 찾지 못함 | 위와 동일. `failed` 확정 시 `error_message`에 셀렉터 이름을 남겨 유지보수 단서로 삼음 |
| `retryable` | 그 외 일시적 오류 | 위와 동일 |

- 재시도 횟수·backoff·최대 시도 횟수(최초 1회 + 재시도 `MAX_RETRY`회)는 PLAN §6.1, §6.5와 동일하다.

### 4.4 임대(lease)와 서버 백그라운드 태스크
- claim 시 `lease_expires_at = now + LEASE_SECONDS`(기본 120)를 기록하고, `progress`·`ping` 수신 시 연장한다.
- 서버는 `LEASE_SWEEP_INTERVAL_SECONDS`(기본 10)마다 만료된 `processing`을 회수한다. 회수는 **실패 1회로 간주**해 retry 정책을 적용한다(브라우저를 닫거나 탭이 죽는 상황의 무한 재시도를 막기 위함). WebSocket이 끊기면 해당 클라이언트의 임대는 즉시 만료 처리한다.
- API 프로세스 시작 시 남아 있는 `processing`은 모두 `pending`으로 복구한다(횟수 증가 없음).
- TTL 정리(PLAN §3.1)와 임대 회수는 **API 프로세스의 lifespan 백그라운드 태스크**로 돌린다. 이 때문에 API 서버는 **uvicorn 단일 프로세스(worker 1개)** 로 운영한다(접속 상태를 메모리에 두기 때문).
- 새 `pending`이 등록되면(등록 API, provider 추가, retry, backoff 종료) 서버는 접속 중인 확장들에 `wake`를 보낸다.

### 4.5 접속 상태(presence)
- 서버는 접속 중인 클라이언트와 각 provider의 `state`를 메모리로 관리한다. provider가 **online** = `ready` 상태의 클라이언트가 하나 이상 있음.
- **질의 등록은 online 여부와 무관하게 항상 허용**한다(확정). online 여부는 표시와 `/ask` 응답 판단에만 쓴다.

## 5. 서버 변경 사항

### 5.1 유스케이스 (PLAN §2.1 대비)
| 유스케이스 | 역할 |
|---|---|
| `ClaimNextResult` | provider 필터 원자적 claim, 답변 작성 지침 스냅샷 기록, `prompt` 조합, 임대 설정 |
| `RecordProgress` | `progress_message` 갱신, 임대 연장 |
| `CompleteResult` | 답변 파일 저장(§6.7) 후 `done` 확정 |
| `FailResult` | 오류 코드별 처리(§4.3) |
| `SweepLeases` | 만료 임대 회수(§4.4) |
| 기존 | `SubmitQuery`, `AddProviderToQuery`, `RetryResult`, `AskQuery`, `GetQuery`, `ListQueries`, `ManageSystemPrompt`, `CleanupExpiredResults` 유지 |

- `ProcessPendingResult`, `LLMProviderPort`, `AuthCodeProviderPort`, provider 레지스트리는 폐기한다. 지원 provider 목록은 정적 설정(`ALL_PROVIDERS`, MVP는 `perplexity`만 지원)이다.
- `ExtensionInboundAdapter`(WebSocket 핸들러)가 드라이빙 어댑터로서 위 유스케이스를 호출한다.

### 5.2 `/ask`, MCP `query_ask` 
- 동작은 PLAN §4.6과 같다(우선순위 1로 등록 후 완료/타임아웃까지 대기).
- 요청 시점에 해당 provider가 offline이면 **기다리지 않고 즉시** 현재 상태(`pending`)와 `note`("확장이 연결되어 있지 않거나 provider를 처리할 수 없는 상태입니다")를 반환한다. 이후 `GET /queries/{id}`/`query_status`로 확인한다.

### 5.3 `GET /providers` 변경
```json
{ "providers": [ { "id": "perplexity", "name": "Perplexity", "available": true, "online": false } ] }
```
- `available`: 지원 provider인지(콘텐츠 스크립트가 있는지). 웹 UI 체크박스 활성 여부의 기준이며 기존과 호환된다.
- `online`: 지금 처리 가능한 확장이 접속해 있는지(§4.5).
- 신규 `GET /extension/status`: 접속 클라이언트 수와 provider별 `state` 요약(웹 UI 상태 표시용).

### 5.4 웹 UI 변경
- 상단에 확장 연결 상태 뱃지(연결됨/끊김, provider별 online 여부)를 표시한다. §5.0 규칙에 따라 뱃지 외의 부연 설명 문구는 넣지 않는다.
- 화면 명세 전체는 §13이 기준이다. 질의 등록 폼과 목록은 online 여부와 무관하게 동작한다. `pending`이 오래 유지되는 것은 정상 상태다.

## 6. 브라우저 확장 설계

### 6.1 구성 (저장소 `extension/`, Manifest V3, Vivaldi/Chrome 공용 — 실제 구조는 §12.3이 기준)
```
extension/
├── manifest.json
├── background.js        # 서비스 워커: WebSocket 유지, claim 루프, 탭 관리
├── popup/               # ON/OFF 토글, 서버 URL·토큰 설정, 연결/provider 상태
├── content/
│   ├── common.js        # 공통 유틸(대기, 안정화 감지, 이벤트 주입)
│   └── perplexity.js    # Perplexity 사이트 모듈
└── options (팝업에 통합 가능)
```
- **설치**: 개인 사용이므로 개발자 모드의 "압축해제된 확장 로드"로 설치한다.
- **서버 주소(확정)**: 확장 설정에 입력한다(예 `https://host/query` 또는 `http://localhost:PORT`). 서버가 원격이면 사설망(WireGuard 등) 경유를 전제로 한다.

### 6.2 동작
1. **ON/OFF(확정)**: 팝업 토글이 ON일 때만 서버에 연결하고 작업을 가져간다. OFF이면 연결을 끊는다. 마지막 상태는 저장한다.
2. **provider 감지**: 확장이 열려 있는 탭의 URL 호스트를 지원 provider 목록과 대조해(`perplexity.ai` 등) 사이트 모듈을 매칭한다. 해당 사이트 탭이 없으면 `no_tab`, 있으나 미로그인이면 `login_required`, 아니면 `ready`로 서버에 통지한다.
3. **탭 사용(확정)**: 새 탭을 열지 않고 **이미 열려 있는 해당 사이트 탭**을 사용한다. 같은 사이트 탭이 여러 개면 가장 최근에 활성화된 탭을 쓴다(팝업에 사용 중인 탭 표시). 매번 새 대화를 위해 이 탭을 사이트의 새 대화 URL로 이동시키므로 **처리 중 그 탭은 확장이 제어한다**는 점이 사용 제약이다.
4. **순차 처리(확정)**: idle일 때 `claim` → `job` 수신 → 사이트 모듈 실행(`progress` 통지) → `result`/`error` 전송 → 다음 `claim`. `idle`을 받으면 `wake`가 올 때까지 대기한다.
5. **속도 제한**: 연속 질의 사이에 최소 간격(`MIN_INTERVAL_SECONDS`, 확장 설정, 기본 10초)을 둔다. 벌크 대량 질의로 계정이 제한될 위험을 줄이기 위함이다.

### 6.3 사이트 모듈 인터페이스 (provider 추가 = 모듈 1개 추가)
```
matches(url) -> bool                  # 이 사이트의 탭인가
isLoggedIn() -> bool
startNewThread()                      # 새 대화 화면으로 이동/초기화
submit(prompt)                        # 입력창에 입력 후 전송
waitForCompletion(onProgress)         # 완료 감지 (공통: 텍스트 안정화 + 사이트별 신호)
extract() -> { answer, citations[] }
```
- 완료 감지는 PLAN §6.3의 "고정 대기 + 안정화" 방식을 기본으로 하고, 사이트에 신뢰할 만한 신호(예: 생성 중 표시 요소 소멸)가 있으면 함께 사용한다.
- 셀렉터 유지보수는 사이트 모듈 파일 한 곳에서 이뤄진다.

### 6.4 확장 UI (확정: 순수 HTML/CSS + 소량 TypeScript, 프레임워크 없음)

UI가 작으므로 프레임워크·UI 빌드 도구 없이 정적 HTML/CSS와, 저장·메시징을 처리하는 TypeScript 파일 하나씩(`popup.ts`, `options.ts`)으로 구현한다. 빌드는 기존 esbuild 스크립트가 TS만 번들한다. MV3의 CSP(인라인 스크립트 금지)에 맞춰 스크립트는 외부 파일로만 로드한다. 디자인은 §13.0 가이드라인(부연 설명 금지, 그림자 없는 심플한 스타일, 시스템 다크 모드 자동)과 색 기준을 따르며, 필요한 CSS 변수만 확장 쪽에 복사해 둔다(공용 패키지 없음).

**팝업** (툴바 아이콘 클릭)
- **ON/OFF 토글**: 확장의 활성 상태. 아이콘 배지에도 상태(ON/OFF)를 표시한다.
- **연결 상태**: 연결됨 / 끊김 / 오류.
- **provider 상태 목록**: 지원 provider마다 `ready` / `login_required` / `no_tab`과 사용 중인 탭. 사용 중인 탭으로 이동하는 버튼.
- **현재 처리 중 작업**: query ID와 진행 메시지(없으면 표시 안 함).
- **바로가기**: 웹 UI 열기, 설정 열기.

**설정 페이지** (`options_ui`, 탭으로 열림)
| 항목 | 내용 |
|---|---|
| 서버 주소 | 필수. 예 `https://host/query` 또는 `http://localhost:PORT`. "연결 테스트" 버튼 제공 |
| 토큰 | 향후 인증용 입력란. 비어 있으면 무인증으로 연결 (§4.1) |
| 최소 질의 간격(초) | 기본 10 (§6.2) |

- 설정과 ON/OFF 상태는 `chrome.storage.local`에 저장한다. 서버와의 통신은 WebSocket뿐이라 서버 주소용 호스트 권한이 필요 없다(WebSocket은 CORS/호스트 권한 대상이 아님). "연결 테스트"도 WebSocket으로 ping→pong을 확인하며, 토큰 오류(서버가 연결 직후 4401로 닫음)도 이때 감지한다.
- 팝업/설정 페이지는 서비스 워커와 `chrome.runtime` 메시지로 통신한다(`getStatus`, `setActive`, `testConnection`). 서비스 워커는 상태가 바뀌면 열려 있는 팝업에 알린다. 이 경계는 확장 헥사고날의 inbound 어댑터가 유스케이스(`toggleActive`, `updateSettings`)를 호출하는 형태다.
- provider별 사용 여부 스위치, 작업 로그 화면 등은 만들지 않는다. 필요해지면 추가한다.

## 7. 스파이크 (확정: 구현과 병행, 필요한 시점에 콘솔 스니펫으로 확인)
서버 구현을 막지 않는다. 확장 구현 단계에서 필요한 시점에 사용자가 콘솔 스니펫을 실행해 결과를 주면 이 문서에 기록한다.
1. **Perplexity 셀렉터**: 입력창, 전송 방식, 답변 영역, 출처, 생성 중 신호, 로그인 여부 판별. (콘솔 스니펫으로 홈/생성 중/완료 3상태 캡처)
2. **입력 주입**: 콘텐츠 스크립트가 입력한 텍스트를 `#ask-input`(contenteditable)이 정상 인식하고 전송되는지.
3. **탭 상태**: 백그라운드/미포커스 탭에서 답변 생성과 감지가 정상 동작하는지(브라우저의 타이머 제한 영향).
4. **MV3 서비스 워커**: WebSocket 유지가 실제로 서비스 워커를 살려 두는지, `ping` 주기 검증.
5. **MCP** — 해결(2026-09-26): 공식 TS SDK 1.30.1로 Fastify에 마운트되며 공식 클라이언트로 검증했다. PLAN §7.2의 SSE(`GET /mcp/sse`, `POST /mcp/messages`)를 구현했고, SSE 전송이 SDK에서 deprecated여서 현재 표준인 Streamable HTTP(`POST /mcp`, stateless)도 함께 제공한다. 툴 3종(`query_ask`, `query_status`, `query_providers`)은 REST와 같은 유스케이스·응답 포맷을 쓴다.

## 8. 배포/실행 변경
- systemd는 `query-api.service` **하나만** 사용한다(`query-worker.service` 폐기). uvicorn은 worker 1개로 실행한다.
- reverse proxy는 `/query/ext/ws`의 WebSocket 업그레이드를 전달해야 한다(예: Nginx `Upgrade`/`Connection` 헤더).
- 환경변수 삭제: `PERPLEXITY_LOGIN_EMAIL`, `GMAIL_*`, `PLAYWRIGHT_*`, `BROWSER_PROVIDER`, `MAX_CONCURRENT_WORKERS`, `WORKER_POLL_INTERVAL_SECONDS`.
- 환경변수 추가: `LEASE_SECONDS`(120), `LEASE_SWEEP_INTERVAL_SECONDS`(10), `AUTH_TOKEN`(빈 값 = 무인증, 향후).
- 유지: `BASE_PATH`, `DEFAULT_PROVIDERS`, `MAX_RETRY`, `RETRY_BACKOFF_SECONDS`, `DB_PATH`, `SYSTEM_PROMPT_PATH`, `ANSWERS_DIR`, `RETENTION_DAYS`, `CLEANUP_INTERVAL_HOURS`, `ASK_*`, `MAX_QUERY_LENGTH`, `DISPLAY_TIMEZONE`.

## 9. 리스크
| 리스크 | 영향 | 대응 |
|---|---|---|
| 확장용 엔드포인트가 무인증 | 서버에 접근 가능한 누구나 결과를 주입/열람 가능 | MVP는 사설망/방화벽에 의존, 향후 토큰(§4.1). 서버를 공개망에 노출하지 않는다 |
| 사이트 UI 변경 | 셀렉터 미발견 → 실패 | `selector_missing` 코드로 원인 식별, 수정은 사이트 모듈 1개 |
| 자동 질의로 인한 계정 제한 | 계정 사용 제한 | 질의 간 최소 간격(§6.2), 사이트 약관 확인은 사용자 책임 |
| 브라우저 종료/탭 소실 | 처리 중단 | 임대 만료 회수(§4.4). 질의는 서버에 남아 재개됨 |
| 처리 중 탭 제어 | 사용자가 해당 탭을 쓰면 충돌 | 전용 탭으로 운영하도록 팝업에 사용 중 탭 표시 |
| 서비스 워커 수명 | 연결 끊김 | ping 유지, 끊기면 자동 재연결 + 임대 회수 |

## 10. 구현 순서
1. **서버**: 스키마 변경, provider 필터/임대 포함 claim, 유스케이스(§5.1), WebSocket 어댑터, presence, 임대 회수·정리 태스크. 가짜 확장 클라이언트로 프로토콜 테스트(기존 워커 테스트는 이 테스트로 대체).
2. **서버 API/UI**: `GET /providers` 필드, `/extension/status`, 웹 UI 상태 뱃지, `/ask` offline 처리.
3. **스파이크**(§7) — 확장 구현(4단계)과 병행해 필요한 시점에 콘솔 스니펫으로 진행. 이 단계가 다른 단계를 막지 않는다.
4. **확장**: background/popup/공통 유틸 → Perplexity 사이트 모듈.
5. **MCP** 서버(스파이크 5 결과에 따라).
6. **정리**: TypeScript 구현이 동등 기능에 도달한 뒤 Python 코드 전체 제거(§12.5). 폐기 대상(`worker.py`, `process_pending_result.py`, `adapters/outbound/llm/`, `adapters/outbound/auth/`, `scripts/gmail_oauth.py`, `install-systemd.sh`의 worker 유닛 등), 의존성에서 playwright/patchright/google-* 제거.
7. **토큰 인증**(향후): 확장·웹 UI 공통.

## 11. 확정된 기본값 (사용자 확인 완료)
| # | 항목 | 확정 내용 |
|---|---|---|
| 9 | 확장 오프라인일 때 `/ask` 동작 | 기다리지 않고 즉시 `pending` + `note` 반환 (§5.2) |
| 10 | 미로그인(`login_required`) 처리 | 횟수 증가 없이 `pending` 유지, provider를 offline 표시 (§4.3) |
| 11 | 질의 간 최소 간격 | 확장 설정, 기본 10초 (§6.2) |
| 12 | 프롬프트 조합 위치 | 서버가 조합해 `prompt`로 전달 (§4.2) |
| 13 | 확장 설치 방식 | 개발자 모드 압축해제 설치 (§6.1) |
| — | 같은 사이트 탭이 여러 개일 때 | 가장 최근 활성 탭 (§6.2) |
| — | 임대 시간 | 120초, progress/ping으로 연장 (§4.4) |

## 12. 기술 스택과 디렉터리 구조 (TypeScript) — 확정: 서버·확장 모두 TypeScript, `server/` `extension/` 이원화

### 12.1 원칙
- 저장소 루트에 **`server/`와 `extension/`** 두 개의 독립 프로젝트를 둔다. 각각 자체 `package.json`, `tsconfig.json`(strict), 테스트를 가지며 **각자 헥사고날 구조**를 따른다.
- 서버는 §2의 유스케이스/포트 구조를 TypeScript로 옮긴 것이다(도메인은 프레임워크·DB를 모른다).
- 확장은 **provider(사이트) 추가가 어댑터 1개 추가로 끝나는 구조**로 만든다. MVP는 Perplexity만 구현한다.
- Python 코드(`src/`, `tests/` 등)는 TypeScript 서버가 동등 기능에 도달할 때까지 참고용으로 남긴다(§12.5).

### 12.2 기술 스택 (제안, 미확인)
| 영역 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js 26 (개발 PC v26.10.0, 배포 서버 `m` v26.9.0 설치 확인) | 내장 fetch/WebSocket 클라이언트, 타입 스트리핑 |
| 서버 프레임워크 | Fastify + `@fastify/websocket` + `@fastify/static` | 경량, 스키마 검증, WebSocket/정적 파일 공식 플러그인 |
| 검증 | zod | 요청/WS 메시지 스키마를 런타임 검증과 타입으로 공용 |
| DB | Node 내장 `node:sqlite` (WAL) | 네이티브 빌드가 필요 없어 Windows·macOS 배포가 단순(Node 26에서 동작 확인). 동기 API라 원자적 claim 트랜잭션이 단순 |
| MCP | `@modelcontextprotocol/sdk` (공식 TS SDK) | SSE/HTTP 전송 지원 — §7 스파이크 5 해소 예상 |
| 서버 테스트 | vitest | |
| 확장 빌드 | esbuild (빌드 스크립트가 provider 레지스트리로 `manifest.json` 생성) | provider 추가 시 매니페스트 수동 수정 방지 |
| 확장 타입 | `@types/chrome`, jsdom 기반 vitest | 사이트 모듈은 저장한 HTML 픽스처로 테스트 |
| 웹 UI 프런트 (확정) | Svelte 5 + Vite SPA (SvelteKit 미사용). `server/web/`에서 정적 파일로 빌드해 Fastify가 서빙 | 상태가 자주 바뀌는 화면(SSE·폴링·탭)에 적합. 화면·디자인은 §13, 구현 방침은 §13.3 |
| 확장 UI (확정) | **순수 HTML/CSS + 소량의 TypeScript, 프레임워크 없음** | 화면이 팝업 1개·설정 페이지 1개로 작고 입력 항목이 적음. 자세한 내용은 §6.4 |

### 12.3 디렉터리 구조

```
query/
├── protocol.ts                        # 서버↔확장 WebSocket 메시지 타입 (§4.2). 타입만 포함, import 없음
├── server/
│   ├── src/
│   │   ├── domain/                    # 엔티티, 에러, 포트 (외부 의존 없음)
│   │   │   ├── entities.ts            # Query, QueryResult, ResultStatus
│   │   │   ├── errors.ts
│   │   │   └── ports.ts               # QueryRepositoryPort, AnswerFileStoragePort, SystemPromptConfigPort, PresencePort
│   │   ├── application/               # 유스케이스 (§5.1)
│   │   │   ├── submitQuery.ts  addProviderToQuery.ts  retryResult.ts  askQuery.ts
│   │   │   ├── getQuery.ts  manageSystemPrompt.ts  cleanupExpiredResults.ts
│   │   │   └── claimNextResult.ts  recordProgress.ts  completeResult.ts  failResult.ts  sweepLeases.ts
│   │   ├── adapters/
│   │   │   ├── inbound/
│   │   │   │   ├── rest/              # REST + SSE (PLAN §4)
│   │   │   │   ├── web/               # 웹 UI 페이지/정적 파일
│   │   │   │   ├── mcp/               # query_ask / query_status / query_providers
│   │   │   │   └── extension/         # WebSocket 핸들러(/ext/ws), schemas.ts (수신 메시지 zod 검증 — 루트 protocol.ts 타입과 일치하도록 작성)
│   │   │   └── outbound/
│   │   │       ├── sqlite/            # SqliteQueryRepository
│   │   │       ├── files/             # FileAnswerStorage, FileSystemPrompt
│   │   │       └── presence/          # InMemoryPresence (접속/provider 상태)
│   │   ├── config.ts                  # 환경변수 (§8)
│   │   ├── container.ts               # 의존성 조립
│   │   ├── background.ts              # 임대 회수·TTL 정리 주기 태스크 (§4.4)
│   │   └── main.ts                    # 진입점
│   ├── web/                           # 웹 UI 프런트: Svelte 5 + Vite (자체 package.json), 빌드 결과 web/dist를 서버가 서빙 (§13.3)
│   ├── test/
│   ├── package.json  tsconfig.json
├── extension/
│   ├── src/
│   │   ├── domain/                    # 서비스 워커/콘텐츠 스크립트가 공유하는 순수 모델
│   │   │   ├── model.ts               # Job, ProviderId, ProviderState, Answer
│   │   │   └── ports.ts               # SiteProviderPort, ServerGatewayPort, TabControllerPort, SettingsStorePort
│   │   ├── application/               # 서비스 워커에서 실행되는 유스케이스
│   │   │   ├── runJobLoop.ts          # claim → 처리 → 결과 전송, 순차 처리·최소 간격(§6.2)
│   │   │   ├── processJob.ts          # 사이트 provider 실행, progress 전달, 오류 코드 매핑(§4.3)
│   │   │   ├── reportProviderStates.ts# 탭/로그인 상태 감지·통지
│   │   │   └── toggleActive.ts  updateSettings.ts
│   │   ├── adapters/
│   │   │   ├── inbound/
│   │   │   │   ├── popup/             # 팝업: popup.html/css/ts (ON/OFF, 상태) — 프레임워크 없음 (§6.4)
│   │   │   │   ├── options/           # 설정 페이지: options.html/css/ts (서버 주소 등) — 프레임워크 없음 (§6.4)
│   │   │   │   └── background/        # 서비스 워커 진입점, chrome.* 이벤트 → 유스케이스
│   │   │   └── outbound/
│   │   │       ├── gateway/           # WebSocketServerGateway (§4.2 프로토콜)
│   │   │       ├── browser/           # ChromeTabController, ChromeStorageSettings
│   │   │       └── providers/         # 사이트별 어댑터 (SiteProviderPort 구현) — 확장 지점
│   │   │           ├── registry.ts    # provider 등록부: id, 호스트 패턴, 모듈
│   │   │           ├── common/        # 공통 유틸(대기, 안정화 감지, 입력 이벤트 주입)
│   │   │           └── perplexity/    # MVP. 향후 claude/ chatgpt/ gemini/ 추가
│   │   └── content/                   # 콘텐츠 스크립트 진입점(레지스트리에서 사이트별 번들 생성)
│   ├── scripts/build.ts               # esbuild + manifest.json 생성
│   ├── test/                          # 사이트 모듈 HTML 픽스처 테스트
│   ├── package.json  tsconfig.json
├── docs/
└── scripts/                           # 설치/배포 스크립트 (Node 기준으로 개정)
```

### 12.4 확장 헥사고날의 핵심: 두 실행 환경
- **서비스 워커(코어)**: `domain` + `application`이 실행된다. 서버 통신(`ServerGatewayPort`), 탭·저장소(`TabControllerPort`, `SettingsStorePort`)는 outbound 어댑터로 주입된다.
- **콘텐츠 스크립트(사이트 어댑터)**: DOM을 직접 다루므로 페이지 안에서 실행된다. 서비스 워커는 `SiteProviderPort`를 **메시징 프록시 어댑터**(`chrome.tabs.sendMessage`)로 호출하고, 콘텐츠 스크립트 쪽이 실제 사이트 모듈을 실행한다. 코어는 이 경계를 모른다.
- **provider 추가 절차**: (1) `providers/<site>/`에 `SiteProviderPort` 구현 추가 → (2) `providers/registry.ts`에 등록(id, 호스트 패턴). 빌드 스크립트가 `manifest.json`의 `host_permissions`/`content_scripts`를 레지스트리에서 생성하므로 코어·서버는 변경 없음. 서버 쪽은 지원 provider 목록(`ALL_PROVIDERS`)에 id를 추가한다.
- **프로토콜 타입 공유(확정: 저장소 루트 `protocol.ts` 단일 파일)**: §4.2의 메시지 타입(약 10여 개)을 **타입만** 담은 파일 하나로 루트에 둔다. 두 프로젝트가 상대 경로(`../protocol.ts`)로 `import type`한다. 제약: (1) 이 파일은 **외부 패키지를 import하지 않는다**(루트에는 `node_modules`가 없어 `zod` 등을 해석할 수 없음). 런타임 검증용 zod 스키마는 서버 `schemas.ts`에 두고 루트 타입과 맞물리게(`satisfies`) 작성한다. (2) 각 프로젝트의 `tsconfig`는 `include`에 `../protocol.ts`를 포함하고, 빌드는 esbuild 번들, `tsc`는 `--noEmit` 타입 검사로만 쓴다(`rootDir` 문제 회피).

### 12.5 Python 코드 처리와 전환 순서
- 이미 구현된 Python 서버(큐, SQLite 저장소, 유스케이스, REST/SSE/웹 UI, Gmail·Playwright 어댑터, 테스트 26개)는 TypeScript 서버 이식의 **참조 구현**이다. 동작 규칙(원자적 claim, 우선순위, 재시도, KST 표시 등)은 테스트를 그대로 TypeScript 테스트로 옮겨 동등성을 확인한다.
- 이식 순서: 도메인/포트 → SQLite 저장소 → 유스케이스 → REST/SSE → 웹 UI 정적 파일 → 확장 WebSocket 어댑터·임대·정리 → MCP.
- 동등 기능 확인 후 Python 관련 파일(`src/`, `tests/`, `pyproject.toml`, `requirements.txt`, `scripts/*.py`, `.venv`)을 제거한다.
- 배포 스크립트(`setup-env.sh`, `install-systemd.sh`)는 Node 기준(`npm ci`, `node dist/main.js`)으로 개정한다. 배포 서버(`m`)에는 Node.js 26이 설치되어 있다.

## 13. 웹 UI 명세 (PLAN.md §5에서 이전, 확장 방식 반영)

모든 화면은 reverse proxy basePath `/query` 하위에서 서빙된다 (예: 메인 화면 `/query/`, 상세 화면 `/query/queries/{query_id}`). 아래 URL은 앱 내부 라우팅 기준이며, 실제 접속 URL은 `/query`가 앞에 붙는다.

### 13.0 디자인 가이드라인

- 아이콘은 **Lucide** 아이콘 셋을 사용한다.
- **심플한 디자인**을 유지한다. 불필요한 장식/그림자/그라데이션을 지양한다.
- 제목이나 각 항목 레이블 아래에 **부연설명용 작은 글씨(caption/helper text)를 절대 넣지 않는다.** 레이블 자체로 의미가 전달되도록 문구를 정한다.

**구현된 스타일 기준(기존 Python 서버 UI에서 확정된 값, 이식 시 유지)**
- 밝은 배경/어두운 배경을 **시스템 설정(prefers-color-scheme)에 따라 자동 전환**한다. 색은 CSS 변수로 정의한다.
- 상태 색: `pending` 회색, `processing` 주황(스피너 아이콘 동반), `done` 초록, `failed` 빨강. 상태는 테두리+글자색의 알약(pill) 뱃지로 표시한다.
- 본문 최대 폭 960px, 시스템 폰트, 패널은 얇은 테두리와 8px 라운드(그림자 없음).
- 텍스트 입력은 textarea, 주요 동작 버튼(질의하기)만 강조색으로 채운다.
- 아이콘/마크다운 렌더링 라이브러리(Lucide, marked, DOMPurify)는 CDN이 아닌 **정적 파일로 함께 서빙**한다. 답변 마크다운은 sanitize 후 렌더링하고, 출처 링크는 `http(s)`만 허용한다.

### 13.1 메인 화면 (`/`)

#### 상단 상태
- 확장 연결 상태 뱃지(연결됨/끊김)와 provider별 online 여부(`GET /extension/status`, §5.3). 뱃지 외의 설명 문구는 넣지 않는다.

#### 답변 작성 지침 영역
- 현재 `user/config/system_prompt.md` 내용을 표시하는 textarea + "저장" 버튼
- 저장 시 `PUT /config/system-prompt` 호출. 이후 claim되는 질의부터 새 프롬프트 적용
- 접힘/펼침(collapsible) 가능하게 하여 평소엔 목록이 우선 보이게 구성

#### 질문 입력 영역
- 입력 모드 토글: **개별 입력** / **벌크 입력**
  - 개별 입력: textarea 1개 + "질의하기" 버튼 → `POST /queries`
  - 벌크 입력: textarea에 줄바꿈으로 구분된 여러 질문 입력 + "일괄 질의하기" 버튼 → 줄 단위로 분리 후 `POST /queries/bulk`
- **Provider 선택**: `GET /providers` 결과로 체크박스 목록 표시(기본: Perplexity 체크됨). `available=false`(지원하지 않는 provider)는 비활성 표시("준비 중"). `online`이 아니어도 등록은 허용한다.
- 성공 시 "질의가 접수되었습니다(N건 × M provider)" 토스트 표시 후 목록 갱신
- **중복 제출 방지**: 요청이 서버에 도달해 응답을 받을 때까지 "질의하기"/"일괄 질의하기" 버튼을 비활성화한다(더블클릭/연타로 동일 질문이 중복 등록되는 것을 막기 위함).

#### 질의 목록

| Query ID | Batch | 질문(일부) | Provider별 상태 | 등록일시 |
|---|---|---|---|---|
| q_abc123 | - | 원자력 인허가 절차 요약... | Perplexity: done | 2026-09-25 19:00 |
| q_abc124 | b_xyz789 | 345kV 변전소 소내부하... | Perplexity: pending · Claude: done · Gemini: failed | 2026-09-25 19:05 |

- "Provider별 상태" 칸은 요청한 provider마다 뱃지를 나열한다 (`pending`/`processing`/`done`/`failed`, provider별 구분). provider가 1개면 뱃지 1개만 표시된다.
- 행 클릭 → 상세 화면 이동
- 목록 하단에 **"더 보기" 버튼**: `GET /queries`의 `next_cursor`가 있으면 노출, 클릭 시 `cursor` 파라미터로 다음 페이지를 이어붙인다. `next_cursor`가 없으면 버튼 자체를 숨긴다.
- 등록된 질의가 없을 때는 목록 영역에 "등록된 질의가 없습니다" 한 줄만 표시한다(별도 일러스트/부연설명 없음, §13.0 준수).
- 보이는 목록의 상태는 5초마다 갱신한다(탭이 숨겨져 있을 때는 중단).
- 좁은 화면(모바일)에서는 표를 행 단위 블록으로 재배치한다.

### 13.2 상세 화면 (`/queries/{query_id}`)

- 상단: Query ID, 등록일시, 질문 전체 텍스트
- 하단: **provider별 탭**. 탭 목록은 `GET /providers`(§5.3)의 전체 provider 집합을 기준으로 구성하며, 탭은 두 종류로 나뉜다.
  - **이미 질의한 provider 탭**: 탭 라벨에 상태 뱃지 표시(`pending`/`processing`/`done`/`failed`). 클릭하면 해당 탭 패널로 전환한다.
  - **아직 질의하지 않은 provider 탭**: 탭 라벨을 옅게(비활성 톤) 표시하고 별도의 상태 뱃지는 없다. **클릭하는 순간 `POST /queries/{query_id}/providers`(PLAN §4.5)로 해당 provider에 질의를 시작**하고, 탭은 즉시 "대기 중" 상태로 전환된다. `available=false`인 provider는 클릭 불가로 표시한다.
- 진입 시 `GET /queries/{query_id}/stream`(SSE, PLAN §4.11)을 구독하여 탭들을 실시간 갱신:
  - `pending`: "대기 중" 표시 (확장이 오프라인이어도 정상 상태)
  - `processing`: 스피너 + `progress_message` 텍스트 실시간 표시 (예: "질의 전송 중" → "답변 대기 중" → "답변 추출 중")
  - `done`: 답변 텍스트(마크다운 렌더링), 출처(citations) 목록, 복사 버튼
  - `failed`: 에러 메시지 + **"다시 시도" 버튼**. 클릭 시 `POST /queries/{query_id}/results/{result_id}/retry`(PLAN §4.12) 호출 → 탭 상태를 `pending`으로 즉시 갱신하고 SSE로 이어서 진행 상황을 받는다.
  - SSE `result_added` 이벤트 수신 시 해당 provider 탭이 "질의하지 않음" → "대기 중"으로 전환된다(다른 브라우저 탭/기기에서 provider 추가를 호출한 경우에도 동일하게 반영됨).
- 여러 provider가 동시에 처리 중일 수 있으므로 스트림은 자동으로 닫히지 않는다. 화면을 벗어나면 연결을 닫는다.
- 탭 바는 넓은 화면에서는 가로 나열, 좁은 화면(모바일)에서는 가로 스크롤되는 탭 바로 표시한다.
- SSE 연결 실패/미지원 브라우저 대비 폴백: 5초 간격 `GET /queries/{query_id}` 폴링
- `pending`/`processing` 상태의 개별 결과에는 취소 버튼을 두지 않는다.

### 13.3 프런트 구현 방침 (확정)
- **Svelte 5 + Vite SPA**로 `server/web/`에 구현하고 빌드 결과(`server/web/dist`)를 Fastify가 정적 서빙한다. SvelteKit(서버 렌더링)은 사용하지 않는다.
- **basePath**: 서버가 `index.html`을 내려줄 때 basePath를 주입하고, 앱은 그 값을 API·SSE·라우팅 접두사로 쓴다. `/queries/{query_id}` 직접 접속 시 서버가 같은 `index.html`을 내려준다(SPA 폴백).
- **컴포넌트**: `SystemPromptPanel`, `QueryForm`(개별/벌크 토글, provider 체크박스), `QueryList`(더 보기), `ExtensionStatusBadge`, `QueryDetail`(`ProviderTabs`, `ResultPanel`). 화면은 §13.1, §13.2와 1:1로 대응한다.
- **라이브러리**: Lucide Svelte 패키지, `marked` + `DOMPurify`(모두 번들에 포함, CDN 없음). 답변 마크다운은 sanitize 후 렌더링하고 출처 링크는 `http(s)`만 허용한다.
- **개발**: Vite 개발 서버를 서버 API로 프록시한다. 기존 바닐라 JS 구현은 이식 기준으로만 참고한다.
- **테스트**: vitest + Testing Library로 컴포넌트를 검증하고, 화면은 브라우저로 직접 확인한다.

## 14. 구현 현황 (2026-09-26)

### 14.1 완료
| 영역 | 내용 | 검증 |
|---|---|---|
| `server/` | 도메인/포트, `node:sqlite` 저장소(WAL, 원자적 claim, 우선순위, 재시도 backoff, 임대), 유스케이스 전체(§5.1), REST + SSE, 확장 WebSocket 허브(§4), 임대 회수·TTL 정리·wake 백그라운드 태스크, MCP(SSE + Streamable HTTP), 정적 웹 UI 서빙(basePath 주입) | vitest 57개, 프로덕션 번들(`server/dist/main.js`)을 다른 작업 디렉터리에서 실행 확인 |
| `server/web/` | Svelte 5 + Vite SPA(§13): 메인/상세 화면, 벌크 입력, provider 탭, SSE + 폴링 폴백, 확장 상태 뱃지, 마크다운 sanitize | svelte-check, vitest 6개, 헤드리스 Chromium e2e |
| `extension/` | 헥사고날 코어(claim 루프·순차 처리·최소 간격·상태 감지), WebSocket 게이트웨이(재연결·ping), 탭 제어, 콘텐츠 스크립트 런타임, Perplexity 사이트 모듈(셀렉터는 추정, §14.3), 팝업/설정 페이지(순수 HTML/CSS/TS), manifest 자동 생성 빌드 | vitest 48개, **Chromium에 확장을 로드한 전체 e2e**(모의 Perplexity 페이지 대상: 설정→연결 테스트→ON→질의 처리→결과 저장→`/ask` 동기 처리→탭 닫힘 감지→OFF) |
| 정리 | Python 서버·Gmail OAuth·Playwright 코드 제거(git 이력에 남음), 스크립트를 Node 기준으로 개정(`setup-env.sh`, `install-systemd.sh`, 신규 `install-launchd.sh`), `.env.example` 갱신 | 스크립트 문법 검사(`bash -n`)만 수행 — 실제 서비스 등록은 미검증 |

### 14.2 계획 대비 변경
- **DB**: better-sqlite3 대신 Node 내장 `node:sqlite`(§12.2에 반영).
- **MCP**: SSE 외에 Streamable HTTP(`POST /mcp`)를 함께 제공한다(SSE 전송이 SDK에서 deprecated).
- **확장 권한**: `storage`, `alarms`, `scripting`과 provider 사이트 호스트 권한만 사용한다(`tabs` 권한, 서버 주소용 호스트 권한 불필요).
- **연결 테스트**: 핸드셰이크만 확인하면 인증 실패(연결 후 4401)를 놓치므로 ping→pong까지 확인한다(§6.4).
- **시각 정렬**: 같은 밀리초에 등록된 항목의 FIFO/페이지네이션 순서를 위해 프로세스 내 단조 증가 시각(`monotonicNow`)과 삽입 순서(rowid)를 tie-breaker로 쓴다.
- **배포 서버 `m`은 macOS**라 systemd 대신 launchd 스크립트를 추가했다.

### 14.3 남은 일
1. **Perplexity 셀렉터 확정(스파이크, §7)**: 입력창(`#ask-input`)과 로그인 판별은 관찰로 확인했으나, 전송 버튼·생성 중 표시(중지 버튼)·답변 본문·출처 셀렉터는 추정값이다(`extension/src/adapters/outbound/providers/perplexity/selectors.ts`에 확인됨/추정 구분 표기). 확장을 실제 Perplexity 탭에서 돌리면 `selector_missing` 오류가 어떤 셀렉터인지 메시지로 알려 주고, 콘솔 스니펫(홈/생성 중/완료 3상태) 결과로 확정한다. 입력창 주입(`execCommand`/paste)이 실제 에디터에서 인식되는지, 화면에 안 보이는 탭에서 답변 감지가 동작하는지도 이때 확인한다.
2. 실제 서비스 등록 검증(`m`에서 `setup-env.sh` → `install-launchd.sh`), 사설망(WireGuard) 경유 확장 접속.
3. ~~확장 아이콘~~ — 완료(2026-09-26): `extension/scripts/make-icons.mjs`로 생성한 `static/icons/*.png`, 빌드가 manifest에 등록.
4. 토큰 인증: 확장 WebSocket은 `AUTH_TOKEN`으로 동작하며, REST/웹 UI 토큰은 향후(§4.1).
5. Claude/ChatGPT/Gemini 사이트 모듈(확장 `providers/`에 추가, §12.4).

### 14.4 실행 방법
- 설치/빌드: `npm run setup` (= `scripts/setup-env.sh`)
- 개발 서버: `npm run dev` (http://127.0.0.1:8000), 웹 UI 개발은 `npm --prefix server/web run dev`
- 전체 테스트: `npm test`, 타입 검사: `npm run typecheck`
- 확장 설치: `extension/dist`를 브라우저의 "압축해제된 확장 로드"로 등록 → 설정 페이지에서 서버 주소 입력 → 팝업에서 ON
