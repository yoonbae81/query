# Provider 사이트 모듈 검증·수정 런북

Claude / ChatGPT / Gemini / Perplexity 웹 UI는 예고 없이 바뀐다. 이 문서는 **UI가 바뀌었을 때 매번 처음부터 조사하지 않고**, 같은 절차로 변경을 찾아 흡수하기 위한 표준 방법론이다.
사이트별 세부 사항(확정 셀렉터, 상태 신호, 함정, 과거 변경 이력)은 [claude.md](claude.md) · [chatgpt.md](chatgpt.md) · [gemini.md](gemini.md) · [perplexity.md](perplexity.md)에 있다.

## 1. 언제 쓰나

아래 중 하나가 보이면 사이트 UI 변경을 의심하고 이 절차를 시작한다.

| 서버/확장에서 보이는 증상 | 의심되는 원인 | 먼저 볼 것 |
|---|---|---|
| `selector_missing: …(input)` | 입력창 셀렉터 변경, 봇 검증/로그인 화면 | `probe --state home` |
| `selector_missing: …(submitButton/stopButton)` / 전송 확인 실패 | 전송 버튼·URL 규칙 변경, 입력 주입 실패 | `probe --state typed` |
| `selector_missing: …(answerBlocks)` | 답변 본문 컨테이너 변경 | `probe --state done` |
| `timeout` (180초) | 완료 신호 변경, 또는 **서비스 쪽 일시 정체**(정상 UI에서도 발생) | `trace`, 재시도 |
| 완료가 너무 빠르고 답변이 중간 문구/빈 텍스트 | 생성 중 신호 변경(조기 완료) | `trace` |
| 로그인했는데 `login_required`, 또는 로그아웃인데 통과 | 로그인/로그아웃 신호 변경 | `probe --state home` / `home-loggedout` |
| 출처가 항상 0건 | 출처 DOM 변경 | `probe --state done` (웹 검색 질문) |

정기 점검용으로도 쓴다: 확장 배포 전, 또는 몇 주에 한 번 `smoke`를 돌려 미리 발견한다.

## 2. 구성

```
docs/providers/
├── README.md                # 이 문서 (절차)
├── claude.md · chatgpt.md · gemini.md · perplexity.md   # provider별 지식 베이스 + 변경 이력
└── tools/
    ├── harness.py           # 검증 하네스 (launch / bundle / smoke / run / trace / probe)
    ├── probe.js             # DOM 캡처 스니펫 (harness.probe 가 주입, 콘솔에 직접 붙여넣어도 됨)
    └── entry.ts             # 사이트 모듈을 페이지에 주입하기 위한 번들 진입점
user/                        # (gitignore) 산출물 — 계정 정보가 들어 있을 수 있어 커밋 금지
├── browser-profile/         # 로그인 세션이 저장된 전용 Chrome 프로필
└── verify/                  # sites.js(번들), report-*.md, captures/<provider>/*.json
```

동작 원리: 로그인된 **실제 Chrome**에 원격 디버깅(CDP)으로 붙어서, 확장에 들어가는 **바로 그 사이트 모듈(Site 클래스)** 을 번들해 각 탭에 주입하고 `isLoggedIn → submit → waitForCompletion → extract`를 실제 DOM에서 실행한다. 서버·확장 설치가 필요 없고, 성공하면 확장에서도 같은 코드가 동작한다.

## 3. 준비 (최초 1회)

```
pip install playwright              # 브라우저 다운로드(playwright install)는 필요 없다. 설치된 Chrome에 CDP로 붙는다
npm --prefix extension install      # esbuild 포함
```

## 4. 표준 절차

### A. 브라우저 띄우고 로그인 (사람이 하는 유일한 단계)
```
python docs/providers/tools/harness.py launch
```
전용 프로필로 Chrome이 뜨고 4개 사이트 탭이 열린다. **사용자가 4개 사이트에 로그인**하고, 쿠키/안내 팝업을 닫고, 창 폭은 **1000px 이상**으로 둔다(ChatGPT 사이드바가 좁은 폭에서 접힌다). 로그인 세션은 프로필에 남으므로 다음부터는 `launch`만 하면 대부분 다시 로그인할 필요가 없다.

> 왜 Playwright 내장 Chromium이 아니라 실제 Chrome인가: 자동화 플래그가 붙은 브라우저에서는 Google(Gemini) 로그인이 "안전하지 않은 브라우저"로 차단될 수 있다. Chrome 136+는 기본 프로필에서 원격 디버깅을 막아서 반드시 별도 `--user-data-dir`을 쓴다.

### B. 번들 → smoke
```
python docs/providers/tools/harness.py bundle      # 사이트 모듈 소스를 고칠 때마다 다시 실행
python docs/providers/tools/harness.py smoke       # 4개 provider × (simple, web) 시나리오
python docs/providers/tools/harness.py smoke claude --only web   # 일부만
```
`smoke`는 PASS/FAIL 표를 출력하고 `user/verify/report-*.md`에 저장한다(FAIL이면 종료 코드 1).
- `simple`: "1+1은? 숫자만 답해." → 본문에 `2`. 입력 주입·전송·완료 판정·추출을 검증한다.
- `web`: "오늘 서울 날씨와 최신 뉴스 3개, 출처 포함" → 본문 100자 초과 + 출처 1건 이상. 도구 사용/웹 검색이 낀 긴 생성과 출처 추출을 검증한다.
- 일시 정체로 보이는 시간 초과는 자동으로 1회 재시도한다(`--retries`). **재시도로 통과했다면 UI 변경이 아니라 서비스 일시 정체**일 가능성이 높다(ChatGPT에서 실제로 관찰됨).

전부 PASS면 끝이다. provider 문서의 "마지막 검증"만 갱신한다.

### C. FAIL이면 원인 좁히기

| 하고 싶은 것 | 명령 | 결과 |
|---|---|---|
| 신호가 시간에 따라 어떻게 바뀌는지 본다 (조기 완료·정체) | `harness.py trace <provider> [-p 질문]` | 0.5초 단위로 변화가 있을 때만 출력 |
| 화면 DOM 스냅샷을 남긴다 | `harness.py probe <provider> --state <라벨> [--q 질문일부] [--no-goto]` | `user/verify/captures/<provider>/*.json` (이메일 자동 마스킹) |
| 한 사이트에서 한 질문만 돌려 본다 | `harness.py run <provider> -p "질문"` | 단계별 소요 시간·본문·출처 |

`probe` 상태 라벨과 캡처하는 방법:

| 라벨 | 화면 | 방법 |
|---|---|---|
| `home` | 새 대화(입력 전) | 기본(`--no-goto` 없이): 새 대화로 이동해 캡처 |
| `typed` | 입력만 하고 전송 전 | 탭에 직접 입력한 뒤 `--no-goto` |
| `generating` | 생성 중(중지 버튼 보임) | 긴 답이 나올 질문을 보낸 직후 `--no-goto` (또는 `trace`가 더 편하다) |
| `done` / `done-sources-open` | 완료 / 출처를 펼친 상태 | 웹 검색 질문 후 `--no-goto` |
| `home-loggedout` | 로그아웃 화면 | 하네스 브라우저는 로그인 상태이므로 **시크릿 창**에서 `tools/probe.js`를 콘솔에 붙여넣는다(`STATE`만 수정) |

캡처 JSON에서 볼 곳: `inputs`(입력창 후보), `buttons`(전송/중지 후보), `patterns`·`testids`·`customTags`(답변 컨테이너), `answer`(구조), `links`·`sourceControls`(출처), `loginControls`·`accountControls`·`overlays`(로그인 신호).

### D. 고치기
1. `extension/src/adapters/outbound/providers/<id>/selectors.ts` 를 수정한다. 값마다 **[확인됨 날짜, 근거]** / **[추정]** 을 주석으로 구분하고, 언어에 따라 바뀌는 `aria-label`보다 `data-testid`·커스텀 태그·구조를 우선한다.
2. 필요하면 `<id>Site.ts`의 로직(판정 방식)을 수정한다.
3. **단위 테스트(`extension/test/<id>.test.ts`)의 가짜 HTML을 실제 DOM 구조에 맞게 갱신하고, 이번에 발견한 함정을 회귀 테스트로 추가한다.** (예: Gemini의 `aria-busy` 잔존, 로그아웃 화면의 다른 DOM)
4. `npm --prefix extension test` 와 `npm --prefix extension run typecheck`.

### E. 재검증·기록
```
python docs/providers/tools/harness.py bundle
python docs/providers/tools/harness.py smoke <provider>
```
PASS를 확인하면 provider 문서의 **변경 이력**에 한 줄(날짜 · 증상 · 원인 · 조치)을 추가하고 "마지막 검증"을 갱신한다. 반영은 `npm --prefix extension run build` 후 Chrome 확장 관리 화면에서 새로고침.

## 5. 지켜야 할 것

- **캡처·리포트·프로필은 `user/` 아래에만 둔다.** 계정 이름, 대화 제목이 들어 있다. `probe`는 이메일만 마스킹하므로 공유 전에 직접 확인한다.
- `smoke`/`run`은 **실제 질문을 보낸다.** 계정 사용량이 소모되고 각 사이트에 대화 기록이 남는다. 필요하면 사이트에서 직접 지운다.
- 셀렉터는 **캡처로 확인한 뒤에만** 코드에 넣는다(추정은 `[추정]` 표기). 확인 못 한 폴백은 실패해도 원인이 드러나게 오류 메시지에 셀렉터 이름을 남긴다(`selector_missing: …(이름)`).
- 완료 판정은 한 신호에 의존하지 않는다. 조기 완료(틀린 답을 저장)는 시간 초과보다 나쁜 실패다. 신호가 신뢰되지 않는 사례는 각 provider 문서에 적는다.
- 사람이 개입하는 화면(로그인, 봇 검증, 동의 화면)은 자동 처리하지 않고 `login_required`로 보고한다.

## 6. 새 provider 추가 시

1. `extension/src/adapters/outbound/providers/<id>/` 에 `selectors.ts` + `<id>Site.ts`, `extension/src/content/<id>.ts`, `providers/registry.ts` 항목, 서버 `config.ts`의 `supportedProviders`.
2. 하네스에 등록: `tools/entry.ts` 한 줄, `tools/harness.py`의 `PROVIDERS`와 `TRACE_JS` 항목.
3. `probe`로 home / typed / generating / done / home-loggedout / 웹 검색 done 을 캡처해 셀렉터를 확정하고 `docs/providers/<id>.md` 를 [claude.md](claude.md) 형식으로 작성한다.
4. 단위 테스트 작성 → `bundle` → `smoke <id>` PASS.
