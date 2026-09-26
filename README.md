# Query

여러 질문을 웹서버에 쌓아 두면, 로그인된 브라우저의 확장 프로그램이 대상 사이트(Perplexity 등)에서 질의하고 결과를 서버로 돌려주는 시스템.

- 설계: [docs/PLAN2.md](docs/PLAN2.md) (현재 기준), [docs/PLAN.md](docs/PLAN.md) (Playwright 워커 방식, 참고용)
- `server/` — REST API · 웹 UI(`server/web`, Svelte) · MCP · 확장 WebSocket (Node 26, TypeScript)
- `extension/` — 브라우저 확장 (Manifest V3, TypeScript)
- `protocol.ts` — 서버↔확장 메시지 타입(공용)

## 시작하기

```bash
npm run setup      # 의존성 설치, 빌드, user/ 와 .env 준비 (Node 26 필요)
npm run dev        # 서버 실행: http://127.0.0.1:4444
npm test           # 전체 테스트
```

확장 설치: 브라우저(Chrome/Vivaldi)의 확장 관리 → 개발자 모드 → "압축해제된 확장 로드" → `extension/dist`.
설정 페이지에서 서버 주소를 입력하고, Perplexity에 로그인한 탭을 열어 둔 채 팝업에서 켠다.
