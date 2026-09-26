# Query

여러 질문을 웹서버에 쌓아 두면, **로그인된 브라우저의 확장 프로그램**이 대상 사이트(Perplexity, Claude, ChatGPT, Gemini)에서 질의하고 결과(답변 + 출처)를 서버로 돌려주는 시스템이다.

## 왜 브라우저 확장인가

봇 검증(Cloudflare Turnstile)이 있는 사이트는 자동화 브라우저(Playwright 등)를 막고, 로그인 자동화는 이메일 인증번호까지 필요하며 사이트 정책·UI 변경에 취약하다. 사용자가 **이미 로그인해 둔 실제 브라우저 안**에서 동작하면 이 문제가 모두 사라진다.

- 서버는 큐·저장·API·웹 UI·MCP를 맡는다. 질의 등록은 확장 상태와 무관하게 **언제나 가능**하고 서버에 쌓인다.
- 확장은 서버가 밀어 넣는 것이 아니라 **서버에서 일감을 가져간다(pull)**. 서버로 나가는 WebSocket 하나만 쓰므로 확장이 있는 PC에 열어야 할 포트가 없다.
- 처리는 **브라우저가 켜져 있고 확장이 ON이며 해당 사이트에 로그인된 탭이 있을 때만** 진행된다. 큐는 24시간 동작하지만 무인 처리는 목표가 아니다.

## 구조

```
 웹 UI(Svelte) ─┐
 REST API      ─┼─▶  서버 (Node 26, Fastify, SQLite)  ◀─ WebSocket(pull) ─  브라우저 확장 (MV3)
 MCP           ─┘     큐 · 저장 · 임대 · 답변 파일          claim ⇄ job/result       사이트별 콘텐츠 스크립트
                                                                                        │
                                                            Perplexity · Claude · ChatGPT · Gemini 탭
```

| 경로 | 내용 |
|---|---|
| `server/` | REST API, SSE, MCP, 확장 WebSocket 허브, SQLite 저장소(`node:sqlite`, WAL), 정적 웹 UI 서빙 (Node 26, TypeScript, 헥사고날) |
| `server/web/` | 웹 UI (Svelte 5 + Vite). 빌드 결과를 서버가 서빙한다 |
| `extension/` | 브라우저 확장 (Manifest V3, TypeScript, 헥사고날). 코어는 서비스 워커, 사이트 어댑터는 콘텐츠 스크립트에서 실행 |
| `protocol.ts` | 서버 ↔ 확장 메시지 타입(서버와 확장이 공유) |
| `docs/providers/` | **사이트 UI가 바뀌었을 때** 셀렉터를 다시 확정하는 검증 절차·도구·사이트별 지식 |
| `docs/DESIGN.md` | 웹 UI 디자인 가이드 |
| `scripts/` | 설치·배포 스크립트 (`setup`, systemd user 유닛, launchd) |
| `user/` | 데이터(DB, 답변, 프롬프트, 로그). git에 올리지 않는다 |

## 동작 방식

1. 사용자가 질문을 등록한다(웹 UI, REST, MCP). 질문 1건은 요청한 **provider 수만큼의 결과(result)** 를 갖고 각각 `pending`으로 시작한다. 기본 provider는 Perplexity 하나다.
2. 확장이 서버에 접속해 `hello`로 **처리 가능한 provider**를 알린다: 사이트 탭이 열려 있고 로그인돼 있으면 `ready`, 로그아웃이면 `login_required`, 탭이 없으면 `no_tab`.
3. 놀고 있는 확장이 `claim(provider)`을 보내면 서버가 우선순위·등록 순으로 결과 하나를 원자적으로 배정하고 `job`(입력문, 임대 시간)을 준다. 일감이 없으면 `idle`, 새 일감이 생기면 `wake`를 보낸다.
4. 확장은 해당 사이트 탭에서 **새 대화로 질문을 입력·전송하고, 답변 완료를 감지해, 본문(마크다운)과 출처를 추출**해 `result`로 돌려준다. 실패하면 `error`(코드 포함).
5. 서버는 결과를 저장하고(`done`) 답변을 `user/answers/`에 마크다운 파일로도 남긴다.

**규칙**
- 확장은 **한 번에 하나**의 작업만 처리한다. 질의 사이에는 최소 간격(기본 10초)을 둔다.
- 여러 브라우저(확장)가 접속하면 provider별 **round-robin**으로 나눠 준다. 한 결과는 한 클라이언트만 가져간다.
- **임대(lease)**: 배정된 작업은 `LEASE_SECONDS`(기본 120초) 안에 진행 보고(`progress`)나 핑이 없으면 회수되어 실패 1회로 재시도 정책을 적용받는다. WebSocket이 끊기면 그 클라이언트의 임대는 즉시 만료된다. 서버 시작 시 남은 `processing`은 횟수 증가 없이 `pending`으로 복구한다.
- **입력문**: `{질문}\n\n---\n\n{답변작성 지침}` (지침이 비면 질문만). 서버가 조합해 `job.prompt`로 준다.
- **오류 코드와 서버 처리**

| 코드 | 의미 | 서버 처리 |
|---|---|---|
| `login_required` | 사이트에 로그인되어 있지 않음 | 재시도 횟수를 늘리지 않고 `pending` 유지, provider를 offline 표시. 로그인하면 자동으로 다시 처리 |
| `timeout` | 답변 완료를 시간 내 감지하지 못함 | 재시도(횟수 증가, backoff). `MAX_RETRY` 초과 시 `failed` |
| `selector_missing` | 화면 구조가 달라 요소를 못 찾음 | 위와 동일. `failed`이면 `error_message`에 셀렉터 이름이 남는다 |
| `retryable` | 그 외 일시적 오류 | 위와 동일 |

결과 상태는 `pending → processing → done | failed`이다. 완료/실패 후 `RETENTION_DAYS`(기본 7일)가 지난 결과와 답변 파일은 정리된다.

## 지원 provider

| provider | 사이트 | 검증 문서 |
|---|---|---|
| `perplexity` | www.perplexity.ai | [docs/providers/perplexity.md](docs/providers/perplexity.md) |
| `claude` | claude.ai | [docs/providers/claude.md](docs/providers/claude.md) |
| `chatgpt` | chatgpt.com | [docs/providers/chatgpt.md](docs/providers/chatgpt.md) |
| `gemini` | gemini.google.com | [docs/providers/gemini.md](docs/providers/gemini.md) |

사이트별 셀렉터는 `extension/src/adapters/outbound/providers/<id>/selectors.ts` 한 파일에 모여 있고, **캡처로 확인한 값(`[확인됨]`)과 추정값(`[추정]`)을 주석으로 구분**한다. 사이트 UI는 예고 없이 바뀌므로 정기적으로 [docs/providers/README.md](docs/providers/README.md)의 절차(`smoke`)로 점검한다.

## 시작하기

Node.js **26 이상**이 필요하다.

```bash
npm run setup      # 의존성 설치, 빌드, user/ 와 .env 준비
npm run dev        # 서버 실행: http://127.0.0.1:4444
npm test           # 전체 테스트 (server, server/web, extension)
npm run typecheck  # 타입 검사
npm run build      # 웹 UI + 서버 + 확장 빌드
```

**확장 설치**: 브라우저(Chrome/Vivaldi 등)의 확장 관리 → 개발자 모드 → "압축해제된 확장 로드" → `extension/dist`. 확장의 **설정 페이지**에서 서버 주소(기본값이 없으므로 직접 입력, 예: `http://127.0.0.1:4444`)와, 서버에 `API_TOKEN`을 설정했다면 토큰을 입력하고 "연결 테스트"를 확인한 뒤, **처리할 사이트를 로그인된 탭으로 열어 둔 채** 팝업에서 ON으로 켠다. 확장 코드를 다시 빌드했으면 확장 관리 화면에서 새로고침한다.

## 웹 UI

`http://<서버>:4444/`

- 상단 헤더: 확장 상태 배지(끊김 / 대기 / 연결됨), Queue·답변 수, 벌크 입력, 답변작성 지침 관리, 테마(자동/라이트/다크).
- 쿼리 바: **카테고리 드롭다운 → 질문 → provider 칩 → 질의하기**. provider 칩의 점(●)은 그 provider를 처리할 수 있는 확장이 있는지(online)를 뜻한다. online이 아니어도 등록은 되고 대기한다.
- 좌측 **질의 목록**(검색·상태 필터·미리보기·삭제), 우측 **답변**(질문 전문, provider 탭, 마크다운 렌더링, 출처 카드, 복사·다운로드·삭제·다시 시도). 실시간 갱신은 SSE, 토큰을 쓰면 폴링이다.
- 삭제: 질의 전체 또는 provider 결과 하나를 지운다(처리 중인 결과가 있으면 불가). 두 번 눌러 확정한다.
- 디자인 규칙은 [docs/DESIGN.md](docs/DESIGN.md).

## API

모든 REST 경로는 `<BASE_PATH>/api/v1` 아래에 있다. 응답은 JSON, 오류는 공통 포맷 `{ "error": { "code", "message" } }`이다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/queries` | 질문 등록 `{ query, providers?, category? }` → `query_id` |
| `POST` | `/queries/bulk` | 여러 질문 일괄 등록 `{ queries[], providers?, category? }` (최대 100개) |
| `POST` | `/queries/{id}/providers` | 이미 등록한 질문에 provider 추가 `{ providers }` (멱등) |
| `POST` | `/ask?timeout_seconds=` | **동기 질의**: 등록 후 완료/타임아웃까지 대기해 반환. 높은 우선순위. 확장이 오프라인이면 기다리지 않고 `pending` + 안내를 즉시 반환 |
| `GET` | `/queries` | 목록 `?status&category&search&batch_id&limit&cursor` (미리보기 포함) |
| `GET` | `/queries/{id}` | 상세(결과별 상태·답변·출처·오류) |
| `GET` | `/queries/{id}/stream` | SSE로 결과 갱신 수신 |
| `POST` | `/queries/{id}/results/{result_id}/retry` | 실패한 결과 다시 시도 |
| `DELETE` | `/queries/{id}` · `/queries/{id}/results/{result_id}` | 질의 전체 / 결과 하나 삭제(처리 중이면 409) |
| `GET` | `/queries/{id}/results/{result_id}/download` | 저장된 답변 마크다운 내려받기 |
| `GET` | `/providers` | provider 목록: `id, name, available(서버 지원), online(처리 가능한 확장 있음)` |
| `GET` | `/extension/status` | 확장 접속 수, provider별 상태 |
| `GET` | `/stats` · `/categories` | 집계 / 카테고리 목록 |
| `GET` `PUT` `DELETE` | `/prompts/{category}` | 카테고리별 답변작성 지침 (`/config/system-prompt`는 `general`을 가리키는 하위 호환 경로) |

**MCP** (`@modelcontextprotocol/sdk`): Streamable HTTP `POST /mcp`(stateless), SSE `GET /mcp/sse` + `POST /mcp/messages`. 도구 3개는 REST와 같은 유스케이스를 쓴다.

| 도구 | 설명 |
|---|---|
| `query_ask` | 질문을 보내고 답변이 나올 때까지 기다려 반환(`/ask`와 동일). `providers`, `category`, `timeout_seconds` |
| `query_status` | 질의/결과 상태 조회 |
| `query_providers` | provider 목록 |

## 카테고리와 답변작성 지침

- 질문마다 `category`를 갖는다(기본 `general`). 이름은 글자(한글 포함)·숫자·`-`·`_`, 32자 이내이고 **소문자로 통일**된다. 파일명으로 쓰이므로 `.`, `/`, `\`, 공백과 Windows 예약어는 거절한다.
- 답변작성 지침은 `user/prompts/<category>.md`에 두고 웹 UI(지침 관리)나 API로 편집한다. 작업을 가져가는 시점에 적용한다: 카테고리 파일이 있으면 그것, 없으면 `general.md`, 그것도 없으면 지침 없이 질문만 보낸다. 실제 적용된 내용은 결과에 스냅샷으로 남고 답변 파일의 `## 답변작성 지침`에도 기록된다.
- 웹에는 별도 입력란이 없으므로 모든 provider에 위 결합 포맷을 **첫 메시지**로 보낸다.

## 데이터 (`user/`)

```
user/
├── database/   query.db (+ -wal, -shm)         SQLite
├── prompts/    general.md, <category>.md        카테고리별 답변작성 지침
├── answers/    yyMMdd_{id}_{provider}.md       질문·답변 마크다운 (id는 q_ 접두사 제외)
├── logs/       server.log 등
├── browser-profile/  verify/                   (검증 도구용) 로그인 프로필, 캡처·리포트
```

답변 파일의 이름은 `yyMMdd_{query_id}_{provider}.md`이고 끝에 category 등 메타데이터가 붙는다.

## 설정 (환경변수, `.env`)

`.env.example`을 복사해 쓰며 값을 비우거나 줄을 지우면 기본값이 적용된다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `QUERY_HOST` / `QUERY_PORT` | `127.0.0.1` / `4444` | 바인드 주소. loopback이 아니면 `API_TOKEN` 필수 |
| `BASE_PATH` | (빈 값) | reverse proxy 접두사(예: `/query`). 프록시가 접두사를 제거해 전달하는 것을 전제로 링크 생성에만 쓴다 |
| `DEFAULT_PROVIDERS` | `["perplexity"]` | provider 미지정 시 기본값 |
| `MAX_RETRY` / `RETRY_BACKOFF_SECONDS` | `2` / `30` | 최초 1회 + 재시도 횟수, 재시도 대기 |
| `LEASE_SECONDS` / `LEASE_SWEEP_INTERVAL_SECONDS` | `120` / `10` | 작업 임대 시간 / 만료 회수 주기 |
| `DB_PATH` / `PROMPTS_DIR` / `ANSWERS_DIR` | `user/database/query.db` / `user/prompts` / `user/answers` | 저장 위치 |
| `RETENTION_DAYS` / `CLEANUP_INTERVAL_HOURS` | `7` / `24` | 완료·실패 결과 보관 기간 / 정리 주기 |
| `MAX_QUERY_LENGTH` | `4000` | 질문 길이 상한 |
| `ASK_DEFAULT_TIMEOUT_SECONDS` / `ASK_MAX_TIMEOUT_SECONDS` | `60` / `300` | 동기 질의 대기 시간 |
| `DISPLAY_TIMEZONE` | `Asia/Seoul` | 표시용 시간대 |
| `API_TOKEN` | (빈 값) | 쉼표로 여러 개. 설정하면 REST·MCP는 `Authorization: Bearer`, 확장 WebSocket은 `?token=` 필수. 웹 UI는 401을 받으면 토큰을 물어 이 브라우저에 저장 |
| `ALLOWED_ORIGINS` | (빈 값) | 허용할 브라우저 Origin. 비우면 요청 Host와 같은 출처와 브라우저 확장만 허용 |
| `MAX_BODY_BYTES` / `RATE_LIMIT_PER_MINUTE` | `262144` / `300` | 본문 크기 / 분당 요청 상한 |
| `TRUST_PROXY` | `false` | reverse proxy 뒤에서 `X-Forwarded-For` 신뢰 |

## 보안

- 확장용 WebSocket과 REST는 기본이 **무인증**이다. `QUERY_HOST`를 loopback 밖으로 열면 서버가 `API_TOKEN` 없이는 시작하지 않는다. 공개망에 노출하지 말고 사설망(WireGuard 등)이나 방화벽 뒤에 둔다.
- 입력은 스키마로 검증하고(알 수 없는 필드 거부, 길이·개수 상한), 카테고리 이름은 경로 이탈을 막도록 제한한다. 웹 UI는 답변 마크다운을 sanitize해서 렌더링한다.
- 확장은 `storage`, `alarms`, `scripting` 권한과 지원 사이트 호스트 권한만 쓴다.
- 자동 질의로 인한 계정 제한, 약관 준수는 사용자 책임이다. 질의 사이 최소 간격을 두고 로그인/추가 인증 화면은 자동으로 처리하지 않고 `login_required`로 보고한다.

## 배포

`main`에 push하면 GitHub Actions(`.github/workflows/deploy.yml`)가 WireGuard로 대상 서버(기본 `192.168.1.4`)에 접속해 `git merge --ff-only`로 해당 커밋을 받고, 빌드(`BUILD_CMD`)를 실행한 뒤 서비스를 재시작한다.

- 서버 등록: Linux는 `scripts/install-systemd-user.sh`(systemd **user** 유닛, `loginctl enable-linger` 필요), macOS는 `scripts/install-launchd.sh`(LaunchAgent). 설치 전에 `npm run setup`으로 빌드와 `.env`를 준비한다. (`install-systemd.sh`는 root용 시스템 유닛)
- Actions 설정: Secrets `WG_CONFIG`, `SSH_KEY`, Variables `HOST`, `USER`(필수), `SERVICE`, `BUILD_CMD`, `DEPLOY_ROOT`(선택).
- **서버는 단일 프로세스로만 실행한다.** 확장 접속 상태를 메모리에 두기 때문이다.
- **웹 UI나 서버를 다시 빌드하면 서버를 재시작해야 반영된다.** 서버가 정적 파일 목록을 시작할 때 한 번만 읽기 때문에, 재시작 없이는 새 빌드의 파일이 404가 된다.
- reverse proxy 뒤에 둘 때는 확장 WebSocket 경로(`/ext/ws`, `BASE_PATH` 포함)의 `Upgrade`/`Connection` 헤더를 전달해야 한다.

## 개발

- 구조는 헥사고날이다: `domain`(엔티티·포트) ← `application`(유스케이스) ← `adapters`(inbound: REST/MCP/WebSocket, outbound: SQLite/파일/사이트). 서버와 확장 모두 같은 구조이며 provider 추가는 어댑터 하나를 더하는 것으로 끝난다.
- 테스트: 서버(vitest, 임시 DB), 웹(vitest + Testing Library), 확장(vitest + jsdom, 사이트 모듈은 실제 DOM 구조를 흉내낸 HTML 픽스처). `npm test`가 셋을 모두 돌린다.
- **provider 추가 / 사이트 UI 변경 대응**: [docs/providers/README.md](docs/providers/README.md). 로그인된 실제 Chrome에 붙어 사이트 모듈을 실제 DOM에서 실행하는 `harness.py smoke`와, DOM 캡처(`probe`), 신호 추적(`trace`)으로 원인을 좁혀 `selectors.ts`를 고치고 회귀 테스트를 추가한 뒤 provider 문서의 변경 이력에 남긴다.
- 확장 provider 추가 절차(요약): `providers/<id>/`에 `selectors.ts` + `<id>Site.ts`, `content/<id>.ts`, `providers/registry.ts` 항목(빌드가 `manifest.json`을 자동 생성), 서버 `config.ts`의 `supportedProviders`와 `container.ts`의 표시 이름.
- 서버 ↔ 확장 메시지 타입은 `protocol.ts` 한 파일에서 공유한다.

## 알려진 제약

- 브라우저가 꺼져 있거나 확장이 OFF이면 처리되지 않고 큐에 쌓인다(무인 24시간 처리는 목표 아님).
- 확장이 처리하는 탭은 전용 탭으로 쓰는 것이 좋다. 처리 중에 사용자가 같은 탭을 쓰면 충돌할 수 있다.
- Gemini는 출처 칩으로만 표시된 출처의 URL을 수집하지 못한다(본문 링크만 수집). Claude는 도구를 쓴 답변에서 진행 문구까지 이어 붙여 저장한다. 사이트별 한계와 알려진 실패 모드는 `docs/providers/<id>.md`에 있다.
- 사이트 UI가 바뀌면 `selector_missing`이나 `timeout`이 늘어난다. 이때 위 검증 절차로 셀렉터를 다시 확정한다.
