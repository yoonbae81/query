# 아키텍처

Query의 구성과 질의 처리 흐름을 설명한다. 설치 방법은 [README](../README.md)를, 디자인은 [DESIGN.md](DESIGN.md)를 참고.

```
웹 UI · MCP ──질의──▶ 서버(대기열) ──WebSocket──▶ 확장(Extension)
                                        │  로그인된 탭에 입력 후 완성된 답변을 회수
                                        ◀──────────────┘
답변은 SQLite와 마크다운 파일로 남고, 웹 UI에서 provider별 탭으로 나란히 비교할 수 있다.
```

## 구성 요소

| 구성 | 역할 |
|---|---|
| `server/` | Fastify 서버. REST API(`/api/v1`), MCP, 확장 WebSocket(`/ext/ws`), 웹 UI 정적 서빙. 저장소는 내장 SQLite(`node:sqlite`, WAL) |
| `server/web/` | Svelte 5 SPA. 빌드 결과를 서버가 서빙하며, SSE로 진행 상태를 실시간 갱신한다 |
| `extension/` | Chrome Manifest V3 확장. 서비스 워커가 서버에 WebSocket으로 접속해 작업을 가져오고, 콘텐츠 스크립트가 provider 사이트 페이지를 조작한다 |
| `protocol.ts` | 서버↔확장 메시지 타입(공용). 양쪽에서 같은 정의를 쓴다 |
| `user/` | 런타임 데이터: DB(`database/query.db`), 답변 파일(`answers/`), 카테고리 프롬프트(`prompts/`) |

서버는 헥사고날 구조로, 인바운드 어댑터(REST/MCP/WS/웹) → 유스케이스(claim, complete, fail 등) → 아웃바운드 어댑터(SQLite/파일/presence) 방향으로만 의존한다.

## 질의 처리 흐름

1. **등록** — 웹 UI 또는 MCP에서 질의하면 서버가 `queries` 1행과 provider별 `query_results`(pending)를 만든다.
2. **할당** — 확장이 접속하면 `hello`(지원 provider·상태)를 보내고, 준비된 provider에 대해 `claim`을 요청한다. 서버는 대기 중인 작업을 임대(lease)와 함께 할당한다(`job`: 프롬프트, 임대 시간).
3. **질의** — 확장이 로그인된 탭에 프롬프트를 입력하고, 전송 버튼·스트리밍 표시 등 완료 신호를 기다린 뒤 본문과 출처를 추출한다.
4. **회수** — 확장은 `progress`(진행 메시지)와 `result`(답변) 또는 `error`를 보낸다. 서버는 상태를 갱신하고 답변을 마크다운 파일로 저장한 뒤, 웹 UI에 SSE 이벤트를 보낸다.

## 작업 분배와 임대(lease)

- **round-robin**: 같은 provider에 확장이 여러 개 접속해 있으면 서버가 순번을 돌아가며 할당한다. 한 확장은 한 번에 하나의 작업만 가져간다(순차 처리).
- **임대 회수**: 작업을 받은 확장은 `ping`/`progress`로 임대를 연장해야 한다(`LEASE_SECONDS`, 기본 120초). 연장이 없으면 주기 점검(`sweepLeases`)이 작업을 회수해 다시 대기열에 넣고, `MAX_RETRY`까지 재시도한다(백오프 `RETRY_BACKOFF_SECONDS`).
- **로그인 필요** 등 재현 가능한 실패는 해당 provider 상태를 `login_required`로 표시해, 다른 확장이 같은 작업을 시도하지 않게 한다.

## 데이터와 보존

- 답변은 `user/answers/yyMMdd_<query_id>_<provider>.md` 마크다운 파일로도 저장되며(질문·지침·답변·출처·메타 포함), DB에는 파일 상대 경로가 기록된다.
- `RETENTION_DAYS`가 지나면 결과와 파일이 자동 정리된다(`CLEANUP_INTERVAL_HOURS` 주기).

## 확장 프로토콜 요약

`hello` / `state` / `claim` / `job` / `progress` / `result` / `error` / `wake`(새 작업 알림) / `idle` / `ping`-`pong`(임대 연장) / `protocol_error`. 메시지는 서버·확장이 Zod와 공용 타입(`protocol.ts`)으로 검증한다. 인증은 연결 시 `Authorization: Bearer` 또는 `?token=`([SECURITY.md](SECURITY.md) 참고).

## MCP

서버가 MCP 서버를 내장하므로 Claude 같은 AI 에이전트에서 질의를 보낼 수 있다. `query_ask`는 질의를 등록하고 완료(또는 실패·타임아웃)까지 기다렸다가 답변을 돌려주는 동기 도구다.
