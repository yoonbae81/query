# Perplexity (www.perplexity.ai)

코드: `extension/src/adapters/outbound/providers/perplexity/` (`selectors.ts`, `perplexitySite.ts`) · 테스트: `extension/test/providers.test.ts` (`PerplexitySite`)
절차: [README.md](README.md) · 마지막 검증: **2026-09-26** (smoke 전체 PASS: simple 8.5초, web 18.2초/출처 4건)

> Perplexity는 이 문서 체계 이전(초기 스파이크)에 만들어졌고, 이번 하네스로 실사용 검증만 새로 했다. 셀렉터별 확인 근거는 `selectors.ts` 주석이 원본이다. 로그아웃·typed 캡처를 이 형식으로 다시 남기면 좋다(미실시).

## 요약

| 항목 | 값 |
|---|---|
| 새 대화 | `https://www.perplexity.ai/` → 전송하면 `/search/<id>` (하네스에서는 `/search/new/<uuid>` 로 관찰) |
| 입력창 | `#ask-input` (contenteditable, 내부 `<p dir="auto"><br></p>`) |
| 로그인 판별 | 로그아웃: 헤더의 **"Sign In" 버튼 텍스트**. 로그인 상태는 이 버튼이 없음 |
| 실사용 확인 | 입력 주입 통함 |

## 상태별 신호

| 상태 | 전송 버튼 | 중지 버튼 | 답변 |
|---|---|---|---|
| home | `button[aria-label="Submit"]` — 비어 있으면 `pointer-events-none` 클래스 | 없음 | 없음 |
| typed | 클래스 제거되어 활성화 | 없음 | 없음 |
| generating | — | `button[aria-label^="Stop response"]` | `div.prose[data-renderer="lm"]` 성장 |
| done | — | 사라짐 | 본문 정지 |

완료 판정: stop 버튼 없음 + 마지막 답변 블록 텍스트 2초 안정.

## 답변 추출

- 본문: 마지막 `div.prose[data-renderer="lm"]` (답변 단계가 여러 개면 마지막).
- **출처는 본문 링크가 아니라 "Links" 탭을 눌러야 렌더링된다.** `button[role="tab"][id$="-trigger-sources"]`(헤더에 보이는 것과 `.invisible` 숨김 복제본이 함께 있어 **보이는 쪽**을 누른다) → 패널 `[role="tabpanel"][id$="-content-sources"]`(**[추정]** 이었으나 2026-09-26 smoke web에서 출처 4건 수집으로 동작 확인) 안 외부 링크. 탭/패널을 못 찾으면 화면의 외부 링크로 대체한다.
- 본문 안 인용은 `[1]` 형태의 외부 링크로 마크다운에 남는다.

## 함정 / 특이사항

- 전송 버튼은 텍스트가 인식돼야 활성화되므로 `pointer-events-none`이 빠질 때까지 기다린 뒤 누르고, 안 되면 Enter로 전송한다.
- 생성 시간: simple 약 8~9초, web 약 18초.

## 알려진 실패 모드

| 증상 | 원인 | 조치 |
|---|---|---|
| 출처 0건 | Links 탭 셀렉터 변경 또는 패널 렌더링 지연 | `probe --state done-sources-open` 으로 탭을 연 상태 캡처 → `sourcesTab`/`sourcesPanel` 갱신. `sourcesTimeoutMs`(3초) 조정 |
| `selector_missing(input)` | 봇 검증 화면(Cloudflare) 또는 `#ask-input` 변경 | `probe --state home` |

## 미확인

- 로그아웃/typed 캡처를 하네스 형식으로 재확인
- `sourcesPanel` 셀렉터의 캡처 근거 (동작은 확인, 원본 DOM 캡처 없음)

## 변경 이력

| 날짜 | 증상 | 원인 | 조치 |
|---|---|---|---|
| 2026-09-26 | (이 문서 도입) | — | 하네스로 smoke 전체 PASS 확인. 코드 변경 없음 |
