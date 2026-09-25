# Query — 개발 명세서

## 1. 개요

**Query**는 여러 개의 질문을 큐에 등록해두면, 백그라운드 워커가 하나 이상의 LLM 서비스(Perplexity, Claude, Gemini, ChatGPT 등) 웹 UI를 Playwright로 자동 조작하여 질의하고, 답변을 저장해두는 **비동기 질의/답변 수거 시스템**이다.

- **헥사고날 아키텍처(Ports & Adapters)**로 구현한다. 질의 대상 LLM 서비스로의 로그인/질의는 모두 **어댑터**로 분리하여, 대상 서비스(Perplexity/Claude/Gemini/ChatGPT 등)가 늘어나도 도메인 로직(큐 관리, 재시도, 저장 정책)은 변경되지 않도록 한다.
- 모든 질문이 항상 모든 provider에게 전송되는 것은 아니다. **기본값은 Perplexity 단독**이며, 필요한 경우에만 웹 UI 체크박스(또는 API/MCP의 `providers` 파라미터)로 추가 provider를 지정해 **동시에 여러 provider에게** 질의할 수 있다. 질문 1건은 요청한 provider 수만큼의 결과(answer)를 갖는다.
- 사용자는 REST API, 웹 UI, **MCP(Model Context Protocol) 서버** 세 가지 경로로 질문을 등록할 수 있다(§7). REST API/웹 UI는 비동기 등록 후 나중에 상태를 조회(polling/SSE)하는 방식이고, MCP 툴은 Brave/DuckDuckGo 검색 MCP처럼 호출 한 번으로 결과를 바로 받는 동기 방식이다(§4.6, §7).
- 이미 답변을 받은 질문이라도 **나중에 다른 provider를 추가로 질의**할 수 있다(§4.5). 웹 UI 상세 화면은 provider별 탭으로 구성되며, 아직 질의하지 않은 provider 탭을 클릭하면 그 자리에서 추가 질의가 시작된다(§5.2).
- **개발**은 `~/Github/query`에서 진행하고, **배포**는 별도 서버의 `/opt` 하위에 설치해 서비스로 구동한다(§8). 즉 "로컬 PC 상시 구동"이 아니라 원격 서버 상시 구동이다.
- MVP는 별도 인증 없이 동작하며, 외부 접근 차단은 reverse proxy/방화벽 등 인프라 레벨에 맡긴다. 다만 향후 인증을 추가할 수 있도록 여지만 남겨둔다(§8).
- 질의량이 적고(일 수십 건 내외) 동시성 요구가 낮으므로 Redis/RabbitMQ 같은 메시지 큐 미들웨어 없이 **SQLite**를 큐 겸 저장소로 사용한다.
- 모든 질의에는 **공통 시스템 프롬프트**가 적용된다. 시스템 프롬프트는 `user/config/` 하위의 md 파일로 관리되며, 웹 UI에서 조회/수정할 수 있다.
- 질문 등록은 **개별 등록**과 **벌크(여러 건 일괄) 등록**을 모두 지원한다.
- 각 provider에는 질문을 **매번 새 대화(thread)로** 전송한다. 후속 질의(follow-up)는 하지 않으며, 하나의 질문당 provider별로 하나의 답만 얻는다.
- 답을 얻으면 DB 갱신과 별개로, 질문/답변을 **provider별 개별 파일**에 저장한다. 파일명 규칙: `yyMMdd_{question-id}_{llm-id}.md` (예: `250925_q_abc123_perplexity.md`).
- **MVP(최초 구현) 범위는 Perplexity 어댑터 1개**이며, Claude/Gemini/ChatGPT 어댑터는 동일한 포트 인터페이스로 추후 추가한다(§6.6).

## 2. 헥사고날 아키텍처

### 2.1 레이어 구성

```
                    ┌─────────────────────────────────────┐
                    │        Driving Adapters (Inbound)     │
                    │  - REST API (FastAPI Router)          │
                    │  - Web UI (FastAPI + 템플릿/정적파일)  │
                    │  - MCP Server (SSE/HTTP, §7)            │
                    └───────────────┬───────────────────────┘
                                    │ calls
                    ┌───────────────▼───────────────────────┐
                    │      Application Layer (Use Cases)     │
                    │  - SubmitQuery / SubmitBulkQueries      │
                    │  - AddProviderToQuery / RetryResult      │
                    │  - ProcessPendingResult                 │
                    │  - GetQuery / ListQueries                │
                    │  - GetSystemPrompt / UpdateSystemPrompt │
                    │  - CleanupExpiredResults                │
                    └───────────────┬───────────────────────┘
                                    │ depends on (interfaces)
                    ┌───────────────▼───────────────────────┐
                    │         Domain (Core / Hexagon)         │
                    │  - Entity: Query, QueryResult            │
                    │  - Port: LLMProviderPort                 │
                    │  - Port: QueryRepositoryPort              │
                    │  - Port: AnswerFileStoragePort            │
                    │  - Port: SystemPromptConfigPort           │
                    │  - Port: AuthCodeProviderPort             │
                    └───────────────┬───────────────────────┘
                                    │ implemented by
                    ┌───────────────▼───────────────────────┐
                    │       Driven Adapters (Outbound)        │
                    │  - PerplexityPlaywrightAdapter          │
                    │    (implements LLMProviderPort)          │
                    │  - [향후] ClaudePlaywrightAdapter 등     │
                    │  - SqliteQueryRepositoryAdapter           │
                    │  - FileAnswerStorageAdapter               │
                    │  - FileSystemPromptAdapter                │
                    │  - GmailApiAuthCodeAdapter                │
                    └───────────────────────────────────────┘
```

- **도메인(핵심)**은 어떤 LLM 서비스인지, 어떤 DB인지, 어떤 자동화 도구인지 전혀 모른다. 오직 포트(인터페이스)에만 의존한다.
- **워커 프로세스**는 애플리케이션 레이어의 `ProcessPendingResult` 유스케이스를 실행하는 **드라이빙 어댑터**로 취급한다(§8에 따라 상시 실행되며 대기열을 지속적으로 폴링).
- 새로운 LLM provider 추가 = 해당 포트를 구현하는 어댑터 클래스 1개 추가 + 레지스트리 등록. 도메인/유스케이스/API/DB 스키마는 변경 없음.

### 2.2 핵심 포트 정의

| 포트 | 방향 | 역할 | 구현 어댑터(MVP) |
|---|---|---|---|
| `LLMProviderPort` | Outbound | `ask(system_prompt, question) -> ProviderAnswer(text, citations)` | `PerplexityPlaywrightAdapter` |
| `QueryRepositoryPort` | Outbound | Query/QueryResult 영속화 (CRUD, 상태 전이) | `SqliteQueryRepositoryAdapter` |
| `AnswerFileStoragePort` | Outbound | 질문-답변 페어 파일 저장 (`yyMMdd_id_provider.md`) | `FileAnswerStorageAdapter` |
| `SystemPromptConfigPort` | Outbound | 시스템 프롬프트 읽기/쓰기 | `FileSystemPromptAdapter` |
| `AuthCodeProviderPort` | Outbound | 이메일 인증번호 조회 (provider 로그인용) | `GmailApiAuthCodeAdapter` |

- `LLMProviderPort`는 **provider 레지스트리**(`provider_id -> LLMProviderPort 구현체`)를 통해 워커가 조회한다. 워커는 `query_result.provider` 값으로 어떤 어댑터를 쓸지 결정할 뿐, 어댑터 내부 구현(Playwright든 추후 공식 API든)은 알지 못한다.
- `AuthCodeProviderPort`는 provider별 로그인 방식이 이메일 인증번호가 아닐 수도 있으므로(예: Claude/ChatGPT는 비밀번호 로그인일 수 있음) provider 어댑터가 선택적으로 사용하는 보조 포트다.

## 3. 데이터 모델 (SQLite)

한 질문(`queries`)은 요청한 provider 수만큼의 결과(`query_results`)를 갖는 **1:N 구조**다.

```sql
CREATE TABLE queries (
    id TEXT PRIMARY KEY,               -- 예: "q_abc123"
    query_text TEXT NOT NULL,
    batch_id TEXT,                     -- 벌크 등록 시 같은 배치를 묶는 식별자 (개별 등록 시 NULL)
    providers TEXT NOT NULL,           -- 요청된 provider 목록 (JSON 배열, 예: ["perplexity","claude"])
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE query_results (
    id TEXT PRIMARY KEY,               -- 예: "r_001"
    query_id TEXT NOT NULL REFERENCES queries(id),
    provider TEXT NOT NULL,            -- "perplexity" / "claude" / "gemini" / "chatgpt"
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / processing / done / failed
    progress_message TEXT,             -- processing 중 세부 진행 상태 (예: "로그인 중", "질의 전송 중", "답변 대기 중")
    answer TEXT,
    citations TEXT,                    -- 답변 출처 목록 (JSON 배열 문자열)
    answer_file_path TEXT,             -- provider별 질문/답변 페어 파일 경로 (done 시 채워짐)
    system_prompt_snapshot TEXT,       -- 처리 시점에 적용된 시스템 프롬프트 스냅샷
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP,         -- 재시도 대기 종료 시각 (NULL이면 즉시 처리 가능, §6.1)
    priority INTEGER NOT NULL DEFAULT 0,  -- 처리 우선순위 (0=일반, 1=높음). 동기 질의(/ask, query_ask)가 1로 등록 (§6.1)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (query_id, provider)
);
```

- `status` 전이(결과 단위): `pending` → `processing` → (`done` | `pending`(재시도) | `failed`)
- `retry_count`: 재시도 횟수 카운트. 최대 재시도 횟수(`MAX_RETRY`, 기본 2) 초과 시 `failed`로 확정.
- `system_prompt_snapshot`: 시스템 프롬프트는 등록 이후에도 수정될 수 있으므로, **워커가 실제로 처리한 시점**의 내용을 그대로 기록해 재현성을 보장한다.
- `batch_id`: 벌크 등록된 질문들을 웹 UI 목록에서 그룹으로 표시하기 위한 식별자.
- `citations`: 답변에 포함된 출처 링크 목록. 워커가 답변 추출 시 함께 파싱해 저장.
- `providers`(queries 테이블): 질문 등록 시 요청한 provider 목록. 등록과 동시에 이 목록 수만큼 `query_results` 행이 `pending`으로 생성된다.
- `progress_message`: §6.2 동시성 처리 중 각 provider가 지금 어느 단계인지 표시하기 위한 필드. `done`/`failed` 확정 시 초기화(NULL)한다.

### 3.0 스키마 보충 규칙

- **ID 생성**: `q_`/`r_`/`b_` 접두사 + 랜덤 6자리 소문자 영숫자(예: `q_a3f9k2`). 순번을 쓰지 않는다(문서 예시의 `r_001` 등은 표기용). 충돌 시 재생성한다.
- **중복 방지**: `query_results`에 `UNIQUE(query_id, provider)` 제약을 둔다(§4.5의 "이미 있는 provider 건너뛰기"를 DB 차원에서 보장).
- **시각 저장/표시**: DB에는 **UTC**로 저장한다. API 응답·웹 UI·파일 내용의 시각은 **KST(`+09:00`, `DISPLAY_TIMEZONE=Asia/Seoul`)** 로 변환해 표시한다. 파일명의 `yyMMdd`도 KST 기준 날짜다.
- **SQLite 설정**: API 서버와 워커가 별도 프로세스에서 같은 DB를 쓰므로 `PRAGMA journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`을 연결 시마다 적용한다.
- **목록 정렬**: `GET /queries`는 `created_at DESC, id DESC` 순이며 `cursor`는 이 두 값을 인코딩한다.

### 3.1 보관 정책 (TTL)

- `query_results`가 `done` / `failed` 상태가 된 후 **7일**이 지나면 정리(cleanup) 대상이 된다.
- 정리 시 DB의 `query_results` 레코드와 해당 `answer_file_path` 파일을 함께 삭제한다.
- 한 `queries` 행에 속한 **모든** `query_results`가 정리되면 `queries` 행도 함께 삭제한다.
- `pending` / `processing` 결과는 TTL 대상에서 제외한다.
- 정리 작업은 상시 실행 워커(§6.1) 안에서 `CLEANUP_INTERVAL_HOURS`(기본 24)마다 1회, 그리고 워커 기동 시 1회 수행한다.

## 4. API 명세

베이스 URL: `/query/api/v1` (reverse proxy 뒤에서 basePath `/query`로 서빙, §8 참고). 내부적으로는 `uvicorn`이 `localhost`의 임의 포트에서만 리슨하고, reverse proxy가 `/query` 하위 경로를 이 포트로 라우팅한다.

### 4.1 공통 에러 포맷

```json
{
  "error": { "code": "INVALID_REQUEST", "message": "질문 내용은 비어 있을 수 없습니다." }
}
```

### 4.2 `GET /providers` — 사용 가능한 provider 목록 조회

**Response (200 OK)**
```json
{
  "providers": [
    { "id": "perplexity", "name": "Perplexity", "available": true },
    { "id": "claude", "name": "Claude", "available": false },
    { "id": "gemini", "name": "Gemini", "available": false },
    { "id": "chatgpt", "name": "ChatGPT", "available": false }
  ]
}
```

- `available=false`인 provider는 레지스트리에 어댑터가 아직 등록되지 않은 상태(§6.6 향후 확장). 웹 UI에서는 선택 불가/비활성으로 표시.

### 4.3 `POST /queries` — 질의 등록 (개별)

**Request**
```json
{ "query": "원자력 인허가 절차 요약", "providers": ["perplexity"] }
```

- `providers` 생략 시 서버 기본값(`DEFAULT_PROVIDERS`, 기본 `["perplexity"]`) 적용.

**Response (201 Created)**
```json
{
  "query_id": "q_abc123",
  "created_at": "2026-09-25T19:00:00+09:00",
  "results": [
    { "result_id": "r_001", "provider": "perplexity", "status": "pending" }
  ]
}
```

**에러**: `400` (query 비어있음/`MAX_QUERY_LENGTH`(기본 4000자) 초과, providers에 미등록 provider 포함). §4.4 벌크·§4.6 `/ask`의 질문에도 동일한 길이 상한을 적용한다.

### 4.4 `POST /queries/bulk` — 질의 등록 (벌크)

**Request**
```json
{
  "queries": ["원자력 인허가 절차 요약", "345kV 변전소 소내부하 검토 방법"],
  "providers": ["perplexity"]
}
```

**Response (201 Created)**
```json
{
  "batch_id": "b_xyz789",
  "items": [
    { "query_id": "q_abc123", "results": [{ "result_id": "r_001", "provider": "perplexity", "status": "pending" }] },
    { "query_id": "q_abc124", "results": [{ "result_id": "r_002", "provider": "perplexity", "status": "pending" }] }
  ]
}
```

- 벌크 등록 시 `providers`는 배치 내 모든 질문에 동일하게 적용된다(질문별 provider 지정은 지원하지 않음).
- 항목 중 빈 문자열은 무시하고 나머지만 등록. 전체가 비어있으면 `400`.
- 등록 개수 상한(예: 100건/요청) 적용, 초과 시 `400`.

### 4.5 `POST /queries/{query_id}/providers` — 질의에 provider 추가

이미 등록된 질문에 대해, **처음에 요청하지 않았던 provider로 나중에 추가 질의**할 때 사용한다. 예: 처음엔 Perplexity에만 질의했다가, 답변을 본 뒤 같은 질문을 Claude에도 보내고 싶을 때. 웹 UI 상세 화면(§5.2)에서 아직 질의하지 않은 provider 탭을 클릭하면 이 API가 호출된다.

**Request**
```json
{ "providers": ["claude"] }
```

**Response (201 Created)**
```json
{
  "query_id": "q_abc123",
  "results": [
    { "result_id": "r_003", "provider": "claude", "status": "pending" }
  ]
}
```

- 이미 해당 query_id에 결과가 존재하는 provider(상태 무관: pending/processing/done/failed)는 **건너뛴다**(중복 생성하지 않고, 응답의 `results`에도 포함하지 않는다). 같은 provider를 다시 질의하고 싶다면 §4.12 `retry`를 사용한다.
- 요청한 provider가 **모두** 이미 존재하면 오류가 아니라 `200 OK`에 `"results": []`를 반환한다(멱등). 새로 추가된 것이 하나라도 있으면 `201 Created`.
- 성공적으로 추가된 provider는 `queries.providers` 목록에도 반영된다.
- **에러**: `400`(providers 미등록/빈 값), `404`(query_id 없음)

### 4.6 `POST /ask` — 동기 질의 (search-API 스타일)

브라우저 자동화 완료를 기다렸다가 결과를 바로 반환하는 **동기 엔드포인트**. Brave Search API / DuckDuckGo 검색 MCP처럼 "한 번 호출 → 결과 수신" 형태로 쓰고 싶을 때 사용한다. §4.3/4.4의 큐 등록(비동기) 방식과 동일한 유스케이스를 내부적으로 재사용하되, 완료될 때까지 응답을 지연시킨다는 점만 다르다. §7의 MCP `query_ask` 툴도 이 엔드포인트와 동일한 로직을 공유한다.

**Request**
```json
{ "question": "원자력 인허가 절차 요약", "providers": ["perplexity"] }
```

- `providers` 생략 시 서버 기본값(`DEFAULT_PROVIDERS`, 기본 `["perplexity"]`) 적용. 여러 개를 지정하면 해당 provider들에 동시 질의한다.
- Query Parameter `timeout_seconds`(선택, 기본 `ASK_DEFAULT_TIMEOUT_SECONDS`=60, 최대 `ASK_MAX_TIMEOUT_SECONDS`=300)

**Response (200 OK — 타임아웃 전 완료)**
```json
{
  "query_id": "q_abc123",
  "results": [
    {
      "provider": "perplexity",
      "status": "done",
      "answer": "원자력 인허가는 부지승인, 건설허가, 운영허가 단계로 나뉘며...",
      "citations": ["https://example.com/source1"]
    }
  ]
}
```

**Response (200 OK — 일부 provider가 timeout_seconds 내 미완료)**
```json
{
  "query_id": "q_abc123",
  "results": [
    { "provider": "perplexity", "status": "done", "answer": "...", "citations": [] },
    { "provider": "claude", "status": "processing", "answer": null, "citations": null }
  ],
  "note": "일부 provider가 시간 내 완료되지 않았습니다. GET /queries/q_abc123 으로 계속 조회하세요."
}
```

- 내부 동작: `POST /queries`와 동일하게 `queries`/`query_results` 행을 생성하되 결과 행을 `priority=1`로 등록해(§6.1) 벌크 대기열보다 먼저 처리되게 한 뒤, 해당 `query_id`의 모든 결과가 `done`/`failed`가 될 때까지 짧은 주기(예: 0.5초)로 내부 폴링하다가 완료 또는 `timeout_seconds` 도달 시 응답한다.
- 타임아웃이 지나도 워커의 처리 자체는 백그라운드에서 계속 진행되며, 미완료 provider는 `GET /queries/{query_id}`로 나중에 확인할 수 있다.

### 4.7 `GET /config/system-prompt` — 시스템 프롬프트 조회

**Response (200 OK)**
```json
{ "content": "당신은 ... 형식으로 답변하세요.", "updated_at": "2026-09-25T19:00:00+09:00" }
```

### 4.8 `PUT /config/system-prompt` — 시스템 프롬프트 수정

**Request**
```json
{ "content": "당신은 ... 형식으로 답변하세요." }
```

**Response (200 OK)**: 수정된 내용 반환 (4.7과 동일 포맷)

- 서버는 `user/config/system_prompt.md` 파일 내용을 그대로 덮어쓴다.
- 이미 `pending`으로 대기 중인 결과는 **처리 시점**의 프롬프트를 적용받으므로, 수정 시점 이전에 등록된 질의라도 아직 처리 전이면 새 프롬프트가 적용된다.

### 4.9 `GET /queries` — 질의 목록 조회

**Query Parameters**: `status`(필터, 선택 — 하나 이상의 결과가 해당 상태인 질의), `batch_id`(필터, 선택), `limit`(기본 20, 최대 100), `cursor`(선택 — 이전 응답의 `next_cursor`)

**Response (200 OK)**
```json
{
  "items": [
    {
      "query_id": "q_abc123",
      "batch_id": null,
      "query": "원자력 인허가 절차 요약",
      "created_at": "2026-09-25T19:00:00+09:00",
      "results_summary": [
        { "provider": "perplexity", "status": "done" }
      ]
    }
  ],
  "next_cursor": "eyJsYXN0X2lkIjoicV9hYmMxMjMifQ=="
}
```

- `next_cursor`가 `null`이면 더 이상 가져올 항목이 없다는 뜻이다. 웹 UI(§5.1)는 이 값으로 "더 보기" 버튼의 노출 여부를 결정한다.

### 4.10 `GET /queries/{query_id}` — 개별 질의 + provider별 답변 조회

**Response (200 OK)**
```json
{
  "query_id": "q_abc123",
  "batch_id": null,
  "query": "원자력 인허가 절차 요약",
  "created_at": "2026-09-25T19:00:00+09:00",
  "results": [
    {
      "result_id": "r_001",
      "provider": "perplexity",
      "status": "done",
      "answer": "원자력 인허가는 부지승인, 건설허가, 운영허가 단계로 나뉘며...",
      "citations": ["https://example.com/source1", "https://example.com/source2"],
      "answer_file_path": "answers/250925_q_abc123_perplexity.md",
      "system_prompt_snapshot": "당신은 ... 형식으로 답변하세요.",
      "progress_message": null,
      "error_message": null,
      "retry_count": 0,
      "updated_at": "2026-09-25T19:01:30+09:00"
    }
  ]
}
```

**에러**: `404` (query_id 없음)

### 4.11 `GET /queries/{query_id}/stream` — provider별 진행 상황 실시간 구독 (SSE)

- `Content-Type: text/event-stream`
- 연결 직후 현재 각 `query_results`의 스냅샷을 1회 전송, 이후 변경이 감지될 때마다 이벤트 전송
- §4.5(provider 추가)로 새 `query_results`가 생길 수 있으므로, **연결을 자동으로 종료하지 않는다.** 상세 화면(§5.2)이 열려 있는 동안 클라이언트가 연결을 유지하고, 화면을 떠나면(unmount) 클라이언트가 연결을 닫는다. 서버는 유휴 연결 보호를 위한 idle timeout(예: 30분)만 둔다.

**이벤트 예시**
```
event: result_update
data: {"result_id":"r_001","provider":"perplexity","status":"processing","progress_message":"답변 대기 중"}

event: result_update
data: {"result_id":"r_002","provider":"claude","status":"done","progress_message":null}

event: result_added
data: {"result_id":"r_003","provider":"gemini","status":"pending"}
```

- `result_update`: 기존 `query_results` 행의 `status`/`progress_message`(및 완료 시 `answer`/`citations`) 변경.
- `result_added`: §4.5로 새 provider가 추가되어 `query_results` 행이 새로 생겼을 때. 웹 UI는 이 이벤트를 받으면 해당 provider의 "질의 시작" 탭을 "대기 중" 탭으로 전환한다.
- 구현 방식: 워커와 API 서버는 별도 프로세스이므로 워커가 API로 직접 push하지 않는다. API 서버가 해당 `query_id`의 `query_results`를 **짧은 주기(예: 1초)로 폴링**하며 이전 스냅샷과 비교해 변경분(갱신/신규)만 SSE 이벤트로 내보내는 "DB 기반 폴링→푸시 브릿지" 방식으로 구현한다. 클라이언트(웹 UI) 입장에서는 실시간 push로 느껴지지만, 내부적으로는 DB 폴링이다.

### 4.12 `POST /queries/{query_id}/results/{result_id}/retry` — 개별 provider 결과 수동 재시도

`failed`로 확정된 결과를 사용자가 웹 UI에서 직접 재시도할 때 사용한다 (§5.2).

**Response (200 OK)**
```json
{ "result_id": "r_001", "provider": "perplexity", "status": "pending" }
```

- 대상 결과를 `retry_count=0, status='pending', error_message=NULL`로 리셋한다. 워커가 다음 루프에서 다시 집어간다.
- **에러**: `404`(result_id 없음), `409`(현재 상태가 `failed`가 아닌 경우 — `pending`/`processing`/`done` 결과는 재시도 대상이 아님)
- `pending`/`processing` 상태의 개별 결과에 대한 **취소 기능은 제공하지 않는다** (질의량이 적어 처리 속도가 빨라 취소 UX의 실익이 적다고 판단). 질의 전체를 취소하고 싶다면 §4.13 `DELETE /queries/{query_id}`를 사용한다(모든 결과가 `pending`일 때만 허용).

### 4.13 `DELETE /queries/{query_id}` — 질의 삭제 (선택 구현)

미구현 시 생략 가능. 필요 시 모든 결과가 `pending` 상태일 때만 취소 허용.

## 5. 웹 UI 명세

모든 화면은 reverse proxy basePath `/query` 하위에서 서빙된다 (예: 메인 화면 `/query/`, 상세 화면 `/query/queries/{query_id}`). 아래 URL은 앱 내부 라우팅 기준이며, 실제 접속 URL은 `/query`가 앞에 붙는다.

### 5.0 디자인 가이드라인

- 아이콘은 **Lucide** 아이콘 셋을 사용한다.
- **심플한 디자인**을 유지한다. 불필요한 장식/그림자/그라데이션을 지양한다.
- 제목이나 각 항목 레이블 아래에 **부연설명용 작은 글씨(caption/helper text)를 절대 넣지 않는다.** 레이블 자체로 의미가 전달되도록 문구를 정한다.

### 5.1 메인 화면 (`/`)

#### 시스템 프롬프트 영역

- 현재 `user/config/system_prompt.md` 내용을 표시하는 textarea + "저장" 버튼
- 저장 시 `PUT /config/system-prompt` 호출. 이후 처리되는 질의부터 새 프롬프트 적용
- 접힘/펼침(collapsible) 가능하게 하여 평소엔 목록이 우선 보이게 구성

#### 질문 입력 영역

- 입력 모드 토글: **개별 입력** / **벌크 입력**
  - 개별 입력: textarea 1개 + "질의하기" 버튼 → `POST /queries`
  - 벌크 입력: textarea에 줄바꿈으로 구분된 여러 질문 입력 + "일괄 질의하기" 버튼 → 줄 단위로 분리 후 `POST /queries/bulk`
- **Provider 선택**: `GET /providers` 결과로 체크박스 목록 표시(기본: Perplexity 체크됨). `available=false`인 provider는 비활성 표시("준비 중").
- 성공 시 "질의가 접수되었습니다(N건 × M provider)" 토스트 표시 후 목록 갱신
- **중복 제출 방지**: 요청이 서버에 도달해 응답을 받을 때까지 "질의하기"/"일괄 질의하기" 버튼을 비활성화한다(더블클릭/연타로 동일 질문이 중복 등록되는 것을 막기 위함).

#### 질의 목록

| Query ID | Batch | 질문(일부) | Provider별 상태 | 등록일시 |
|---|---|---|---|---|
| q_abc123 | - | 원자력 인허가 절차 요약... | Perplexity: done | 2026-09-25 19:00 |
| q_abc124 | b_xyz789 | 345kV 변전소 소내부하... | Perplexity: pending · Claude: done · Gemini: failed | 2026-09-25 19:05 |

- "Provider별 상태" 칸은 요청한 provider마다 뱃지를 나열한다 (`pending`/`processing`/`done`/`failed`, provider별 색상 구분). provider가 1개면 뱃지 1개만 표시된다.
- 행 클릭 → 상세 화면 이동
- 목록 하단에 **"더 보기" 버튼**: `GET /queries`의 `next_cursor`가 있으면 노출, 클릭 시 `cursor` 파라미터로 다음 페이지를 이어붙인다. `next_cursor`가 없으면 버튼 자체를 숨긴다.
- 등록된 질의가 없을 때는 목록 영역에 "등록된 질의가 없습니다" 한 줄만 표시한다(별도 일러스트/부연설명 없음, §5.0 가이드라인 준수).

### 5.2 상세 화면 (`/queries/{query_id}`)

- 상단: Query ID, 등록일시, 질문 전체 텍스트
- 하단: **provider별 탭**. 탭 목록은 `GET /providers`(§4.2)의 전체 provider 집합을 기준으로 구성하며, 탭은 두 종류로 나뉜다.
  - **이미 질의한 provider 탭**: 탭 라벨에 상태 뱃지 표시(`pending`/`processing`/`done`/`failed`). 클릭하면 해당 탭 패널로 전환한다.
  - **아직 질의하지 않은 provider 탭**: 탭 라벨을 옅게(비활성 톤) 표시하고 별도의 상태 뱃지는 없다. **클릭하는 순간 `POST /queries/{query_id}/providers`(§4.5)로 해당 provider에 질의를 시작**하고, 탭은 즉시 "대기 중" 상태로 전환된다. `available=false`인 provider(레지스트리에 어댑터 미등록, §6.2)는 클릭 불가로 표시한다.
- 진입 시 `GET /queries/{query_id}/stream`(SSE, §4.11)을 구독하여 탭들을 실시간 갱신:
  - `pending`: "대기 중" 표시
  - `processing`: 스피너 + `progress_message` 텍스트 실시간 표시 (예: "로그인 중" → "질의 전송 중" → "답변 대기 중")
  - `done`: 답변 텍스트(마크다운 렌더링), 출처(citations) 목록, 복사 버튼
  - `failed`: 에러 메시지 + **"다시 시도" 버튼**. 클릭 시 `POST /queries/{query_id}/results/{result_id}/retry`(§4.12) 호출 → 탭 상태를 `pending`으로 즉시 갱신하고 SSE로 이어서 진행 상황을 받는다.
  - SSE `result_added` 이벤트 수신 시 해당 provider 탭이 "질의하지 않음" → "대기 중"으로 전환된다(다른 브라우저 탭/기기에서 §4.5를 호출한 경우에도 동일하게 반영됨).
- 화면을 여러 provider가 동시에 처리 중인 상태로 유지할 수 있으므로 스트림은 자동으로 닫히지 않는다(§4.11). 화면을 벗어나면 연결을 닫는다.
- 탭 바는 넓은 화면에서는 가로 나열, 좁은 화면(모바일)에서는 가로 스크롤되는 탭 바로 표시한다.
- SSE 연결 실패/미지원 브라우저 대비 폴백: 5초 간격 `GET /queries/{query_id}` 폴링
- `pending`/`processing` 상태의 개별 결과에는 취소 버튼을 두지 않는다(§4.12).

## 6. 워커 동작

### 6.1 처리 루프 — asyncio 기반 동시 처리

워커는 **단일 프로세스, `asyncio` 이벤트 루프** 기반으로 동작하며, `MAX_CONCURRENT_WORKERS`(기본 4)개의 `query_results`를 동시에 처리한다. 하나의 질문을 4개 provider에 동시 질의하면, 4개의 Playwright 브라우저 컨텍스트가 각자 독립적으로 병렬 실행된다(provider가 서로 다른 사이트/계정이므로 충돌 없음).

0. **기동 시 복구**: 워커 시작 직후 `status='processing'`으로 남아 있는 행(이전 워커가 비정상 종료한 흔적)을 `pending`으로 되돌린다(`retry_count`는 증가시키지 않음). 워커는 단일 인스턴스만 실행한다는 전제다.
1. `WORKER_POLL_INTERVAL_SECONDS`(기본 1)마다 `status='pending'`이고 재시도 대기 시간(`next_attempt_at`)이 지난 행을 **`priority DESC, created_at ASC`** 순으로 조회
   - **우선순위 규칙**: 동기 질의(`POST /ask`, MCP `query_ask`, §4.6/§7.1)로 등록된 결과는 `priority=1`, 그 외(`POST /queries`, `/queries/bulk`, `/queries/{id}/providers`, 재시도)는 `priority=0`이다. 벌크로 쌓인 대기열이 있어도 `/ask` 요청이 먼저 집힌다.
   - 이미 `processing` 중인 작업은 **선점(중단)하지 않는다.** `MAX_CONCURRENT_WORKERS` 슬롯이 모두 사용 중이면 `/ask` 요청은 다음에 비는 슬롯을 우선 받는다.
   - 같은 우선순위 안에서는 등록 순서(FIFO)를 유지한다. 재시도로 `pending`에 돌아온 행도 원래 `priority`를 유지한다.
2. **원자적 클레임**: `UPDATE query_results SET status='processing' WHERE id=? AND status='pending'`의 영향 행 수가 1일 때만 처리 대상으로 삼는다. **빈 슬롯 수(`MAX_CONCURRENT_WORKERS` − 실행 중 태스크 수)만큼만** 클레임하고(미리 다 클레임해 Semaphore로 대기시키지 않는다 — 우선순위가 뒤집히지 않도록), 클레임한 각 행에 대해 `_process_one(result)` 코루틴을 `asyncio.create_task`로 동시에 실행
3. `_process_one(result)`:
   a. 대상 행을 `status='processing', progress_message='시작'`으로 업데이트
   b. `user/config/system_prompt.md`를 읽어 이번 처리에 적용할 시스템 프롬프트로 확정 (`system_prompt_snapshot`에 기록)
   c. **provider 레지스트리**에서 `provider` 값에 해당하는 `LLMProviderPort` 구현체를 조회 (예: `perplexity` → `PerplexityPlaywrightAdapter`)
   d. 어댑터의 `ask(system_prompt, query_text, on_progress)` 호출 — 어댑터는 로그인/새 대화 시작/답변 대기/출처 파싱 각 단계 진입 시 `on_progress(message)` 콜백으로 `progress_message` 컬럼을 갱신한다 (§6.4)
   e. 성공 시: `user/answers/` 디렉터리에 `yyMMdd_{query_id}_{provider}.md` 파일 저장(§6.7) 후 `status='done', answer=..., citations=..., answer_file_path=..., progress_message=NULL`
   f. 실패 시: `retry_count += 1`; **재시도 횟수가 `MAX_RETRY` 이하이면**(최초 1회 + 재시도 `MAX_RETRY`회 = 최대 3회 시도. 즉 이번 실패 직전의 `retry_count < MAX_RETRY`) `status='pending', progress_message=NULL, next_attempt_at=now+RETRY_BACKOFF_SECONDS(기본 30)`로 되돌려 재시도, 아니면 `status='failed', error_message=..., progress_message=NULL`
4. 대기열이 비어도 **종료하지 않고** 1번으로 돌아가 폴링을 계속한다(상시 루프, §8).
5. §3.1 보관 정책에 따른 정리(cleanup)는 이 루프 안에서 `CLEANUP_INTERVAL_HOURS`마다 수행한다.

(`query_results`에 `next_attempt_at TIMESTAMP` 컬럼을 추가한다 — 재시도 대기용, NULL이면 즉시 처리 가능.)

같은 provider에 대한 동시 요청이 여러 건 겹치는 경우(예: 벌크 등록으로 Perplexity에 5건 동시 요청), `MAX_CONCURRENT_WORKERS` 한도 내에서 병렬 처리되며 provider별 세션(storageState) 파일은 동일 계정을 공유하므로 **provider별 동시 접근 시 브라우저 컨텍스트만 별도 생성**하고 로그인 세션은 읽기 전용으로 공유한다 (재로그인이 필요한 경우에만 락을 걸어 한 번만 수행).

### 6.2 provider 레지스트리

```python
PROVIDER_REGISTRY: dict[str, LLMProviderPort] = {
    "perplexity": PerplexityPlaywrightAdapter(...),
    # "claude": ClaudePlaywrightAdapter(...),   # 향후 추가
    # "gemini": GeminiPlaywrightAdapter(...),   # 향후 추가
    # "chatgpt": ChatGptPlaywrightAdapter(...), # 향후 추가
}
```

- `GET /providers`의 `available` 값은 이 레지스트리에 등록되어 있는지로 판단한다.
- 새 provider 추가 시: (1) 해당 웹 UI 자동화 로직으로 `LLMProviderPort`를 구현하는 어댑터 클래스 작성 → (2) 레지스트리에 등록. 도메인/유스케이스/DB 스키마/API는 변경 불필요.

### 6.3 답변 완료 감지 — 고정 대기 + 안정화 확인 (모든 Playwright 어댑터 공통)

- 질의 전송 후 최소 고정 대기 시간(예: 5초) 확보
- 이후 답변 영역 텍스트를 일정 주기(예: 1초)로 폴링하며, **N초(예: 2초) 동안 텍스트에 변화가 없으면** 생성 완료로 간주
- 전체 타임아웃(예: 60초) 초과 시 실패로 처리 → §6.5 재시도 정책 적용

### 6.4 PerplexityPlaywrightAdapter — 질의 흐름

각 단계 진입 시 `on_progress(message)` 콜백으로 `progress_message`를 갱신해 웹 UI(§5.2 SSE)에서 실시간으로 볼 수 있게 한다.

1. `on_progress("세션 확인 중")` → 저장된 세션(storageState)으로 브라우저 컨텍스트 생성 → Perplexity 접속
2. 세션 유효성 확인. 로그인 상태가 아니면 `on_progress("로그인 중")` → 아래 재로그인 절차 수행
3. `on_progress("질의 전송 중")` → **새 대화(new thread)** 시작 → 시스템 프롬프트 + 질문을 결합하여 입력창에 입력 후 전송. 결합 포맷: `{system_prompt}\n\n---\n\n{question}` (시스템 프롬프트가 비어 있으면 질문만 전송)
4. `on_progress("답변 대기 중")` → §6.3 방식으로 답변 완료 대기
5. `on_progress("답변 추출 중")` → 답변 텍스트와 출처(citations) 추출
6. **후속 질의 없이** 해당 대화 종료 (탭/컨텍스트 닫기). 하나의 질문당 하나의 답만 취득.

**로그인/세션 관리**
- **평상시**: `storageState`(쿠키/로컬스토리지)를 파일로 저장해두고 재사용. 매번 로그인하지 않음.
- **세션 만료/실패 감지 시에만** 자동 재로그인 수행:
  1. Perplexity 로그인 화면에서 이메일 주소 입력, 인증번호 발송 요청
  2. `AuthCodeProviderPort` 구현체인 **GmailApiAuthCodeAdapter**(Gmail API OAuth)로 해당 계정 받은편지함에서 Perplexity 발신 인증번호 메일을 폴링 조회
  3. 메일 본문에서 인증번호 파싱(정규식)
  4. Perplexity 로그인 화면에 인증번호 입력, 로그인 완료
  5. 새 `storageState`를 provider별 파일에 덮어써 저장
- **인증 메일 형식(2026-09-25 실제 메일로 확인)**: 발신 `team@mail.perplexity.ai`, 제목 `Sign in to Perplexity`, 수신은 로그인 이메일(alias `yoonbae@xcv.kr`)이며 실제 메일함은 `y@xcv.kr`. text/plain 본문에 6자리 인증번호가 (1) 로그인 링크의 `token=XXXXXX` 파라미터와 (2) 본문 단독 라인에 동일하게 들어 있고, 링크와 코드는 **5분간** 유효. 링크(`/api/auth/callback/email?...&token=`)를 직접 여는 방식도 가능하나, MVP는 코드 입력 방식을 기본으로 하고 셀렉터 스파이크에서 더 안정적인 쪽을 택한다.
- **로그인 화면 셀렉터(2026-09-25 관찰)**: 쿠키 배너 `button "Only necessary"` → `button "Sign In"` → `input[name="email"]` 입력 → `button "Continue with email"` → 6칸 코드 입력(`aria-label="Digit 1 of 6"` … `"Digit 6 of 6"`, 각 maxlength=1; 첫 칸 클릭 후 6자리를 순차 타이핑하면 자동 진행/`button "Confirm"`) → 로그인 후 URL에 `pplx_account=` 파라미터. 질의 입력창은 `#ask-input`(로그인 후 홈).
- **⚠ Cloudflare 봇 검증(2026-09-25 관찰)**: 로그인 과정과 직후에 "Verify you are human"(Turnstile) 체크박스가 반복 노출되었고, 저장된 `storageState`로 재접속하면 headless는 물론 headed Playwright Chromium도 "Just a moment..." 검증 화면에서 멈춘다. 즉 §6.4의 "헤드리스 + storageState 재사용" 전제가 성립하지 않는다. 대응 방침은 §10 참고(결정 필요).
- Gmail API 사용을 위해 Google Cloud Console에 OAuth 클라이언트 등록 필요 (Gmail readonly scope), 최초 1회 사용자 동의(OAuth consent) 필요.
- **동시성 주의**: `MAX_CONCURRENT_WORKERS`로 동일 provider에 여러 요청이 동시 처리될 수 있으므로, 재로그인 절차는 **provider별 `asyncio.Lock`**으로 감싸 동시에 두 개의 재로그인 시도가 겹치지 않도록 한다 (한 태스크가 재로그인 중이면 나머지는 대기 후 갱신된 `storageState`를 재사용).

### 6.5 재시도 정책 (모든 provider 공통)

- 실패 유형(타임아웃, 셀렉터 미발견, 로그인 만료 등) 공통 적용
- 최대 `MAX_RETRY`(기본 2)회까지 자동 재시도 (다음 워커 루프에서 `pending` 상태로 재처리)
- 초과 시 `status='failed'`로 확정하고 `error_message`에 실패 사유 기록, 다음 결과로 진행
- provider별로 독립적으로 재시도/실패가 관리된다 (한 provider 실패가 다른 provider 결과에 영향 없음).

### 6.6 향후 provider 확장

- Claude / Gemini / ChatGPT 어댑터도 **동일하게 웹 UI Playwright 자동화**로 구현한다 (`claude.ai`, `gemini.google.com`, `chatgpt.com` 각각의 채팅 UI를 흉내냄).
- 각 어댑터는 `LLMProviderPort`를 구현하며, 로그인 방식(이메일 인증/비밀번호/2FA 등)에 따라 `AuthCodeProviderPort` 또는 별도 인증 어댑터를 조합해 사용한다.
- provider별로 세션 저장 파일(storageState)과 셀렉터 세트를 분리 관리한다 (`user/sessions/{provider}.json`).

### 6.7 질문-답변 페어 파일 저장

- 답변 완료(`done`) 시 `user/answers/yyMMdd_{query_id}_{provider}.md` 파일로 저장
  - `yyMMdd`: 처리(답변 완료) 시점의 날짜 6자리
  - `{query_id}`: 예 `q_abc123`
  - `{llm-id}`: provider id (`perplexity`, `claude`, `gemini`, `chatgpt`)
  - 예: `250925_q_abc123_perplexity.md`
- 파일 포맷 예시:

```markdown
# q_abc123 — perplexity

## System Prompt
당신은 ... 형식으로 답변하세요.

## Question
원자력 인허가 절차 요약

## Answer
원자력 인허가는 부지승인, 건설허가, 운영허가 단계로 나뉘며...

## Citations
- https://example.com/source1
- https://example.com/source2

---
provider: perplexity
created_at: 2026-09-25T19:00:00+09:00
answered_at: 2026-09-25T19:01:30+09:00
```

- DB의 `answer` 컬럼과 파일 내용은 동일한 답변을 가리키며, 파일은 DB 밖에서 답변을 열람·백업·공유하기 위한 용도.
- 동일 질문을 여러 provider에 질의하면 provider 수만큼 파일이 생성된다 (예: `250925_q_abc123_perplexity.md`, `250925_q_abc123_claude.md`).

## 7. MCP 서버

Query의 기능을 **MCP(Model Context Protocol) 툴**로도 노출한다. Brave Search MCP(`brave_web_search`), DuckDuckGo 검색 MCP(`duckduckgo_web_search`)처럼, 도구 하나를 단순한 파라미터로 호출하면 결과를 바로 돌려받는 형태를 따른다. MCP 서버는 REST API/웹 UI와 마찬가지로 애플리케이션 레이어(유스케이스)를 직접 호출하는 **또 하나의 드라이빙 어댑터**이며(§2.1), REST API와 같은 FastAPI 프로세스 안에 마운트되어 유스케이스를 인프로세스로 호출한다(§4.6 `POST /ask`와 동일한 로직 재사용). 외부에는 SSE/HTTP 전송으로 노출된다(§7.2).

### 7.1 제공 툴

| 툴 이름 | 설명 | 입력 | 출력 |
|---|---|---|---|
| `query_ask` | 질문을 보내고 답변이 나올 때까지 기다렸다가 반환 (기본 동작, §4.6과 동일) | `question`(string, 필수), `providers`(string[], 선택 — 기본 `["perplexity"]`), `timeout_seconds`(number, 선택 — 기본 60) | provider별 `{status, answer, citations}` 배열 + `query_id` |
| `query_status` | 이전에 등록한 질의의 현재 상태를 논블로킹으로 조회 | `query_id`(string, 필수) | §4.10과 동일한 provider별 결과 |
| `query_providers` | 사용 가능한 provider 목록 조회 | (없음) | §4.2와 동일 |

**`query_ask` 예시 (MCP tool call)**
```json
{
  "name": "query_ask",
  "arguments": { "question": "원자력 인허가 절차 요약", "providers": ["perplexity", "claude"] }
}
```

**응답 예시**
```json
{
  "query_id": "q_abc123",
  "results": [
    { "provider": "perplexity", "status": "done", "answer": "...", "citations": ["https://..."] },
    { "provider": "claude", "status": "done", "answer": "...", "citations": [] }
  ]
}
```

- `providers`를 생략하면 REST API와 동일하게 **기본값은 Perplexity 단독**이다. 필요할 때만 명시적으로 여러 provider를 배열에 나열해 동시 질의한다(웹 UI의 체크박스 선택과 동일한 역할).
- `query_ask`는 내부적으로 `timeout_seconds` 동안 완료를 기다리는 동기 호출이므로, MCP 클라이언트(예: Claude Desktop/Claude Code)에서 검색 도구처럼 한 번의 호출로 결과를 받을 수 있다. 시간 내 끝나지 않으면 미완료 provider는 `status: "processing"`으로 반환되며, 이후 `query_status`로 이어서 확인할 수 있다.

### 7.2 전송 방식

- **SSE/HTTP 전송**으로 구현한다 (stdio는 사용하지 않음). MCP 클라이언트가 원격/다른 머신에서도 reverse proxy를 통해 접속할 수 있어야 하기 때문이다.
- basePath는 REST API/웹 UI와 동일하게 `/query`를 사용한다:
  - SSE 스트림(서버→클라이언트): `GET /query/mcp/sse`
  - 메시지 전송(클라이언트→서버): `POST /query/mcp/messages`
- MCP 서버는 REST API 서버와 **같은 FastAPI 앱 프로세스에 마운트**한다(별도 포트/프로세스를 두지 않음). 이렇게 하면 reverse proxy는 `/query` 하나의 경로만 이 프로세스로 라우팅하면 되고, 포트를 외부에 노출할 필요가 없다.
- 워커는 §8에 따라 상시 실행 프로세스여야 `query_ask`가 합리적인 시간 내 응답할 수 있다.

## 8. 배포/실행

### 8.1 개발 환경

- 저장소 위치: `~/Github/query`
- 개발 중에는 `uvicorn`을 직접 실행해 로컬에서 REST API/웹 UI/MCP를 테스트한다. reverse proxy 없이 `localhost:PORT`로 바로 접속 가능하게 두어도 무방하다(basePath는 개발 편의상 생략 가능, `BASE_PATH=""`).

### 8.2 운영(배포) 환경

- **설치 위치**: 개발 PC가 아닌 **별도 서버**의 `/opt` 하위(예: `/opt/query`)에 배포해 서비스로 상시 구동한다.
- **배포 절차(제안)**: 최초 `git clone` → `/opt/query` → 가상환경/의존성 설치 → systemd 유닛(`query-api.service`, `query-worker.service`) 등록. 이후 갱신은 배포 서버에서 **수동으로 `git pull`** 한 뒤 의존성 변경 시 재설치, `systemctl restart query-api query-worker`로 반영한다(자동 배포 파이프라인 없음).
- **`user/` 디렉터리**(§9)는 git 저장소에 포함하지 않는다(`.gitignore` 대상). `git pull`이 코드(`src/`, `scripts/`, `docs/`)만 갱신하고 세션/DB/답변 파일 같은 런타임 데이터는 그대로 보존되도록 분리한 것이 이 구조의 목적이다.
- **API 서버**: REST API(§4) + 웹 UI(§5) + MCP SSE/HTTP(§7)를 **하나의 FastAPI 앱**으로 통합하여 `uvicorn`으로 상시 실행한다. `localhost`의 내부 포트에만 바인딩하고 외부에는 노출하지 않는다.
- **reverse proxy**: Nginx/Caddy 등으로 외부 요청을 받아 basePath `/query` 하위 경로를 API 서버의 내부 포트로 라우팅한다. 포트를 직접 노출하지 않고 하나의 경로(`/query`)로만 서비스를 제공하기 위함이다.
  - FastAPI는 `root_path="/query"`(또는 이를 반영한 `BASE_PATH` 설정)로 기동하여, 링크/리다이렉트/OpenAPI 스키마에도 basePath가 올바르게 반영되도록 한다.
- **워커**: API 서버와 별도 프로세스(`asyncio` 이벤트 루프 1개)로 **상시 실행**한다. `query_ask`/`POST /ask`(§4.6, §7.1)가 합리적인 시간 내 응답하려면 대기열을 짧은 주기(예: 1초)로 폴링하는 상시 루프여야 하며, cron 방식(주기적 기동 후 종료)은 권장하지 않는다.
- **API 서버**는 `GET /queries/{id}/stream` 요청을 받을 때 내부적으로 DB를 폴링하는 비동기 태스크를 추가로 구동한다 (§4.11).
- **인증**: MVP는 무인증으로 배포하고 reverse proxy/방화벽 레벨에서 접근을 제한한다. 다만 FastAPI 앱에 **인증 미들웨어를 나중에 꽂을 수 있는 자리**(예: 의존성 주입 지점 `get_current_user`류의 no-op 훅)만 MVP 코드에 남겨 두어, 추후 API Key/Basic Auth 등을 추가할 때 라우터 코드를 건드리지 않도록 한다.
- **환경 변수/설정 파일**:
  - `BASE_PATH`: reverse proxy가 매핑하는 basePath (개발 기본값 `""`, 운영 기본값 `/query`, §4/§5/§7)
  - `PERPLEXITY_LOGIN_EMAIL`: Perplexity 로그인용 이메일 주소
  - `GMAIL_OAUTH_CREDENTIALS_PATH`: Gmail API OAuth 클라이언트 시크릿 경로
  - `PLAYWRIGHT_SESSIONS_DIR`: provider별 세션(storageState) 저장 디렉터리 (기본 `user/sessions/`)
  - `DEFAULT_PROVIDERS`: providers 미지정 시 기본 적용 provider 목록 (기본 `["perplexity"]`)
  - `MAX_CONCURRENT_WORKERS`: 워커가 동시에 처리할 `query_results` 개수 상한 (기본 4, §6.1)
  - `MAX_RETRY`: 재시도 횟수 (기본 2)
  - `DB_PATH`: SQLite 파일 경로 (기본 `user/query.db`)
  - `SYSTEM_PROMPT_PATH`: 시스템 프롬프트 파일 경로 (기본 `user/config/system_prompt.md`)
  - `ANSWERS_DIR`: 질문-답변 페어 파일 저장 디렉터리 (기본 `user/answers/`)
  - `RETENTION_DAYS`: `done`/`failed` 결과 보관 기간 (기본 7일, §3.1)
  - `ASK_DEFAULT_TIMEOUT_SECONDS` / `ASK_MAX_TIMEOUT_SECONDS`: `POST /ask`·`query_ask` 동기 대기 시간 기본값/상한 (기본 60 / 300, §4.6)
  - `MAX_QUERY_LENGTH`: 질문 최대 글자 수 (기본 4000, §4.3)
  - `RETRY_BACKOFF_SECONDS`: 자동 재시도 전 대기 (기본 30, §6.1)
  - `WORKER_POLL_INTERVAL_SECONDS`: 워커 대기열 폴링 주기 (기본 1, §6.1)
  - `CLEANUP_INTERVAL_HOURS`: TTL 정리 주기 (기본 24, §3.1)
  - `DISPLAY_TIMEZONE`: 표시용 시간대 (기본 `Asia/Seoul`, DB 저장은 UTC, §3.0)
  - `GMAIL_OAUTH_TOKEN_PATH` / `GMAIL_ACCOUNT_EMAIL`: `scripts/gmail_oauth.py`가 생성·기록하는 Gmail 토큰 경로/계정 (§6.4)

## 9. 디렉터리 구조 (제안)

```
query/
├── src/                      # 애플리케이션 소스 (src/query 처럼 한 번 더 감싸지 않음)
│   ├── domain/                # 엔티티 + 포트 인터페이스 (외부 의존성 없음)
│   │   ├── entities.py        # Query, QueryResult
│   │   └── ports.py           # LLMProviderPort, QueryRepositoryPort, ...
│   ├── application/            # 유스케이스
│   │   ├── submit_query.py
│   │   ├── add_provider_to_query.py
│   │   ├── retry_result.py
│   │   ├── process_pending_result.py
│   │   ├── manage_system_prompt.py
│   │   └── cleanup_expired_results.py
│   ├── adapters/
│   │   ├── inbound/
│   │   │   ├── rest/           # FastAPI 라우터 (POST /ask 포함)
│   │   │   ├── web/             # 웹 UI (템플릿/정적파일)
│   │   │   └── mcp/              # MCP 서버 (query_ask/query_status/query_providers)
│   │   └── outbound/
│   │       ├── llm/
│   │       │   └── perplexity_playwright_adapter.py
│   │       ├── repository/
│   │       │   └── sqlite_query_repository_adapter.py
│   │       ├── storage/
│   │       │   └── file_answer_storage_adapter.py
│   │       ├── config/
│   │       │   └── file_system_prompt_adapter.py
│   │       └── auth/
│   │           └── gmail_api_auth_code_adapter.py
│   └── worker.py               # ProcessPendingResult 유스케이스를 구동하는 진입점
├── scripts/                  # 운영/개발 보조 스크립트 (예: DB 수동 정리, 세션 초기화 등)
├── docs/                      # 설계/운영 문서 (본 QUERY.md도 이곳으로 옮길 수 있음)
├── user/                       # 런타임 데이터 — 코드와 분리, git-ignore 대상 (§8)
│   ├── config/
│   │   └── system_prompt.md
│   ├── sessions/               # provider별 storageState
│   ├── answers/                 # yyMMdd_id_provider.md 저장소
│   └── query.db
└── (pyproject.toml, README.md 등 루트 설정 파일)
```

## 10. 미확정/향후 검토 사항

- **구현 착수 전 스파이크(사람이 직접 관찰 후 이 문서에 기록)**
  - Perplexity: 입력창/전송/답변 영역/출처 셀렉터, 로그인 화면 흐름
  - Gmail: Perplexity 인증 메일의 발신자·제목·인증번호 정규식
  - MCP: 설치된 `mcp` 패키지(2.x)의 SSE/HTTP 전송 API가 §7.2 경로(`/mcp/sse`, `/mcp/messages`)로 FastAPI에 마운트 가능한지
- 패키징: `src`는 최상위 패키지로 취급한다(`__init__.py` 배치, `python -m src.worker` 실행, 루트 `pyproject.toml`에 pytest 설정 포함). systemd 유닛의 API 앱 경로(`src.adapters.inbound.rest.app:app`)는 구현 시 이 위치에 맞춘다.
- Perplexity 웹 UI의 DOM 구조 변경 시 셀렉터 유지보수 필요 (버전 관리 대상)
- Claude/Gemini/ChatGPT 어댑터의 실제 구현 시점 및 우선순위
