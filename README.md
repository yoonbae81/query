# Query

여러 질문을 웹서버에 쌓아 두면, 로그인된 브라우저의 확장(Extension) 프로그램이 대상 사이트(Perplexity 등)에서 질의하고 결과를 서버로 돌려주는 시스템.

API 키 없이 로그인 세션으로 동작하므로, 기존에 쓰던 AI 서비스 계정 그대로 질의를 자동화할 수 있다. 질의와 답변은 모두 내 컴퓨터에 기록되어 검색하고 다시 꺼내 볼 수 있다.

## 지원 provider

- **Perplexity · Claude · ChatGPT · Gemini** — 로그인 세션 기반. 해당 사이트에 로그인된 탭이 필요하며, API 키·과금 설정은 필요 없다.
- 각 사이트의 화면 구조에 의존하므로 UI가 바뀌면 질의가 실패할 수 있다. provider별 대응 방법은 [docs/providers/README.md](docs/providers/README.md) 참고.

## 주요 기능

- **provider별 답변 비교** — 하나의 질의를 선택한 여러 provider에 순서대로 질의하고, 답변을 탭으로 나란히 본다.
- **카테고리별 답변 지침** — 카테고리마다 답변 작성 지침(시스템 프롬프트)을 따로 관리한다. 웹 UI에서 편집한다.
- **벌크 입력과 실시간 상태** — 질의를 여러 건 한 번에 등록하고, 대기→처리중→완료 진행을 실시간으로 본다(SSE).
- **여러 기기에서 분산 질의** — 확장(Extension)을 설치한 기기가 여러 대면 작업을 골고루 분배한다.
- **MCP 서버 내장** — Claude 같은 AI 에이전트에서 MCP 도구로 질의하고 답변을 바로 받을 수 있다.
- **질의 기록의 축적** — 질의·답변을 SQLite와 마크다운 파일로 보관하고, 보존 기간이 지나면 자동 정리한다.

동작 방식과 내부 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에 정리되어 있다.

## 구성

- `server/` — REST API · 웹 UI(`server/web`, Svelte) · MCP · 확장 WebSocket (Node 26, TypeScript, Fastify, 내장 SQLite)
- `extension/` — 브라우저 확장 (Manifest V3, TypeScript)
- `protocol.ts` — 서버↔확장 메시지 타입(공용)
- `user/` — 런타임 데이터 (DB, 답변 파일, 카테고리 프롬프트). gitignore 대상
- `docs/` — [아키텍처](docs/ARCHITECTURE.md) · [보안](docs/SECURITY.md) · [디자인](docs/DESIGN.md) · [provider 대응](docs/providers/README.md)

## 요구 사항

- Node.js 26 이상
- Chrome 기반 브라우저 (확장을 로드할 수 있어야 함)

## 시작하기

```bash
npm run setup      # 의존성 설치, 빌드, user/ 와 .env 준비 (Node 26 필요)
npm run dev        # 서버 실행: http://127.0.0.1:4444
npm test           # 전체 테스트
```

### Windows에서 실행하기

1. **초기 설정**: `scripts\setup.cmd` 더블클릭 (또는 `npm run setup`)
2. **서버 실행**: `scripts\start.cmd` 더블클릭 (종료: 콘솔에서 Ctrl+C)

> **💡 로컬 실행 시 토큰 안내**:
> Windows 등 로컬 환경(`127.0.0.1`)에서 실행할 때는 **토큰(`API_TOKEN`)이 전혀 필요 없습니다.**
> `.env`의 `API_TOKEN`을 비워두시면 웹 UI, 확장 프로그램, REST API 모두 인증 없이 즉시 동작합니다.
> 확장 프로그램의 서버 주소 기본값도 `http://127.0.0.1:4444`로 지정되어 있어 토큰 없이 바로 켜시면 됩니다.

### Linux / macOS에서 서비스 등록

- Linux: `scripts/install-systemd.sh` (user 모드 기본, root 불필요)
- macOS: `scripts/install-launchd.sh`

### 확장 설치

브라우저(Chrome/Vivaldi)의 확장 관리 → 개발자 모드 → "압축해제된 확장 로드" → `extension/dist`.
설정 페이지에서 서버 주소를 입력하고, 대상 사이트에 로그인한 탭을 열어 둔 채 팝업에서 켠다.

## 설정

`.env.example`을 `.env`로 복사해 사용한다(`npm run setup`이 자동 생성). 각 항목의 주석과 [docs/SECURITY.md](docs/SECURITY.md)의 설정 가이드를 참고한다.
