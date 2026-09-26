# Query — 개발 명세서 v3 (카테고리·프롬프트·답변 열람, 다중 provider)

PLAN2.md(브라우저 확장 방식)의 후속 문서다. PLAN2가 다루는 구조(서버 ↔ 확장 프로토콜, 임대, 확장 코어)는 그대로이며, 이 문서는 **(A) 서버 인터페이스 개선**과 **(B) Perplexity 외 provider 지원 계획**을 다룬다.

## 1. PLAN2 완료 상태와 이 문서의 범위

| PLAN2 항목 | 상태 |
|---|---|
| 서버(REST·SSE·확장 WebSocket·임대·MCP), 웹 UI, 확장 코어, Perplexity 사이트 모듈 | 구현·테스트 완료 (PLAN2 §14) |
| Perplexity 출처(Links 탭 패널) 셀렉터 | **미확정** — Links 탭을 연 상태의 콘솔 스니펫(`links`) 캡처 대기. 현재는 radix `aria-controls` 기반 추정 + 폴백 |
| 실제 서비스 등록(`m`의 launchd) | 미검증 |
| 확장 아이콘 | ✅ 완료(2026-09-26) |

PLAN2의 남은 항목은 이 문서의 작업과 병행하며 서로를 막지 않는다.

이 문서의 범위:
- §2 데이터 디렉터리 정리 (구현 완료)
- §3 카테고리와 카테고리별 시스템 프롬프트 (구현 완료)
- §4 답변 열람 개선 API (구현 완료)
- §5 웹 UI 재디자인 (Retriever 스타일)
- §6 다른 provider(Claude·ChatGPT·Gemini) 지원 계획
- §7 구현 순서와 미확정 사항

## 2. 데이터 디렉터리 정리 (구현 완료)

```
user/
├── database/            # SQLite: query.db, query.db-wal, query.db-shm  (기본 DB_PATH=user/database/query.db)
├── prompts/             # 카테고리별 시스템 프롬프트: general.md, <category>.md (기본 PROMPTS_DIR=user/prompts)
├── answers/             # 질문/답변 마크다운 파일
└── logs/                # launchd 로그 등
```

- **삭제**: `user/config/`(Gmail OAuth 클라이언트, 옛 시스템 프롬프트)와 `user/sessions/`(Gmail 토큰, Playwright 세션)는 확장 방식에서 필요 없어 제거했다. 기존 `user/config/system_prompt.md`는 `user/prompts/general.md`로 옮겼다.
- **DB 파일 3개**: SQLite WAL 모드가 만드는 `-wal`, `-shm` 보조 파일이다. 별도 디렉터리(`user/database/`)로 모아 `user/` 루트를 깔끔하게 한다.
- **환경변수**: `SYSTEM_PROMPT_PATH`는 폐기, `PROMPTS_DIR`를 신설했다. `DB_PATH` 기본값이 `user/database/query.db`로 바뀌었다(기존 DB 파일은 옮겨야 한다. 기동 시 자동 이동은 하지 않는다).
- **답변 파일명**: `yyMMdd_{id}_{provider}.md` — query_id의 `q_` 접두사를 뺀다. 예: `260926_6m1vl6_perplexity.md`(이전: `260926_q_6m1vl6_perplexity.md`). 파일 안의 제목(`# q_6m1vl6 — perplexity`)과 DB의 query_id는 그대로다. 이미 저장된 옛 이름의 파일은 DB의 경로로 계속 참조되므로 그대로 두어도 동작한다.
- 파일 끝 메타데이터에 `category: <이름>`을 추가했다.

## 3. 카테고리와 카테고리별 시스템 프롬프트 (구현 완료)

### 3.1 카테고리
- 질문(`queries`)마다 `category`를 가진다. 지정하지 않으면 **`general`**.
- 이름 규칙: 글자(한글 포함)·숫자·`-`·`_`, 첫 글자는 글자/숫자, 32자 이내, **소문자로 통일**. 프롬프트 파일명으로 쓰이므로 `.`, `/`, `\`, 공백과 Windows 예약어(`con`, `nul`, `com1` 등)는 거절한다(경로 이탈 방지).
- DB: `queries.category TEXT NOT NULL DEFAULT 'general'`. 카테고리 컬럼이 없는 기존 DB는 기동 시 자동으로 컬럼을 추가하고 기존 질문은 `general`이 된다.
- 같은 배치(벌크)의 질문은 같은 카테고리를 갖는다.

### 3.2 프롬프트 파일과 적용 규칙
- 파일: `user/prompts/general.md`, `user/prompts/<category>.md`. 파일을 직접 만들어도 되고 웹 UI/API로 만들어도 된다.
- **적용 규칙(작업을 claim하는 시점)**:
  1. 질문의 카테고리 파일이 있으면 그 내용을 쓴다(빈 파일이면 "프롬프트 없음"으로 쓴다).
  2. 없으면 `general.md`를 쓴다.
  3. `general.md`도 없으면 프롬프트 없이 질문만 보낸다.
- 실제 적용된 내용은 결과의 `system_prompt_snapshot`에 기록하고 답변 파일의 `## System Prompt`에도 남는다(PLAN §3 재현성 규칙 유지).
- 프롬프트를 나중에 고치면 아직 처리 전인 질문에는 새 내용이 적용된다(PLAN §4.8 규칙과 동일).
- 입력문 조합 포맷은 PLAN2 §4.2와 같다: `{system_prompt}\n\n---\n\n{question}`.

### 3.3 API
| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/categories` | 사용 중인 카테고리 목록: `category`, `has_prompt`, `prompt_size`, `query_count`. `general`이 항상 맨 앞 |
| `GET` | `/prompts/{category}` | 프롬프트 조회. `general`은 파일이 없어도 빈 내용으로 응답, 그 외 없으면 404 |
| `PUT` | `/prompts/{category}` | 생성/수정 `{ "content": "…" }` (50,000자 이내) |
| `DELETE` | `/prompts/{category}` | 삭제(204). `general`은 삭제 불가(409, 내용을 비운다), 없으면 404 |
| `POST` | `/queries`, `/queries/bulk`, `/ask` | 요청 본문에 `category`(선택) 추가. MCP `query_ask`에도 `category` 인자 추가 |
| `GET` | `/config/system-prompt` (`PUT` 포함) | **하위 호환**: `general` 프롬프트를 가리킨다 |

## 4. 답변 열람 개선 (구현 완료)

- **목록 미리보기**: `GET /queries` 항목에 `category`와 `answer_preview`(첫 완료 답변의 앞 160자, 마크다운 기호 제거)를 포함한다.
- **필터/검색**: `GET /queries?category=…&search=…`. `search`는 질문 텍스트 부분 일치이며 `%`, `_`는 문자 그대로 검색한다.
- **집계**: `GET /stats` → `queries`(질문 수), `results`(상태별 결과 수). 웹 UI 헤더의 Queue/답변 수 표시에 쓴다.
- **파일 내려받기**: `GET /queries/{id}/results/{result_id}/download` → 저장된 질문/답변 마크다운을 `attachment`로 내려준다(답변 파일이 없거나 보관 기간 후 삭제되었으면 404).
- 답변 본문·출처·복사는 기존 상세 조회(`GET /queries/{id}`)와 SSE를 그대로 쓴다.

## 5. 웹 UI 재디자인 (Retriever 스타일)

Retriever(`/opt/retriever`)의 웹 UI 디자인 언어를 따른다. 기존 화면은 정보 구조는 맞지만 시각적으로 밋밋하다는 피드백에 따른 개편이다. PLAN2 §13의 화면 명세는 유지하되 **레이아웃과 스타일**을 아래로 대체한다. §13.0의 "부연 설명 문구 금지"와 Lucide 아이콘 규칙은 계속 적용한다.

### 5.1 디자인 토큰
- **다크가 기본**, 라이트는 전환. 테마 모드 `auto / light / dark`(헤더 버튼으로 순환, `localStorage`의 `query_theme`에 저장, `auto`는 OS 설정 추종). 첫 페인트 전 인라인 스크립트로 `data-theme`를 적용해 깜빡임을 막는다.
- 색상 토큰(다크): 배경 `#0b0f19`, 표면 `#111827`, 표면 hover `#1f2937`, 테두리 `#374151`, 텍스트 `#f9fafb / #9ca3af / #6b7280`, 강조 `#2563eb`(hover `#1d4ed8`), 성공 `#10b981`, 경고 `#f59e0b`, 위험 `#ef4444`. 라이트는 `#f8fafc / #ffffff / #e2e8f0` 계열.
- 배지 6색(green/blue/purple/yellow/red/gray)을 상태·카테고리·provider 표시에 쓴다: done=green, processing=yellow(스피너), pending=gray, failed=red, 카테고리=purple, 확장 연결=green/red.
- 컴포넌트 규격: 버튼 `primary / secondary / danger / icon-btn / icon-btn-ghost`(최소 높이 36~38px), 입력창 6px 라운드·포커스 시 파란 테두리, 카드 8px 라운드·얇은 테두리, 숫자/ID/글자 수는 고정폭 폰트, 모달(배경 blur, 모바일에서는 하단 시트).

### 5.2 화면 구성
```
┌ 고정 헤더(56px) ─────────────────────────────────────────────────────────┐
│ ◆ QUERY  전체 | general | legal | …   [확장 연결됨] [Queue: 2] [답변: 41]  ⬆ ✎ ☾ │
└──────────────────────────────────────────────────────────────────────────┘
┌ 쿼리 바 ─────────────────────────────────────────────────────────────────┐
│ [ 질문 입력 (자동 높이)              ] [카테고리 ▾] [Perplexity ✓ …] [질의하기] │
└──────────────────────────────────────────────────────────────────────────┘
┌ 질의 목록 (0.8fr) ───────┐  ┌ 상세 (1.2fr) ───────────────────────────────┐
│ 검색 [        ] 상태 ▾   │  │ 질문 전체 · 카테고리 · 시각                   │
│ ▸ 질문 …  [done]         │  │ [Perplexity ✓done] [Claude] …  (provider 탭)  │
│   답변 미리보기 …         │  │ ┌ 답변 ───────────── 글자 수 · 복사 · 다운로드 ┐│
│   general · 09-26 19:00  │  │ │ 마크다운 렌더링                              ││
│ …                        │  │ └──────────────────────────────────────────┘│
│ [더 보기]                │  │ 출처 (N) — 번호 카드 목록                     │
└──────────────────────────┘  └───────────────────────────────────────────┘
```
- **헤더**: 로고, 카테고리 전환(현재 카테고리는 밑줄 강조, 클릭하면 목록 필터), 상태 pill(확장 연결/Queue/답변 수는 고정폭 폰트), 아이콘 버튼(벌크 입력, 프롬프트 관리, 테마).
- **쿼리 바**: 한 줄 입력(내용이 길면 자동으로 높이 증가), 카테고리 입력(기존 카테고리 자동완성, 새 이름을 입력하면 새 카테고리), provider 토글 칩, 제출 버튼. 제출 중에는 버튼을 비활성화한다(PLAN §5.1 중복 제출 방지).
- **좌우 2단**: 목록과 상세를 한 화면에서 본다. 목록에서 질의를 고르면 오른쪽에 상세가 열리고 URL(`/queries/{id}`)이 함께 바뀐다(새로고침·공유 가능). 모바일에서는 목록 → 상세로 전환하는 단일 컬럼.
- **상세 패널**: provider 탭(PLAN2 §13.2 규칙 유지), 답변 패널 헤더에 글자 수·복사·**다운로드**, 처리 중/대기/실패 상태 화면(스피너 + 진행 메시지, 실패 시 "다시 시도"), 출처는 번호가 붙은 카드 목록.
- **모달**: (1) **벌크 입력** — 여러 줄 질문 + 카테고리 + provider, (2) **프롬프트 관리** — 왼쪽에 카테고리 목록(general 고정, "새 카테고리" 입력), 오른쪽에 프롬프트 편집기와 저장·삭제, 프롬프트가 없는 카테고리는 general이 적용됨을 표시한다.
- 상태는 SSE(상세)와 5초 폴링(목록·헤더 집계)으로 갱신한다(기존 규칙 유지).

## 6. 다른 provider 지원 계획 (Claude · ChatGPT · Gemini)

### 6.1 구조 (변경 없음)
PLAN2 §12.4의 확장 지점을 그대로 쓴다. provider 하나를 추가하는 작업은 다음 네 가지다.
1. `extension/src/adapters/outbound/providers/<id>/`에 `SiteProviderPort` 구현(`<Id>Site`)과 `selectors.ts`
2. `extension/src/content/<id>.ts` 콘텐츠 스크립트 진입점
3. `providers/registry.ts`에 항목 추가(id, 이름, match 패턴, 새 대화 URL) — 빌드가 manifest를 자동 생성
4. 서버 `config.ts`의 `supportedProviders`와 `PROVIDER_NAMES`(이미 4개 이름은 등록됨), 웹 UI는 `GET /providers`로 자동 반영

서버·프로토콜·큐·재시도·임대 로직은 provider와 무관하므로 바뀌지 않는다. 확장 코어는 이미 여러 provider를 ready인 순서로 순차 처리한다(§6.4).

### 6.2 provider별로 확인해야 하는 사항
아래 셀렉터/URL은 **일반적으로 알려진 패턴에 기반한 추정**이며, 실제 화면은 바뀌었을 수 있으므로 Perplexity와 같은 방식(콘솔 스니펫 캡처)으로 확정해야 한다. 확정 전에는 코드에 넣지 않는다.

| 항목 | Claude (claude.ai) | ChatGPT (chatgpt.com) | Gemini (gemini.google.com) |
|---|---|---|---|
| 새 대화 URL(추정) | `https://claude.ai/new` | `https://chatgpt.com/` | `https://gemini.google.com/app` |
| 입력창 형태(추정) | contenteditable 에디터 | contenteditable 에디터 | contenteditable(리치 텍스트) |
| 전송/중지 | 전송 버튼·중지 버튼 aria-label 확인 필요 | 전송/중지 버튼 확인 필요 | 전송/중지 버튼 확인 필요 |
| 답변 컨테이너 | 확인 필요 | 확인 필요 | 확인 필요 |
| 출처 | 웹 검색 사용 시에만 있을 수 있음 | 웹 검색 사용 시에만 있을 수 있음 | 있을 수 있음(구글 검색 연동) |
| 로그인 판별 | 확인 필요(로그인 버튼 유무 등) | 확인 필요 | 확인 필요(구글 계정) |
| 특이 리스크 | 모델/사용량 제한 안내 배너 | 로그인 유도·쿠키 배너, 봇 검증 가능성 | 계정 선택·동의 화면, 지역별 UI 차이 |

공통 확인 절차(provider마다 3상태 캡처):
- `home`(새 대화 전), `generating`(응답 생성 중), `done`(응답 완료) 각각에서 콘솔 스니펫 실행 → 입력창/전송·중지 버튼/답변 컨테이너/출처/로그인 신호를 확정한다.
- 입력 주입(`execCommand` → paste 폴백)이 해당 에디터에서 인식되는지 실제 탭으로 검증한다.
- 사이트 모듈은 캡처한 DOM을 HTML 픽스처로 저장해 jsdom 단위 테스트를 만든다(Perplexity 모듈과 동일 방식).

### 6.3 시스템 프롬프트
웹 UI에는 별도의 시스템 프롬프트 입력이 없으므로 모든 provider에서 PLAN2 §4.2의 결합 포맷(`시스템 프롬프트 --- 질문`)을 첫 메시지로 보낸다. provider별 프롬프트 차이가 필요해지면 그때 `user/prompts/<category>.<provider>.md` 같은 확장을 검토한다(현재는 만들지 않는다).

### 6.4 여러 provider 동시 질의 동작
- 질문 하나를 여러 provider로 보내면 provider별 결과가 각각 pending으로 생긴다. 확장은 **한 번에 하나**의 작업만 처리하며 ready인 provider를 순서대로 순회한다(PLAN2 §6.2). 같은 브라우저에서는 provider 수만큼 시간이 더 걸린다.
- 질의 간 최소 간격(기본 10초)은 현재 전역 설정이다. provider마다 다르게 두는 요구가 생기면 확장 설정에 provider별 값을 추가한다.

### 6.5 리스크
| 리스크 | 대응 |
|---|---|
| 사이트 UI 변경으로 셀렉터 깨짐 | 셀렉터를 `selectors.ts` 한 파일에 모으고 에러 메시지에 셀렉터 이름을 남김(`selector_missing: …(stopButton)`), 픽스처 테스트로 회귀 확인 |
| 자동 질의로 인한 계정 제한, 약관 | 최소 질의 간격 유지, 사용자 책임으로 사이트 약관 확인 |
| 로그인/추가 인증 화면 | `login_required`로 보고하고 사용자가 해당 탭에서 직접 처리(자동 처리하지 않음) |
| provider마다 다른 응답 형식(표·코드 블록·인용 번호) | 공통 `htmlToMarkdown` 재사용, provider별 후처리는 사이트 모듈 안에서만 |

## 7. 구현 순서와 상태

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 데이터 디렉터리 정리(§2), 기존 DB·프롬프트 이전, 불필요 디렉터리 삭제 | ✅ 완료 |
| 2 | 카테고리·프롬프트 저장소·API·MCP·DB 마이그레이션(§3), 답변 열람 API(§4) | ✅ 완료 (서버 테스트 83개) |
| 3 | 확장: 탭과 통신이 안 될 때도 "열기" 동작, 진단 이유 표시 | ✅ 완료 (확장 테스트 55개) |
| 4 | 웹 UI 재디자인(§5): 다크/라이트/자동 테마, 헤더·쿼리 바·2단 패널·모달, 카테고리 전환/필터/검색, 프롬프트 관리·벌크 입력 모달, 출처 카드, 답변 다운로드 | ✅ 완료 (웹 테스트 21개, 헤드리스 브라우저 e2e로 데스크톱/모바일·다크/라이트 확인) |
| 5 | Perplexity 출처 셀렉터 확정(`links` 캡처) | 캡처 대기 |
| 6 | provider별 3상태 캡처 → 사이트 모듈 → 픽스처 테스트 (Claude → ChatGPT → Gemini 순 제안) | 캡처 대기 |
| 7 | `m`에서 launchd 등록·확장 접속 검증 | 미검증 |

### 미확정 사항 (결정 필요)
1. **provider 추가 순서**: Claude → ChatGPT → Gemini를 제안했다. 우선순위가 다르면 알려 주어야 한다.
2. **카테고리별 provider 기본값**: 카테고리마다 기본 provider 조합이 필요한지(예: legal은 Perplexity+Claude). 지금은 질의할 때마다 선택한다.
3. **옛 답변 파일 이름 변경**: 이미 저장된 `…_q_…` 파일을 새 규칙으로 바꿀지(DB 경로 갱신 필요). 지금은 그대로 둔다.
