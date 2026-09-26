# ChatGPT (chatgpt.com)

코드: `extension/src/adapters/outbound/providers/chatgpt/` (`selectors.ts`, `chatgptSite.ts`) · 테스트: `extension/test/chatgpt.test.ts`
절차: [README.md](README.md) · 마지막 검증: **2026-09-26** (smoke 전체 PASS: simple 7.9초, web 12.1초/출처 4건)

## 요약

| 항목 | 값 |
|---|---|
| 새 대화 | `https://chatgpt.com/` → 전송하면 `/c/<id>` (전송 직후 `/c/WEB:<uuid>` 형태가 잠깐 보이기도 함) |
| 입력창 | **`div#prompt-textarea`** — ProseMirror contenteditable. **같은 id/name의 숨겨진 `textarea`가 함께 있으므로 반드시 `div`로 한정** |
| 로그인 판별 | 로그인: 사이드바 `[data-testid="accounts-profile-button"]` / 로그아웃: "Log in", "Sign up for free" 버튼 |
| 실사용 확인 | 입력 주입(`execCommand("insertText")`) 통함 |

## 상태별 신호 (`#composer-submit-button` 자리가 상태에 따라 바뀐다)

| 상태 | 입력창 | 제출 자리 버튼 | 어시스턴트 |
|---|---|---|---|
| home | 비어 있음 ("Ask anything") | `Start Voice` (음성 버튼) | 없음 |
| typed | 텍스트 있음 | **`[data-testid="send-button"]`** (aria-label "Send prompt", `type=submit`) | 없음 |
| generating | 비어 있음 | **`[data-testid="stop-button"]`** (aria-label "Stop answering") | `[data-message-author-role="assistant"] .markdown.streaming-animation` |
| done | 비어 있음 | `Start Voice` 로 복귀 | `.markdown` 에서 `streaming-animation` 제거 |

완료 판정: stop 버튼 없음 **그리고** `.markdown.streaming-animation` 없음 **그리고** 본문 2초 안정.

## 로그인/로그아웃

- 로그인: `accounts-profile-button` — **사이드바가 접히는 좁은 창(≈650px)에서는 렌더링되지 않는다**(1189px에서 확인). 그래서 "로그아웃 신호가 없으면 로그인"으로 본다.
- 로그아웃(시크릿 캡처): **DOM이 완전히 다르다.** 입력창은 `textarea#mobile-composer-prompt`(placeholder "Ask ChatGPT"), 클래스는 난독화(`x9r1u3d…`), `data-testid` 거의 없음, 쿠키 동의 `dialog[role=dialog]`. 로그인 입력창(`div#prompt-textarea`)이 없으므로 **입력창 대기 없이** "Log in"/"Sign up for free" 텍스트 버튼이 보이면 즉시 미로그인 처리한다(영어 UI 기준, 다른 언어는 미확인).

## 답변 추출

- 본문: 마지막 `[data-message-author-role="assistant"]` 안의 `.markdown`(→ 마크다운 변환, 표 포함).
- 출처: 본문 안 링크 — 인라인 `[data-testid="webpage-citation-pill"]` + 목록의 "관련 보도". **모든 외부 링크에 `?utm_source=chatgpt.com`** 이 붙으므로 제거하고, 내부 링크 판정은 href 문자열이 아니라 **호스트**(`chatgpt.com`/`openai.com`)로 한다.
- 위젯(날씨 `dil-widget-shell` 등) 텍스트가 본문에 섞여 들어온다("서울26°C/F약간 흐림Sat26°16°…"). 위젯도 답변의 일부라 제외하지 않았다.

## 함정 / 특이사항

- `#prompt-textarea`가 `textarea`(숨김)와 `div`(실제)에 모두 붙어 있다 → `div#prompt-textarea`.
- UI 언어가 프로필 설정에 따라 영어/한국어로 바뀐다("새 채팅"). `aria-label`이 아니라 `data-testid`/`data-message-author-role`을 쓴다.
- 답변 본문에 `**굵게**` 마크다운 기호가 그대로 텍스트로 보이는 경우가 있다(사이트 렌더링 결과 그대로).

## 알려진 실패 모드

| 증상 | 원인 | 조치 |
|---|---|---|
| **`timeout`(180초)인데 화면에 답변 없음** — 어시스턴트 메시지의 `.markdown.result-thinking`이 비어 있고 로딩 점만 표시, 중지 버튼도 없음 | **서비스 쪽 일시 정체**(2026-09-26 1회 관찰, 새로고침해도 대화가 비어 있음). UI 변경 아님 | 어댑터는 시간 초과로 정확히 실패 처리한다. 재시도하면 정상(`smoke`가 자동 1회 재시도). 자주 발생하면 서버 쪽 재시도 정책(MAX_RETRY)으로 흡수 |
| 로그아웃인데 `selector_missing(input)` | 로그아웃 DOM에 `div#prompt-textarea` 없음 | 로그인 버튼 신호로 즉시 판정(이미 반영) |
| 출처가 utm 파라미터 때문에 전부 사라짐 | `:not([href*="chatgpt.com"])` 같은 문자열 필터가 `?utm_source=chatgpt.com` 까지 걸러냄 | 호스트로 판정(이미 반영) |

## trace 읽는 법

`{"stop": true, "send": false, "streamingBlocks": 1, "blocks": [418], "path": "/c/…"}` → 정상 종료 시 `stop:false, streamingBlocks:0`. 정체면 `blocks:[0]`(빈 `result-thinking`)에서 멈춘다.

## 미확인

- 웹 검색 `done`에서 출처가 별도 패널로만 나오는 경우(현재는 본문 안 링크만 수집)
- 로그아웃 화면의 비영어 UI 버튼 텍스트

## 변경 이력

| 날짜 | 증상 | 원인 | 조치 |
|---|---|---|---|
| 2026-09-26 | (최초) | — | 3상태·로그아웃·typed·웹 검색 캡처로 어댑터 작성, smoke PASS |
| 2026-09-26 | 로그아웃 시 입력창 대기 후 `selector_missing` | 로그아웃 DOM이 완전히 다름 | 입력창/로그인 버튼 중 먼저 나타나는 쪽으로 판단 |
| 2026-09-26 | 출처 링크가 수집되지 않음(테스트에서 발견) | `utm_source=chatgpt.com`이 붙은 외부 링크를 문자열 필터가 제외 | 호스트 기반 내부 링크 판정 + utm 제거 |
| 2026-09-26 | 1회 timeout | 서비스 일시 정체 | 코드 변경 없음, smoke 자동 재시도 추가 |
