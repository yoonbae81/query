# Gemini (gemini.google.com)

코드: `extension/src/adapters/outbound/providers/gemini/` (`selectors.ts`, `geminiSite.ts`) · 테스트: `extension/test/gemini.test.ts`
절차: [README.md](README.md) · 마지막 검증: **2026-09-26** (smoke 전체 PASS: simple 6.3초, web 16.0초/출처 1건 — 아래 "출처 한계" 참고)

## 요약

| 항목 | 값 |
|---|---|
| 새 대화 | `https://gemini.google.com/app` → 전송하면 `/app/<id>` (다중 계정이면 `/u/<n>/app/…`) |
| 입력창 | **`rich-textarea .ql-editor`** — Quill 에디터 (`role=textbox`). 비면 `ql-blank` 클래스. 숨겨진 `div.ql-clipboard`(contenteditable)가 있어 `.ql-editor`로 한정 |
| 로그인 판별 | 로그인: `[data-test-id="new-chat-button"]` / 로그아웃: "Sign in" 버튼 (**로그아웃에도 입력창이 있다**) |
| 속성 이름 | **`data-test-id`** (하이픈) — 다른 사이트의 `data-testid` 와 다르다 |
| 실사용 확인 | 입력 주입(`execCommand("insertText")`) 통함 |

## 상태별 신호

| 상태 | 입력창 | `[data-test-id="send-button-container"]` | 응답 |
|---|---|---|---|
| home | `ql-blank` | **없음** | 없음 |
| typed | `ql-blank` 없음 | 있음 — `gem-icon-button.send-button.has-input.submit` 안 버튼 (aria-label "Send message") | 없음 |
| generating | `ql-blank` | 있음 — 버튼 aria-label **"Stop response"** | `model-response` 생김, 본문 `message-content .markdown` 성장 |
| done | `ql-blank` | **없음** | 본문 정지 |

- **생성 중 판정 = 컨테이너가 있고 입력창이 비어 있음**(언어 무관). 입력창에 텍스트가 있어서 생긴 전송 버튼은 생성 중이 아니다. aria-label "Stop response"는 영어 UI 보조 신호일 뿐이다.
- **`aria-busy`를 쓰면 안 된다.** 본문 `.markdown[aria-busy]`가 완료 후에도 `"true"`로 남는 화면과 `"false"`인 화면이 모두 관찰됐다(신뢰 불가). `processing-state-visible` 클래스도 완료 후 남는다.

## 로그인/로그아웃

- 로그아웃 캡처(시크릿): 입력창·모드 선택은 그대로 있고 **"Sign in" 버튼**(상단, 사이드바 하단, 사이드바 오류 문구 `sidenav-error-action-link`), `.signed-out-buttons`, `.mavatar-signed-out-buttons`, `[data-test-id="signed-out-highly-regulated-zero-state-disclaimer"]`, `hallucination-disclaimer.signed-out`, 사이드바에 `new-chat-button` 대신 `reset-button`.
- 로그인 신호: `[data-test-id="new-chat-button"]`, `a[href*="accounts.google.com/SignOutOptions"]`(계정 링크).
- **함정:** `sidenav-mavatar-footer`, `user-profile-picture`는 **로그아웃에도 존재**한다. 이걸 로그인 신호로 쓰면 로그아웃 화면에서 "Sign in" 버튼보다 먼저 렌더링될 때 로그인으로 오판한다(회귀 테스트 있음).

## 답변 추출

- 본문: 마지막 **`model-response`** 안의 **`message-content .markdown`**. `model-response` 전체 텍스트는 "Gemini said" 접두어와 사고 과정이 섞이고, `user-query`는 "You said" 접두어와 질문이 두 번 반복된다.
- 출처: 응답 안의 외부 링크 — 본문 `response-element … link-block > a`. 링크 뒤에 `?utm_source=gemini`가 붙으므로 제거하고, `google.com`/`google.co.kr`/`gstatic.com`/`googleusercontent.com` 호스트는 내부로 보고 제외한다.
- 날씨 카드(`weather-card`) 텍스트가 본문 맨 앞에 섞인다("토요일 • 서울특별시 27|맑음 …") — 카드도 응답의 일부라 제외하지 않았다.

## 출처 한계 (알려진 미해결)

`source-inline-chip`, `source-footnote`는 **링크가 아니라 출처 대화상자를 여는 버튼**("View source details for citations from …")이다. 칩으로만 표시된 출처(예: 기상청)는 URL이 DOM에 없고 대화상자를 열어야 나온다. 그래서 웹 검색 답변에서 `link-block` 링크만 수집되어 출처가 적게(smoke: 1건) 나온다. 필요하면 칩을 눌러 연 상태를 `probe --state done-sources-open`으로 캡처해 대화상자 DOM을 확정한 뒤 수집을 추가한다.

## 알려진 실패 모드

| 증상 | 원인 | 조치 |
|---|---|---|
| 로그아웃인데 통과, 또는 로그인인데 간헐적으로 `login_required` | 로그인 신호를 로그아웃에도 있는 요소에 걸음 | 위 "함정" 참고(이미 수정) |
| 답변이 끝났는데 완료가 안 됨(timeout) | 완료 신호를 `aria-busy`/`processing-state-visible`에 걸음 | 컨테이너+빈 입력창 기준 사용(이미 반영) |
| 출처 0~1건 | 칩 출처는 링크가 아님 | 위 "출처 한계" |

## trace 읽는 법

`{"sendContainer": true, "containerLabel": "Stop response", "inputBlank": true, "blocks": [467], "ariaBusy_UNRELIABLE": "true"}` → 종료 시 `sendContainer:false`. `ariaBusy_UNRELIABLE`은 참고용일 뿐 정상 종료 후에도 `"true"`일 수 있다.

## 미확인

- 칩 출처 대화상자 DOM
- 로그인 상태 첫 접속 시 동의/계정 선택 화면(입력창이 없을 때 `selector_missing`으로 보고됨)
- 모델 선택기 상태(`Flash` / `Flash-Lite`)에 따른 응답 형식 차이

## 변경 이력

| 날짜 | 증상 | 원인 | 조치 |
|---|---|---|---|
| 2026-09-26 | (최초) | — | 3상태·로그아웃·typed·웹 검색 캡처로 어댑터 작성, smoke PASS |
| 2026-09-26 | 완료 판정 불신 | `aria-busy`가 완료 후에도 `"true"` 잔존 | 전송/중지 컨테이너 + 빈 입력창으로 판정 |
| 2026-09-26 | 로그아웃 오판 가능(경쟁 조건) | `sidenav-mavatar-footer`가 로그아웃에도 존재 | 로그인 전용 신호(`new-chat-button`, SignOutOptions 링크)로 교체 + 회귀 테스트 |
| 2026-09-26 | 출처 URL에 `utm_source=gemini` | 사이트가 추적 파라미터를 붙임 | 제거 |
