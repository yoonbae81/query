# Claude (claude.ai)

코드: `extension/src/adapters/outbound/providers/claude/` (`selectors.ts`, `claudeSite.ts`) · 테스트: `extension/test/claude.test.ts`
절차: [README.md](README.md) · 마지막 검증: **2026-09-26** (smoke 전체 PASS: simple 6.9초, web 49.5초/출처 8건)

## 요약

| 항목 | 값 |
|---|---|
| 새 대화 | `https://claude.ai/new` → 전송하면 `/chat/<uuid>` |
| 입력창 | `[data-testid="chat-input"]` — tiptap/ProseMirror contenteditable (`role=textbox`). 빈 상태 `<p class="is-empty">` |
| 로그인 판별 | 로그인: `[data-testid="user-menu-button"]` / 로그아웃: **`/login` 으로 리다이렉트**(입력창 자체가 없음) |
| 실사용 확인 | 입력 주입(`execCommand("insertText")`) 통함 |

## 상태별 신호

| 상태 | 입력창 | 전송 버튼 | 중지 버튼 | 어시스턴트 메시지 |
|---|---|---|---|---|
| home | 있음 (placeholder "오늘 어떤 도움을…") | `chat-input-send` (disabled, 화면에 안 보임) | 없음 | 없음 |
| typed | 텍스트 있음 | `chat-input-send` **활성화** | 없음 | 없음 |
| generating | 비어 있음 (placeholder "답글") | 없음 | `[data-testid="chat-input-stop"]` | `[data-testid="assistant-message"][data-is-streaming="true"]`, `TurnStatus[data-state="busy"]` |
| done | 비어 있음 | `chat-input-send` (disabled) | **없음** | `data-is-streaming="false"`, `TurnStatus` 모두 `done` |

완료 판정(`isGenerating`): stop 버튼 있음 **또는** `data-is-streaming="true"` **또는** `TurnStatus[data-state="busy"]` 있음 → 생성 중. 셋 다 없고 본문이 2초 안정되면 완료.

## 로그인/로그아웃

- 로그아웃 캡처(2026-09-26, 시크릿): URL `/login?from=logout&reauth=1&returnTo=%2Fnew`, 제목 "Sign in - Claude". `data-testid`: `login-with-google`, `login-with-apple`, `email`, `continue`, 쿠키 배너 `consent-banner`(`consent-accept`/`consent-reject`).
- 판정: 경로가 `/login`이거나 `login-with-google|apple`이 있으면 미로그인 → **입력창을 기다리지 않고 즉시** `login_required` (안 그러면 입력창을 15초 기다리다 `selector_missing`으로 오보고).

## 답변 추출

- 본문: 마지막 `assistant-message` 안의 **`.standard-markdown`** 블록들(마크다운 렌더러). **`.font-claude-response`는 쓰지 않는다** — 사고 과정 문구("…준비 중.")가 섞인다.
- 도구/웹 검색을 쓰면 본문이 **여러 블록**(진행 문구 + 최종 답변)이 된다. 예: `"서울 날씨와 최신 뉴스를 확인해 볼게요.\n\n날씨 위젯이 서울을 지원하지 않아 …\n\n**서울 날씨** …"`. 지금은 전부 이어 붙인다(진행 문구 포함). 최종 블록만 원하면 `claudeSite.ts extract()`에서 마지막 블록만 쓰도록 바꾼다(미결정).
- 출처: 본문 블록 안 `a` 링크(직접 URL, 추적 파라미터 없음). 인라인 칩 `span[id^="base-ui-"]` 안에 있다. 중복 제거, `claude.ai`/`anthropic.com` 링크 제외.

## 함정 / 특이사항

- UI 언어(ko-KR)에 따라 `aria-label`이 로컬라이즈된다("메시지 보내기", "응답 중지") → **`data-testid`만 쓴다**.
- 도구를 쓰는 답변은 27→52→415…자처럼 블록이 순차로 생기고, 도구 실행 중 25초 이상 본문이 멈춘다(2026-09-26 trace: 7.0초~32.8초). 본문 안정성만으로는 완료를 판정할 수 없다.
- 웹 검색 답변 소요: 약 30~50초. 모델 표기 "Sonnet 5" (계정 설정에 따라 다름).

## 알려진 실패 모드

| 증상 | 원인 | 조치 |
|---|---|---|
| 도구 사용 중 진행 문구만 답변으로 저장됨(조기 완료) | 2026-09-26 **1회 관찰, 재현 안 됨**. 원인 미확정 | `TurnStatus[data-state="busy"]`를 이중 방어로 추가. 재발 시 `trace claude`로 stop/streaming/turnStatus 타임라인 확보 |
| 로그아웃인데 `selector_missing(input)` | `/login` 리다이렉트로 입력창 없음 | 로그인 페이지 신호 판정(이미 반영) |

## trace 읽는 법

`harness.py trace claude` 출력 예: `{"stop": true, "streaming": "true", "blocks": [27, 52], "turnStatus": ["done","done","busy"], "send": false}` — 정상이면 마지막 줄에서 `stop:false, streaming:"false", turnStatus 전부 done, send:true` 로 끝난다.

## 미확인

- 로그아웃 상태에서 `/new` 첫 접속(리다이렉트 없이 익명 대화가 되는 경우가 있는지)
- 사용량 제한/오류 배너 화면

## 변경 이력

| 날짜 | 증상 | 원인 | 조치 |
|---|---|---|---|
| 2026-09-26 | (최초) | — | 3상태·로그아웃·웹 검색 캡처로 어댑터 작성, smoke PASS |
| 2026-09-26 | 로그아웃 시 입력창 대기 후 `selector_missing` | `/login` 리다이렉트 | 로그인 페이지 신호로 즉시 미로그인 판정 |
| 2026-09-26 | 도구 사용 답변 1회 조기 완료 | 미확정(재현 불가) | `TurnStatus busy` 이중 방어 + 회귀 테스트 |
