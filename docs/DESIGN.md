# 디자인 가이드라인

Query 웹 UI의 디자인 언어를 다음 프로젝트에서도 그대로 재현할 수 있게 정리한 문서다. 값은 실제 CSS에서 가져왔고, 그대로 복사해 쓸 수 있는 스타터 코드는 §12에 있다.

- 기준 구현: `server/web/src/app.css`, `server/web/src/components/*`
- 스택: Svelte 5 + Vite, 아이콘은 Lucide, 스타일은 CSS 변수 + 컴포넌트 스코프 CSS(CSS 프레임워크 없음)

## 1. 디자인 원칙

1. **도구답게 조용하게**: 정보 밀도가 높은 업무용 도구다. 그림자·그라데이션·일러스트를 쓰지 않고, 구분은 **1px 테두리 + 배경 톤 차이**로 한다.
2. **다크가 기본**, 라이트는 같은 토큰 이름으로 값만 바꾼다. 컴포넌트는 색을 직접 쓰지 않고 항상 토큰을 쓴다.
3. **색은 의미를 전달할 때만**: 강조색(파란색)은 주 동작·선택·포커스에만, 상태 색(초록·노랑·빨강)은 상태 표시에만 쓴다.
4. **레이블만, 설명 문구 없음**: 제목이나 항목 레이블 아래에 부연 설명(helper/caption)을 넣지 않는다. 문구 자체로 뜻이 전달되게 짓는다. (§9)
5. **숫자·ID·시각·경로는 고정폭 글꼴**로 표시해 정렬과 스캔을 쉽게 한다.
6. **한 화면에서 끝나게**: 목록과 상세를 좌우 2단으로 보여 주고, 좁은 화면에서는 **위아래로 쌓는다**(쿼리 바 → 목록 → 상세). 화면 폭은 **모두 사용**한다(폭 상한 없음, §6.1).
7. **터치와 키보드 모두 1급**: 클릭 영역 최소 34~40px, 포커스 링, Esc/Enter 지원.

## 2. 디자인 토큰

이름은 모든 프로젝트에서 동일하게 유지한다(컴포넌트를 그대로 옮길 수 있도록).

### 2.1 색상

| 토큰 | 다크(기본) | 라이트 | 용도 |
|---|---|---|---|
| `--bg-primary` | `#0b0f19` | `#f8fafc` | 페이지 배경, 입력 안쪽 카드(출처 카드 등) |
| `--bg-surface` | `#111827` | `#ffffff` | 헤더, 패널, 모달, 입력창 |
| `--bg-surface-hover` | `#1f2937` | `#f1f5f9` | hover/선택 배경, 보조 버튼 배경 |
| `--bg-overlay` | `rgba(255,255,255,.02)` | `rgba(15,23,42,.03)` | 패널 헤더 등 살짝 구분되는 띠 |
| `--border` | `#374151` | `#e2e8f0` | 모든 1px 테두리 |
| `--border-focus` | `#3b82f6` | `#2563eb` | 입력 포커스 테두리, 포커스 링 |
| `--text-primary` | `#f9fafb` | `#0f172a` | 본문·제목 |
| `--text-secondary` | `#9ca3af` | `#475569` | 보조 텍스트, 비활성 탭, 아이콘 버튼 |
| `--text-muted` | `#6b7280` | `#64748b` | 메타 정보(시각·글자 수), 빈 상태 |
| `--accent` | `#2563eb` | `#2563eb` | 주 버튼, 선택 표시, 링크 hover |
| `--accent-hover` | `#1d4ed8` | `#1d4ed8` | 주 버튼 hover |
| `--success` | `#10b981` | `#059669` | 온라인 점, 성공 |
| `--warning` | `#f59e0b` | `#d97706` | 경고 |
| `--danger` | `#ef4444` | `#dc2626` | 삭제 등 위험 동작 |
| `--danger-bg` / `--danger-fg` / `--danger-border` | `#7f1d1d` / `#fca5a5` / `#7f1d1d` | `#fef2f2` / `#b91c1c` / `#fecaca` | 에러 배너, 실패 문구 |
| `--backdrop` | `rgba(0,0,0,.75)` | `rgba(15,23,42,.35)` | 모달 뒷배경 |

기타 토큰: `--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`, 안전 영역 `--sat/--sar/--sab/--sal: env(safe-area-inset-*, 0px)`.

### 2.2 타이포그래피
- 본문 글꼴: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", Roboto, "Helvetica Neue", Arial, sans-serif` (한글은 시스템 폰트에 맡긴다). `-webkit-font-smoothing: antialiased`.
- 기본 14px / line-height 1.5. 답변 본문(마크다운) 14px / 1.7~1.75.

| 용도 | 크기 / 굵기 | 비고 |
|---|---|---|
| 로고 | 16px / 800, `letter-spacing: .05em`, 대문자 | 헤더 왼쪽 |
| 모달 제목 | 16px / 600 | |
| 패널 제목 | 14px / 600 | |
| 카테고리·저장소 링크(헤더) | 13px / 500 (활성 700) | |
| 본문·입력 | 14px (검색/질문 입력 15px) | 모바일 입력은 16px |
| 메타(시각, ID, 글자 수) | 12px, 고정폭, `--text-muted` | |
| 배지 | 12px / 600, `letter-spacing:.02em` | |
| 출처 번호 | 11px / 700, 고정폭 | |

### 2.3 간격·모양
- 간격은 4의 배수: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 24. 패널 내부 여백 16, 패널 사이 간격 16, 페이지 좌우 여백 24(모바일 12~16).
- 라운드: 입력/버튼/작은 카드 **6px**, 패널/카드/모달 **8px**, 배지/칩 **9999px**, 모바일 하단 시트 상단 **16px**, 출처 번호 4px.
- 그림자는 모달과 hover 카드에만: 모달 `0 20px 25px -5px rgba(0,0,0,.5), 0 8px 10px -6px rgba(0,0,0,.5)`, hover 카드 `0 2px 8px rgba(0,0,0,.15)`.
- z-index: 헤더 100, 모달 1000, 토스트 1100.

### 2.4 모션
- 상태 전환은 `transition: all .15s ease`. 배경/글자색(테마 전환)은 `.2s ease`. 스피너는 `1s linear infinite` 회전만 쓴다. 페이지/모달 진입 애니메이션은 쓰지 않는다.

### 2.5 브레이크포인트
| 폭 | 변화 |
|---|---|
| `≤ 900px` | 목록/상세 2단 → **위아래로 쌓기**(페이지가 스크롤됨), 쿼리 바 세로 정렬, 헤더 pill 숨김 |
| `≤ 768px` | **입력창 글꼴 16px**(iOS 자동 확대 방지) |
| `≤ 640px` | 모달이 하단 시트로 전환, 헤더 상태 배지·pill 숨김, 링크 폭 축소 |

## 3. 테마 시스템 (auto / light / dark)

- 모드는 세 가지: `auto`(OS 설정 추종, 기본) / `light` / `dark`. 헤더의 **아이콘 버튼 하나로 auto → light → dark 순환**하고, 아이콘은 현재 모드(Monitor / Sun / Moon)를 보여 준다. 툴팁은 "테마: 자동".
- 저장: `localStorage`의 `<프로젝트>_theme` 키(예: `query_theme`). 저장 실패(프라이버시 모드)는 무시하고 화면 전환만 한다.
- 적용: `document.documentElement.dataset.theme = 'light' | 'dark'`. CSS는 `:root`(다크)와 `:root[data-theme="light"]` 두 벌.
- **첫 페인트 전에 적용**해 깜빡임(FOUC)을 막는다. 보안 정책(CSP)이 인라인 스크립트를 막으면 정적 파일(`public/theme-init.js`)로 `<head>`에서 동기 로드한다.
- `auto`일 때는 `matchMedia('(prefers-color-scheme: light)')`의 `change` 이벤트로 세션 중에도 반영한다.
- `<meta name="theme-color">`도 함께 바꾼다(다크 `#0b0f19`, 라이트 `#f8fafc`).
- 색은 **반드시 토큰**으로만 쓴다. 상태 배지처럼 토큰이 없는 색은 다크/라이트 두 벌을 §5.2처럼 함께 정의한다.

## 4. 기본 요소 스타일

- 리셋: `* { box-sizing: border-box; margin: 0; padding: 0 }`, `html { overflow-x: hidden; text-size-adjust: 100% }`, `body` 배경 `--bg-primary`, 글자 `--text-primary`, `min-height: 100dvh`, `overflow-x: hidden`.
- 링크는 색·밑줄 없이 상속(`color: inherit; text-decoration: none`). 마크다운 본문 링크만 파란색 + 밑줄.
- 버튼 기본: `border: none; border-radius: 6px; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; transition: all .15s ease; touch-action: manipulation; user-select: none`. 비활성은 `opacity: .5; cursor: not-allowed`.
- 입력(`input/select/textarea`): 배경 `--bg-surface`, 1px `--border`, 6px 라운드, 패딩 `8px 12px`, 14px, `outline: none`, **포커스 시 테두리 `--border-focus`**. 키보드 포커스 링은 `outline: 2px solid var(--border-focus); outline-offset: 1px`.
- 스크롤바: `scrollbar-width: thin; scrollbar-color: var(--border) transparent`.

## 5. 컴포넌트

### 5.1 버튼
| 종류 | 스타일 | 크기 | 용도 |
|---|---|---|---|
| `primary` | 배경 `--accent`, 흰 글자, hover `--accent-hover` | 높이 38(쿼리 바에서는 40), 패딩 `8px 16px` | 화면당 하나의 주 동작(질의하기, 저장) |
| `secondary` | 배경 `--bg-surface-hover`, 1px 테두리, hover 시 테두리 `--text-secondary` | 높이 38, 패딩 `8px 14px` | 보조 동작(닫기, 더 보기, 다시 시도) |
| `danger` | 투명 + 빨간 글자/테두리, hover 시 빨간 배경·흰 글자 | 높이 34, 패딩 `6px 10px` | 삭제. **두 번 눌러 확정**(첫 클릭은 "삭제 확인"으로 바뀜) |
| `icon-btn` | 투명 + 1px 테두리, `--text-secondary`, hover 시 배경 `--bg-surface-hover` | 36×36 | 헤더 액션(업로드, 벌크, 테마). 활성 상태 `.active`는 테두리·아이콘 `--accent` |
| `icon-btn-ghost` | 테두리 없음, `--text-muted`, hover 시 `--text-primary` | 34~36 | 모달 닫기, 페이지 이동, 새로고침 |
| `copy-btn` | 테두리 있는 정사각 | 32×32(mini 26×26) | 복사·다운로드. 복사 후 1.5초간 체크 아이콘 |
| `delete-btn` | 투명 + 1px 테두리 + 휴지통 아이콘(필요하면 문구 "전체 삭제"), hover 시 빨간 글자/테두리 | 높이 32 | 삭제. **첫 클릭은 "삭제 확인"(빨간 채움)으로 바뀌고 3초 안에 다시 눌러야 실행**, 실행 중·처리 중에는 비활성 + 이유 툴팁. 범위가 다른 삭제(질의 전체 vs 항목 하나)는 위치와 문구로 구분한다: **질의 삭제**(문구 포함)는 우측 패널 헤더와 목록 항목에, **결과 삭제**(아이콘)는 그 결과의 카드 헤더에 둔다. 목록 항목의 삭제 버튼은 hover/포커스 때만 보이고 터치 기기에서는 항상 보인다 |

아이콘 버튼은 항상 `aria-label`과 `title`을 둔다(아이콘만 있기 때문).

### 5.2 배지 (pill)
공통: `inline-flex; gap 4; padding 2px 8px; radius 9999px; 12px/600; letter-spacing .02em; 1px 테두리`.

| 색 | 다크 (배경 / 글자 / 테두리) | 라이트 (배경 / 글자 / 테두리) |
|---|---|---|
| green | `#064e3b` / `#6ee7b7` / `#059669` | `#ecfdf5` / `#047857` / `#a7f3d0` |
| blue | `#1e3a8a` / `#93c5fd` / `#2563eb` | `#eff6ff` / `#1d4ed8` / `#bfdbfe` |
| purple | `#4c1d95` / `#d8b4fe` / `#7c3aed` | `#f5f3ff` / `#6d28d9` / `#ddd6fe` |
| yellow | `#78350f` / `#fde68a` / `#d97706` | `#fffbeb` / `#b45309` / `#fde68a` |
| red | `#7f1d1d` / `#fca5a5` / `#dc2626` | `#fef2f2` / `#b91c1c` / `#fecaca` |
| gray | `--bg-surface-hover` / `--text-secondary` / `--border` | (토큰이라 자동) |

**의미 매핑**
- 작업 상태: `done` = green, `processing` = yellow(+ 회전 스피너 아이콘), `pending` = gray, `failed` = red.
- 카테고리/분류 = purple. 확장 연결: 연결됨 = green, 대기 = yellow, 끊김 = red.
- "수정됨" 같은 편집 상태 = yellow. "general 적용"처럼 기본값이 적용 중이라는 표시 = gray.

### 5.3 stat pill (헤더 지표)
`inline-flex; gap 6; 12px; 고정폭; 글자 --text-secondary; 배경 --bg-primary; padding 4px 8px; radius 4px; 1px --border`. 앞에 13px 아이콘. 예: `Queue: 2`, `답변: 41`. 모바일(≤640/900)에서는 숨긴다.

### 5.4 칩(토글 선택)
provider 선택: 높이 34, 패딩 `0 12px`, 13px, 9999px, 배경 `--bg-primary`, 1px `--border`, 글자 `--text-secondary`. **선택 시** 배경 `--bg-surface-hover`, 글자 `--text-primary`, 테두리 `--accent`. 앞에 7px 상태 점(온라인 `--success`, 아니면 `--text-muted`). 비활성(준비 중)은 흐리게 + `(준비 중)`.

### 5.5 입력
- 검색 입력: 높이 40, 왼쪽에 검색 아이콘(절대 위치 left 12, 패딩-left 36), 15px.
- 숫자 입력: 폭 60/80, 가운데 정렬, 고정폭. 레이블은 12px `--text-muted`를 입력 왼쪽에 인라인으로 둔다(입력 아래에 두지 않는다).
- 여러 줄 입력은 내용에 맞춰 높이가 자라고(최대 약 168px) **Enter 제출 / Shift+Enter 줄바꿈**. 한글 IME 조합 중(`isComposing`)에는 Enter를 무시한다.
- 셀렉트: 높이 32~36, 고정폭 글꼴 13px. 자동완성이 필요한 자유 입력은 `<input list>` + `<datalist>`.

### 5.6 탭
헤더 밑줄 방식. 탭 버튼 패딩 `8px 14px`, 글자 `--text-secondary`, hover 배경 `--bg-surface-hover`. **활성 탭**은 글자 `--text-primary`, 굵게(600), 하단 2px `--accent` 밑줄. 아직 실행하지 않은 탭은 투명도 .55, 사용 불가는 .3. 좁은 화면에서는 가로 스크롤. 탭 라벨 안에 상태 배지를 붙일 수 있다.

### 5.7 헤더 카테고리/저장소 전환 (링크 스위처)
`전체 | general | legal` 형태의 텍스트 링크 나열. 링크 13px/500 `--text-secondary`, hover `--accent`. **활성 항목**은 `--text-primary`, 700, 밑줄(offset 4px, 색 `--accent`). 구분자 `|`는 `--border` 색. 항목이 많으면 가로 스크롤(스크롤바 숨김), 모바일에서는 오른쪽 끝을 20px 페이드 마스크로 처리한다.

### 5.8 패널과 패널 헤더
- 패널: 배경 `--bg-surface`, 1px `--border`, 8px 라운드, `overflow: hidden`, 세로 flex(`height: 100%`, `min-height: 0`).
- 패널 헤더: **높이 48px**(필터가 줄바꿈되면 min-height), 패딩 `0 16px`, 아래 1px `--border`, 배경 `--bg-overlay`. 왼쪽: 제목(14/600) + 보조 메타(글자 수 등 12px 고정폭), 오른쪽: 복사/다운로드 같은 액션.
- 본문 영역은 `flex: 1; overflow-y: auto; min-height: 0`으로 **패널 안에서만 스크롤**한다(페이지 자체는 스크롤하지 않는다).

### 5.9 목록 항목
세로 flex, 패딩 `12px 16px`, 아래 1px `--border`. 1행: 질문(600, 2줄 말줄임) + 오른쪽에 상태 배지들. 2행: 답변 미리보기(13px `--text-secondary`, 2줄 말줄임). 3행: 메타(카테고리 purple 배지 + 고정폭 시각). hover 배경 `--bg-surface-hover`. 오른쪽 아래에 삭제 아이콘 버튼(hover/포커스 시 표시, §5.1 `delete-btn`). **선택 항목**은 배경 `--bg-surface-hover` + 왼쪽 3px `--accent` 안쪽 띠(`box-shadow: inset 3px 0 0`).

### 5.10 출처 카드
- 링크형: 배경 `--bg-primary`, 1px `--border`, 8px 라운드, 패딩 `12px 14px`. 카드에 번호(22px 원형) + 도메인(고정폭 12px) + URL(말줄임) + 외부링크 아이콘, 클릭하면 새 탭. **`http(s)`가 아닌 링크는 표시하지 않는다.**

### 5.11 모달
- 백드롭: `position: fixed; inset: 0; background: var(--backdrop); backdrop-filter: blur(2px); z-index: 1000`, 가운데 정렬, 안전 영역 패딩. 배경 클릭·**Esc**로 닫힘.
- 카드: 배경 `--bg-surface`, 1px `--border`, 8px 라운드, 패딩 `20px 24px 24px`(기본 폭 440), 큰 그림자.
- 크기: 기본 440 / `lg` 860(`90vw`) / `xl` 1040~1100(`94vw`, 높이 **고정** `78~84dvh` — 내용량에 따라 모달이 흔들리지 않게).
- 헤더: 아이콘(18) + 제목(16/600) 왼쪽, 액션 + 닫기(ghost, X 18) 오른쪽, 아래 1px 테두리, `padding-bottom 14 / margin-bottom 16`. 본문은 `overflow-y: auto; flex: 1`. 푸터는 오른쪽 정렬 버튼 `gap 8`(닫기 secondary, 확정 primary).
- **모바일(≤640px)**: 하단 시트 — `align-items: flex-end`, 폭 100%, 상단 16px 라운드, 높이 최대 90~92dvh, 하단 안전 영역 패딩.

### 5.12 토스트·배너·상태 화면
- 토스트: 화면 아래 중앙 고정(z 1100), 배경 `--bg-surface-hover`, 1px 테두리, 8px 라운드, 패딩 `10px 16px`, 13px, 3.5초 후 사라짐. 에러는 `--danger-bg/fg/border`.
- 에러 배너: `--danger-bg` 배경 + `--danger-fg` 글자, 패딩 `10px 14px`, 6px 라운드, 13px. 표시할 줄이 여러 개면 `white-space: pre-line`.
- 상태 화면(패널 중앙): 아이콘 22~26px + 제목 14/500 + 필요하면 설명 12px `--text-muted`. 로딩은 스피너(`--accent`) + 진행 문구, 실패는 제목 `--danger-fg` + "다시 시도" 버튼, 빈 상태는 아이콘 + 한 줄("등록된 질의가 없습니다").

### 5.13 마크다운 답변 본문
14px / 1.75, 헤딩은 700 + 위 여백 `1.2em`(h1 1.35em, h2 1.2em, h3 1.07em), 문단·목록·표 사이 `.7em`, 목록 들여쓰기 `1.5em`, 인라인 코드는 고정폭 `.9em` + `--bg-surface-hover` 배경 + 4px 라운드, 코드 블록은 `--bg-primary` 배경 + 1px 테두리 + 6px 라운드 + 가로 스크롤, 인용은 왼쪽 3px `--border` + `--text-secondary`, 표는 1px 테두리·헤더 `--bg-overlay`·가로 스크롤. 링크는 `--border-focus` 색 + 밑줄(offset 2px), **항상 `target="_blank" rel="noopener noreferrer"`**. HTML은 DOMPurify로 정화한 뒤에만 렌더링한다.

## 6. 레이아웃 패턴

### 6.1 앱 셸
```
┌ 헤더 (sticky, 56px + safe-area) ────────────────────────────────────┐
├ .app-container (전체 폭, 좌우 24, 위 16~24) ────────────────────────┤
│  쿼리 바 (카드)                                                      │
│  ┌ 좌 패널 ┐ ┌ 우 패널 ─────────────┐   ← 2단 그리드, 나머지 높이 채움 │
└──────────────────────────────────────────────────────────────────────┘
```
- **폭 정책**: 본문은 **화면 폭을 모두 쓴다**(`width: 100%`, 좌우 패딩 24). 폭 상한(`max-width`)을 두지 않아 와이드/울트라와이드 모니터에서도 목록과 답변 패널이 함께 넓어진다. 2단 그리드는 비율(`0.8fr / 1.2fr`)로 늘어나므로 별도 처리가 필요 없다. 읽기 어려워지는 도구에는 상한을 둘 수 있는데, 그 경우 `.app-container`에 `max-width`와 `margin: 0 auto`만 추가하면 된다.
- 다만 **글이 길게 이어지는 영역(답변 본문)은 패널 안에서 읽기 좋은 줄 길이**가 되도록 패널 폭 비율로 제한된다. 본문을 더 좁히려면 `.markdown`에 `max-width: 78ch`를 준다.
- 데스크톱에서 `.app-container`는 `height: calc(100dvh - 56px - var(--sat)); overflow: hidden`이고, 그 안의 워크스페이스가 `flex: 1; min-height: 0`으로 남은 높이를 채운다. 각 패널이 자체 스크롤한다. 모바일에서는 높이 제한을 풀고 자연 스크롤.

### 6.2 헤더
높이 `calc(56px + var(--sat))`, 배경 `--bg-surface`, 아래 1px `--border`, `position: sticky; top: 0; z-index: 100`, 좌우 패딩 `max(16px, safe-area)`.
- **왼쪽(brand)**: 로고(마크 + 워드마크 `QUERY`) → 전환 링크(§5.7).
- **오른쪽(status-bar)**: 상태 배지 → stat pill들 → 18px 세로 구분선 → 아이콘 버튼들(벌크 입력·프롬프트 관리·테마).
- 로고 마크: Lucide `message-square-text`(`--accent`). 파비콘은 둥근 사각형(라운드 8/32) 위에 마크. 새 프로젝트는 같은 구도(둥근 사각형 + 단색 마크)를 따른다.

### 6.3 쿼리 바
카드(`--bg-surface`, 1px 테두리, 8px 라운드, 패딩 `12px 16px`) 안에 한 줄: **입력(flex:1) → 파라미터/카테고리/칩 → 주 버튼**. 요소 높이는 40으로 맞추고 `gap 12`. 좁은 화면에서는 세로로 쌓고 주 버튼을 전체 폭(높이 44)으로 만든다.

### 6.4 2단 워크스페이스
- 그리드 `grid-template-columns: 0.8fr 1.2fr`(좌측 최소 340px), `gap: 16px`. **좌: 목록, 우: 상세/답변**.
- 그리드는 처음부터 보이며 남은 높이를 채운다.
- 좁은 화면(≤900px): 1열로 전환하고 **위아래로 쌓는다** — 쿼리 바 → 목록 → 상세 순서.
  - 목록은 고정 높이(`min(60dvh, 560px)`, 최소 320)의 자체 스크롤 영역, 상세는 내용만큼 자라며 **페이지 자체가 스크롤**된다(`.workspace { height: auto }`).
  - 질의를 고르면(또는 `/queries/{id}` 링크로 진입하면) **상세 위치로 부드럽게 스크롤**한다(`scrollIntoView({ block: "start" })`, 상세에 `scroll-margin-top: 68px`로 고정 헤더 아래에 맞춤). 상세가 로딩 중이어도 맨 위로 정렬되도록 선택 상태의 상세 영역에 `min-height: calc(100dvh - 80px)`을 준다.
  - 선택 전에는 빈 상세 영역(“질의를 선택하세요”)을 숨긴다. 뒤로 버튼은 두지 않는다(목록이 바로 위에 있다).
  - 선택 상태는 URL(`/queries/{id}`)에 반영해 새로고침·공유가 되게 한다.

## 7. 아이콘 (Lucide)
- 패키지: Svelte `@lucide/svelte`. **아이콘별 deep import**를 쓴다(`import Send from "@lucide/svelte/icons/send"`). 배럴 import는 개발/테스트 변환이 수천 모듈로 느려진다.
- 크기: 배지 안 12~13, 인라인/버튼 14~16, 모달 제목·닫기 18, 상태 화면 22~26. 색은 `currentColor`를 상속(주 강조 아이콘만 `--accent` 또는 `#3b82f6`).
- 자주 쓰는 아이콘: 검색 `search`, 전송 `send`, 복사/완료 `copy`/`check`, 다운로드 `download`, 새로고침 `refresh-cw`, 스피너 `loader-circle`(+`spin`), 닫기 `x`, 추가 `plus`, 삭제 `trash-2`, 저장 `save`, 폴더 `folder`, 업로드 `upload`, 테마 `sun`/`moon`/`monitor`, 상태 `check-circle-2`/`circle-alert`, 연결 `plug`/`unplug`, 큐 `layers`, 반짝임(AI 답변) `sparkles`, 태그(카테고리) `tag`, 외부 링크 `external-link`.

## 8. 상태·인터랙션 규칙
- **로딩**: 버튼은 `disabled`로 바꾸고 문구를 유지(또는 "검색 중…"). 화면 중앙 로딩은 스피너 + 진행 문구.
- **중복 제출 방지**: 서버 응답을 받을 때까지 제출 버튼을 비활성화하고, 핸들러 안에서도 진행 중이면 즉시 반환한다(비활성 버튼에 합성 클릭이 들어오는 경우 대비).
- **실시간 갱신**: 상세는 SSE, 목록·헤더 집계는 5초 폴링(탭이 숨겨져 있으면 중단). SSE가 닫히면 폴링으로 대체. 늦게 도착한 이전 요청 응답이 최신 상태를 덮어쓰지 않게 요청 토큰을 둔다.
- **위험 동작**: 삭제는 2단계 확인(버튼 문구가 "삭제 확인"으로 바뀜). 저장하지 않은 변경이 있는 채로 다른 항목으로 이동하면 확인창.
- **키보드**: Esc = 모달 닫기, Enter = 제출(Shift+Enter 줄바꿈), 모든 클릭 가능한 카드는 `<a>`/`<button>`이거나 `role="button" tabindex="0"` + Enter/Space 처리.
- **접근성**: 아이콘 버튼 `aria-label`, 탭은 `role="tablist"/"tab"` + `aria-selected`, 칩은 `aria-pressed`, 모달은 `role="dialog" aria-modal`, 상태 메시지 `role="status"`. 포커스 링을 제거하지 않는다.
- **최소 터치 영역**: 버튼 34~40px, 아이콘 버튼 36px, 모바일 주 버튼 44px.

## 9. 문구 규칙
- **부연 설명 금지**: 제목·레이블 아래에 작은 안내문(helper text)을 두지 않는다. 필요한 정보는 레이블 자체, 배지, 툴팁(`title`)으로 전달한다. 예외는 오류/상태 메시지(에러 배너, 빈 상태 한 줄).
- 레이블은 명사/동사구로 짧게: "질의하기", "일괄 질의하기", "다시 시도", "더 보기", "저장", "삭제 → 삭제 확인".
- 빈 상태는 한 줄: "등록된 질의가 없습니다". 일러스트를 쓰지 않는다.
- 토스트: "질의가 접수되었습니다(N건 × M provider)", "저장되었습니다", "복사할 수 없습니다"처럼 결과를 한 문장으로.
- 상태 값은 영문 소문자 그대로(`pending`, `processing`, `done`, `failed`) 배지에 쓰고, 한글 설명은 붙이지 않는다.
- 수치는 단위를 붙인 고정폭 표기: `342자`, `Queue: 2`, `1 / 12`, `3건`.

## 10. 반응형 체크리스트
- [ ] 320~390px에서 가로 스크롤이 없다(헤더 링크는 자체 가로 스크롤).
- [ ] 입력창 글꼴이 모바일에서 16px 이상이다.
- [ ] 모달이 ≤640px에서 하단 시트로 바뀐다.
- [ ] 모바일에서 쿼리 바 → 목록 → 상세가 위아래로 쌓이고, 질의를 고르면 상세 위치로 스크롤되며 URL(딥링크)이 동작한다.
- [ ] iOS: `viewport-fit=cover` + 안전 영역 패딩, 핀치 줌 제스처 방지(필요 시).
- [ ] 라이트/다크 양쪽에서 배지·출처 번호·에러 배너 대비가 충분하다.

## 11. 브라우저 확장 UI(팝업/설정)에 적용할 때
확장은 프레임워크 없이 순수 HTML/CSS/TS이고, 같은 토큰 이름을 쓰되 **팝업은 320px 고정 폭**이다.
- 토큰은 `prefers-color-scheme`으로 다크/라이트를 자동 전환한다(확장 UI에는 테마 토글이 없다).
- 배지는 테두리 + 상태 글자색만 쓰는 단순형(배경 채움 없음): `st-done`(초록), `st-pending`(회색).
- 토글은 40×22 스위치(켜면 초록). 모든 클릭 가능한 뱃지는 `button.badge.clickable`(hover 시 테두리·글자 `--accent`).
- MV3 CSP 때문에 인라인 스크립트 금지, 아이콘은 `lucide` 패키지를 번들에 포함해 SVG를 생성한다.

## 12. 스타터 코드 (복사해서 시작)

### 12.1 `app.css` (토큰 + 기본 요소 + 공통 컴포넌트)
```css
:root {
  color-scheme: dark;
  --bg-primary: #0b0f19; --bg-surface: #111827; --bg-surface-hover: #1f2937; --bg-overlay: rgba(255,255,255,.02);
  --border: #374151; --border-focus: #3b82f6;
  --text-primary: #f9fafb; --text-secondary: #9ca3af; --text-muted: #6b7280;
  --accent: #2563eb; --accent-hover: #1d4ed8;
  --success: #10b981; --warning: #f59e0b; --danger: #ef4444;
  --danger-bg: #7f1d1d; --danger-fg: #fca5a5; --danger-border: #7f1d1d;
  --backdrop: rgba(0,0,0,.75);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --sat: env(safe-area-inset-top, 0px); --sar: env(safe-area-inset-right, 0px);
  --sab: env(safe-area-inset-bottom, 0px); --sal: env(safe-area-inset-left, 0px);
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg-primary: #f8fafc; --bg-surface: #ffffff; --bg-surface-hover: #f1f5f9; --bg-overlay: rgba(15,23,42,.03);
  --border: #e2e8f0; --border-focus: #2563eb;
  --text-primary: #0f172a; --text-secondary: #475569; --text-muted: #64748b;
  --success: #059669; --warning: #d97706; --danger: #dc2626;
  --danger-bg: #fef2f2; --danger-fg: #b91c1c; --danger-border: #fecaca;
  --backdrop: rgba(15,23,42,.35);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; overflow-x: hidden; }
body {
  background: var(--bg-primary); color: var(--text-primary);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", Roboto, "Helvetica Neue", Arial, sans-serif;
  min-height: 100dvh; overflow-x: hidden; -webkit-font-smoothing: antialiased;
  transition: background-color .2s ease, color .2s ease;
}
a { color: inherit; text-decoration: none; }
* { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

button {
  cursor: pointer; border: none; border-radius: 6px; font: inherit; font-size: 14px; font-weight: 500;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  transition: all .15s ease; touch-action: manipulation; user-select: none; color: inherit; background: none;
}
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }
button.primary   { background: var(--accent); color: #fff; padding: 8px 16px; min-height: 38px; }
button.primary:hover:not(:disabled) { background: var(--accent-hover); }
button.secondary { background: var(--bg-surface-hover); border: 1px solid var(--border); padding: 8px 14px; min-height: 38px; }
button.secondary:hover:not(:disabled) { border-color: var(--text-secondary); }
button.danger    { color: var(--danger); border: 1px solid var(--danger-border); padding: 6px 10px; min-height: 34px; }
button.danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
.icon-btn { color: var(--text-secondary); border: 1px solid var(--border); padding: 6px; min-width: 36px; min-height: 36px; }
.icon-btn:hover:not(:disabled) { background: var(--bg-surface-hover); color: var(--text-primary); border-color: var(--text-secondary); }
.icon-btn.active { background: var(--bg-surface-hover); color: var(--accent); border-color: var(--accent); }
.icon-btn-ghost { color: var(--text-muted); padding: 6px; min-width: 34px; min-height: 34px; }
.icon-btn-ghost:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-surface-hover); }

input, select, textarea {
  background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-primary);
  border-radius: 6px; padding: 8px 12px; font: inherit; font-size: 14px; outline: none; transition: border-color .15s ease;
}
input:focus, select:focus, textarea:focus { border-color: var(--border-focus); }

.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px;
  font-size: 12px; font-weight: 600; letter-spacing: .02em; white-space: nowrap; border: 1px solid transparent; }
.badge.green  { background: #064e3b; color: #6ee7b7; border-color: #059669; }
.badge.blue   { background: #1e3a8a; color: #93c5fd; border-color: #2563eb; }
.badge.purple { background: #4c1d95; color: #d8b4fe; border-color: #7c3aed; }
.badge.yellow { background: #78350f; color: #fde68a; border-color: #d97706; }
.badge.red    { background: #7f1d1d; color: #fca5a5; border-color: #dc2626; }
.badge.gray   { background: var(--bg-surface-hover); color: var(--text-secondary); border-color: var(--border); }
:root[data-theme="light"] .badge.green  { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
:root[data-theme="light"] .badge.blue   { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
:root[data-theme="light"] .badge.purple { background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; }
:root[data-theme="light"] .badge.yellow { background: #fffbeb; color: #b45309; border-color: #fde68a; }
:root[data-theme="light"] .badge.red    { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }

.mono { font-family: var(--font-mono); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.modal-backdrop { position: fixed; inset: 0; background: var(--backdrop); display: flex; align-items: center; justify-content: center;
  z-index: 1000; backdrop-filter: blur(2px); padding: max(16px, var(--sat)) max(16px, var(--sar)) max(16px, var(--sab)) max(16px, var(--sal)); }
.modal-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; width: 100%; max-width: 440px;
  padding: 20px 24px 24px; box-shadow: 0 20px 25px -5px rgba(0,0,0,.5), 0 8px 10px -6px rgba(0,0,0,.5);
  display: flex; flex-direction: column; max-height: 88dvh; }
.modal-card.modal-lg { max-width: 860px; width: 92vw; }
.modal-card.modal-xl { max-width: 1040px; width: 94vw; height: 78dvh; }
.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding-bottom: 14px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.modal-title { display: flex; align-items: center; gap: 8px; }
.modal-title h3 { font-size: 16px; font-weight: 600; }
.modal-body { overflow-y: auto; flex: 1; min-height: 0; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

@media (max-width: 768px) { input, select, textarea { font-size: 16px; } }
@media (max-width: 640px) {
  .modal-backdrop { align-items: flex-end; padding: 0; }
  .modal-card, .modal-card.modal-lg, .modal-card.modal-xl {
    width: 100%; max-width: 100%; max-height: 92dvh; border-radius: 16px 16px 0 0; border-bottom: none;
    padding: 16px 16px max(20px, var(--sab)); }
  .modal-card.modal-xl { height: 92dvh; }
}
```

### 12.2 `theme.ts`
```ts
export type ThemeMode = "auto" | "light" | "dark";
export const THEME_STORAGE = "myproject_theme";            // 프로젝트마다 바꾼다
export const THEME_ORDER: readonly ThemeMode[] = ["auto", "light", "dark"];
export const THEME_LABEL: Record<ThemeMode, string> = { auto: "자동", light: "라이트", dark: "다크" };

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "auto") return mode;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
export function applyTheme(mode: ThemeMode): void {
  const t = resolveTheme(mode);
  document.documentElement.dataset.theme = t;
  document.getElementById("meta-theme-color")?.setAttribute("content", t === "light" ? "#f8fafc" : "#0b0f19");
}
export function getStoredThemeMode(): ThemeMode {
  try { const v = localStorage.getItem(THEME_STORAGE); return v === "light" || v === "dark" || v === "auto" ? v : "auto"; }
  catch { return "auto"; }
}
export function setStoredThemeMode(mode: ThemeMode): void {
  try { localStorage.setItem(THEME_STORAGE, mode); } catch { /* 저장 불가 환경: 화면 전환만 */ }
  applyTheme(mode);
}
export const nextThemeMode = (m: ThemeMode): ThemeMode => THEME_ORDER[(THEME_ORDER.indexOf(m) + 1) % THEME_ORDER.length]!;
```

### 12.3 `theme-init.js` (`<head>`에서 동기 로드, 첫 페인트 전 적용)
```js
(function () {
  var resolved = "dark";
  try {
    var mode = localStorage.getItem("myproject_theme");
    if (mode === "light" || mode === "dark") resolved = mode;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) resolved = "light";
  } catch (e) {}
  document.documentElement.dataset.theme = resolved;
  var meta = document.getElementById("meta-theme-color");
  if (meta) meta.setAttribute("content", resolved === "light" ? "#f8fafc" : "#0b0f19");
})();
```
`index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`, `<meta name="theme-color" id="meta-theme-color" content="#0b0f19" />`, `<script src="./theme-init.js"></script>`(인라인이 허용되는 환경이면 인라인도 가능).

### 12.4 헤더 골격 (Svelte 5)
```svelte
<header class="app-header">
  <div class="brand">
    <a class="logo" href="/"><MessageSquareText size={20} class="logo-mark" />PROJECT</a>
    <nav class="switcher"><button class="nav-link active">전체</button><span class="sep">|</span><button class="nav-link">general</button></nav>
  </div>
  <div class="status-bar">
    <span class="badge green"><Plug size={13} />연결됨</span>
    <span class="stat-pill"><Layers size={13} />Queue: 2</span>
    <div class="divider"></div>
    <button class="icon-btn" aria-label="테마 변경"><Monitor size={16} /></button>
  </div>
</header>
<style>
  .app-header { height: calc(56px + var(--sat)); padding: var(--sat) max(16px, var(--sar)) 0 max(16px, var(--sal));
    background: var(--bg-surface); border-bottom: 1px solid var(--border); display: flex; align-items: center;
    justify-content: space-between; gap: 12px; position: sticky; top: 0; z-index: 100; }
  .brand, .status-bar { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .logo { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; font-size: 16px; letter-spacing: .05em; }
  .logo :global(.logo-mark) { color: var(--accent); }
  .nav-link { padding: 2px 6px; font-size: 13px; font-weight: 500; color: var(--text-secondary); }
  .nav-link.active { color: var(--text-primary); font-weight: 700; text-decoration: underline; text-underline-offset: 4px; text-decoration-color: var(--accent); }
  .sep { color: var(--border); }
  .stat-pill { display: inline-flex; align-items: center; gap: 6px; font: 12px var(--font-mono); color: var(--text-secondary);
    background: var(--bg-primary); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); }
  .divider { width: 1px; height: 18px; background: var(--border); }
</style>
```

### 12.5 2단 워크스페이스 골격
```svelte
<main class="app-container">
  <div class="workspace">
    <div class="query-bar"><!-- 입력 + 컨트롤 + 주 버튼 --></div>
    <div class="grid"><section class="panel">…</section><section class="panel">…</section></div>
  </div>
</main>
<style>
  .app-container { width: 100%; padding: 16px 24px 24px; height: calc(100dvh - 56px - var(--sat)); overflow: hidden; } /* 전체 폭. 상한이 필요하면 max-width + margin: 0 auto */
  .workspace { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; }
  .query-bar { display: flex; gap: 12px; align-items: flex-end; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; }
  .grid { display: grid; grid-template-columns: minmax(340px, .8fr) 1.2fr; gap: 16px; flex: 1; min-height: 0; }
  .panel { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
  /* 좁은 화면: 위아래로 쌓고 페이지가 스크롤된다. 질의를 고르면 상세로 scrollIntoView (§6.4) */
  @media (max-width: 900px) {
    .app-container { height: auto; overflow: visible; padding: 12px; }
    .workspace { height: auto; }
    .grid { grid-template-columns: 1fr; flex: none; }
    .list-col { height: min(60dvh, 560px); min-height: 320px; }
    .detail-col { height: auto; scroll-margin-top: 68px; }
  }
</style>
```

## 13. 새 프로젝트 시작 체크리스트
1. `app.css`(§12.1), `theme.ts`(§12.2), `theme-init.js`(§12.3)를 복사하고 저장 키를 `<프로젝트>_theme`으로 바꾼다.
2. 로고 마크와 파비콘(둥근 사각형 + 단색 마크)을 만든다. 강조색이 다르면 `--accent`/`--accent-hover`만 바꾼다(나머지 토큰은 유지).
3. 헤더(§12.4) → 쿼리 바/툴바 → 2단 워크스페이스(§12.5) 순서로 셸을 만든다.
4. 상태 값을 §5.2의 배지 색에 매핑한다(완료 green, 진행 yellow, 대기 gray, 실패 red, 분류 purple).
5. 모달은 §5.11 규격(크기 3종, 모바일 하단 시트, Esc/백드롭 닫기)으로 하나의 `Modal` 컴포넌트를 만들어 재사용한다.
6. 모든 아이콘 버튼에 `aria-label`을 붙이고, 설명 문구(helper text)가 없는지 점검한다(§9).
7. 아래 검증을 수행한다.

## 14. 검증 방법
- **화면 확인**: Playwright(Chromium 헤드리스)로 1440×900 다크, 같은 화면 라이트(테마 버튼 클릭), 390×844 모바일(목록·상세) 스크린샷을 찍어 §10 체크리스트를 눈으로 확인한다. e2e 예시는 목록/상세/프롬프트 모달/벌크 모달/카테고리 필터/검색/다운로드/새 질문 등록을 한 번에 돈다.
- **자동 테스트**: 컴포넌트는 vitest + Testing Library로 (1) 기본 선택값, (2) 제출 중 재제출 방지, (3) Enter/Shift+Enter, (4) 테마 순환·저장, (5) 마크다운 정화를 검증한다. jsdom에는 `matchMedia`, `scrollTo`가 없으므로 테스트 setup에서 스텁을 둔다.
- **타입/접근성 검사**: `svelte-check`(경고 0 유지). 클릭 가능한 `div`에는 키보드 핸들러를 붙이거나 `<a>`/`<button>`으로 바꾼다.

## 15. 하지 말 것
- 토큰을 무시한 하드코딩 색(단, §5.2 배지·출처 번호처럼 두 테마를 모두 정의한 경우는 예외).
- 그라데이션, 큰 그림자, 애니메이션 진입 효과, 일러스트, 이모지 아이콘.
- 제목/레이블 아래 작은 설명 글씨.
- 페이지 전체 스크롤에 의존하는 데스크톱 레이아웃(패널 내부 스크롤을 쓴다).
- 아이콘 배럴 import, 아이콘만 있는 버튼의 `aria-label` 누락.
- 인라인 이벤트 핸들러/인라인 스크립트(CSP가 막는 환경이 있다).
