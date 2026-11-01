---
name: NEWTEAM Agent Studio
description: 검정 바탕에 포인트색 하나, 상태는 기호와 글로 읽는 로컬 에이전트 관제 대시보드
colors:
  black: "#000000"
  accent: "#2779a7"
  accent-hover: "color-mix(in srgb, #2779a7 80%, #ffffff)"
  white: "#ffffff"
  gray-950: "#0d0d0d"
  gray-900: "#161616"
  gray-850: "#1f1f1f"
  gray-800: "#2a2a2a"
  gray-700: "#3d3d3d"
  gray-500: "#8a8a8a"
  gray-400: "#a3a3a3"
  gray-200: "#d4d4d4"
  gray-100: "#ededed"
  paper-ink-2: "#333333"
  paper-ink-3: "#595959"
typography:
  brand:
    fontFamily: "'Pretendard Variable', 'Pretendard', 'Inter', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "'Pretendard Variable', 'Pretendard', 'Inter', system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "'Pretendard Variable', 'Pretendard', 'Inter', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
  body:
    fontFamily: "'Pretendard Variable', 'Pretendard', 'Inter', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-dense:
    fontFamily: "'Pretendard Variable', 'Pretendard', 'Inter', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "'Pretendard Variable', 'Pretendard', 'Inter', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
  paper-heading:
    fontFamily: "'Noto Serif KR', 'Nanum Myeongjo', 'Source Han Serif K', Georgia, serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
  paper-body:
    fontFamily: "'Pretendard Variable', 'Pretendard', 'Inter', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
components:
  button:
    backgroundColor: "{colors.gray-850}"
    textColor: "{colors.gray-200}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  button-danger:
    backgroundColor: "{colors.gray-850}"
    textColor: "{colors.white}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  chip:
    textColor: "{colors.gray-400}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 8px"
  input:
    backgroundColor: "{colors.gray-950}"
    textColor: "{colors.white}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.gray-950}"
    rounded: "{rounded.md}"
    padding: "12px"
  popover:
    backgroundColor: "{colors.gray-900}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "16px"
    width: "340px"
  count-badge:
    backgroundColor: "{colors.white}"
    textColor: "{colors.black}"
    typography: "{typography.label}"
    rounded: "11px"
    height: "22px"
  stage-rail-step:
    textColor: "{colors.gray-500}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  stage-rail-step-done:
    textColor: "{colors.gray-400}"
  stage-rail-step-current:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
  stage-rail-step-waiting:
    textColor: "{colors.white}"
---

# Design System: NEWTEAM Agent Studio

## Overview

**Creative North Star: "야간 관제실의 상황판"**

NEWTEAM 대시보드는 오래 띄워 두고 몇 초씩 훑어보는 관제 화면이다. 바탕은 완전한 검정(`black`)이고 그 위에 회색 단계로 면을 아주 조금씩 올린다. 유채색은 포인트색(`accent`) 하나뿐이며, 진행 중인 단계, 섹션의 시작선, 선택된 항목, 활동량 히트맵처럼 "지금 여기"를 가리키는 자리에만 쓴다. 나머지는 흰 글자와 회색 위계로 조용히 흐른다.

상태는 색이 아니라 기호와 글로 전달한다. 정상은 ●, 꺼짐은 ○, 실패는 ✕이고 항상 옆에 문구가 붙는다. 실패를 빨간색으로 칠하지 않고, 흰 글자와 굵기, 흰 테두리 같은 형태로 세운다. 사람이 개입해야 하는 순간(스펙 승인, 교착)만 흰 테두리와 굵은 글씨로 눈에 띄게 하고, 나머지는 평평하게 둔다.

읽기 화면은 다른 재료를 쓴다. 완료 보고서와 파이프라인 개요는 흰 종이(`.paper`) 위의 검은 글자와 명조 제목으로 바뀐다. 어두운 관제와 밝은 문서라는 두 재료가 같은 포인트색 하나로 이어진다.

**Key Characteristics:**
- 검정 바탕, 포인트색 하나(`accent`), 나머지는 무채색 9단계.
- 상태는 ●/○/✕ 기호 + 문구. 색만으로 상태를 말하지 않는다.
- 섹션은 상자 없이 위쪽 2px 포인트색 선과 제목 줄로 나눈다.
- 그림자는 떠 있는 팝오버에만. 나머지는 테두리와 면 단계로 깊이를 만든다.
- 조밀한 글자 단계(12/13/14/16/20px)와 4px 간격 단위.
- 문서 화면은 흰 종이, 검은 글자, 명조 제목.

## Colors

검정 위에 회색 단계를 쌓고, 유채색은 차분한 바다색 계열 파랑 하나만 쓴다.

### Primary
- **관제 블루** (`accent`): 현재 단계 칩의 면(`stage-rail` 현재 단계), 섹션 위쪽 2px 시작선, 기본 버튼 면, 선택된 항목 테두리, 히트맵 최고 단계, 진행 막대, 알림 개수 배지, 사용자 질문 말풍선 면, 체크박스 `accent-color`. 면, 테두리, 굵은 표시에만 쓴다.
- **밝은 관제 블루** (`accent-hover`): 포인트색을 글자나 작은 점으로 써야 할 때의 대체색. 내 차례 항목의 종류 표시(`hs-mail-kind`), 정상 상태 기호 ●, 링크 버튼, 레인 "지금" 표시 글자, 노트 그래프의 점과 선택된 링크, 강조 칩 글자에 쓴다.

### Neutral
- **완전 검정** (`black`, `--bg`): 페이지 바탕, 상단 바, 입력창 안쪽(팝오버 속 입력), 원본 로그 블록 바탕.
- **표면 1** (`gray-950`, `--surface-1`): 카드, 스킬 타일, 보드 목록, 검색 입력, 관제 화면의 패널과 레인.
- **표면 2** (`gray-900`, `--surface-2`): 팝오버, 교착 카드, 주의 카드, 히트맵 빈 칸, 일시정지 배너.
- **표면 3** (`gray-850`, `--surface-3`): 기본 버튼 면, 눌린 세그먼트, 진행 막대 바탕, 알약 수치, 아이콘 버튼 호버.
- **선** (`gray-800`, `--line`): 기본 구분선과 카드 테두리.
- **강한 선** (`gray-700`, `--line-strong`): 버튼, 칩, 입력, 팝오버 테두리.
- **흐린 글자** (`gray-500`, `--ink-faint`): 비활성, 아직 오지 않은 단계, placeholder, 꺼짐 기호 ○.
- **보조 글자** (`gray-400`, `--ink-subtle`): 메타 정보, 섹션 아이콘, 표 머리, 끝난 단계.
- **약한 글자** (`gray-200`, `--ink-muted`): 목록 본문, 상세 문구, 버튼 글자.
- **흰 글자** (`white`, `--ink`): 제목과 주요 글자, 포커스 윤곽선, 실패·주의 상태(`--bad`, `--warn`), 교착 카드 테두리.
- **종이 회색** (`gray-100`, `--p-tint`): 문서 화면의 코드·표 바탕. `gray-200`은 문서 화면에서 가는 선(`--p-hair`)으로도 쓴다.
- **종이 글자 2·3** (`paper-ink-2`, `paper-ink-3`): 문서 화면 본문과 캡션, 표 머리.

### Named Rules
**The One Hue Rule.** 유채색은 `accent` 하나뿐이다. 상태, 카테고리, 장식을 위해 다른 색상을 추가하지 않는다. 히트맵 단계도 `accent`를 `surface-2`에 35/60/80/100%로 섞어 만든다.

**The Accent Is Not Ink Rule.** `accent`는 검정 위 작은 글자 대비가 약 4.4:1이라 본문 글자색으로 쓰지 않는다. 포인트색 글자가 필요하면 `accent-hover`를 쓴다. `accent` 면 위의 글자는 `white`다.

**The Glyph-and-Word Rule.** 상태는 ● 정상, ○ 꺼짐, ✕ 실패 기호와 문구로 전달한다. 성공만 포인트색 계열이고, 실패와 주의는 흰색 + 형태(굵기, 흰 테두리, ✕)로 구분한다(`--ok`, `--bad`, `--warn`).

## Typography

**Body Font:** Pretendard Variable (Pretendard, Inter, system-ui 대체)
**Label/Mono Font:** JetBrains Mono (ui-monospace 대체)
**Document Heading Font:** Noto Serif KR (Nanum Myeongjo, Source Han Serif K, Georgia 대체), 문서 화면 전용

**Character:** 한글이 깔끔한 고딕 하나로 화면 전체를 끌고 가고, 숫자·ID·코드만 모노로 갈라 근거를 기계처럼 보이게 한다. 문서 화면에서만 명조 제목이 들어와 "읽는 종이"로 전환됨을 알린다.

### Hierarchy
- **Brand** (`brand`): 상단 바의 NEWTEAM 워드마크. 화면에서 가장 큰 고정 글자.
- **Figure** (`figure`): 채널 지표 카드의 큰 숫자. 단위는 13px `ink-muted`로 숫자 옆에 낮게 붙인다.
- **Title** (`title`): 홈 섹션 제목(h2), 스킬 옵션 팝오버 제목, 교착 카드 제목.
- **Body** (`body`): 기본 본문(줄 높이 1.5). 내 차례 항목 제목, 보드 이름, 캘린더 합계.
- **Body dense** (`body-dense`): 목록 상세, 버튼, 입력, 팝오버 본문, 시간. 관제 화면의 대부분이 이 크기다.
- **Label** (`label`): 메타, 칩, 단계 레일, 표 머리, 범례, 힌트.
- **Mono** (`mono`): 사용량 수치, 태스크 ID, 원본 로그, 티커, 레인 배지, 문서의 숫자 열.
- **Paper heading** (`paper-heading`): 문서 h1 20px, h2·h3 16px, 명조 700. h2는 위에 1.5px 검은 선을 둔다.

### Named Rules
**The Five Steps Rule.** 글자 크기는 `--fs-12`, `--fs-13`, `--fs-14`, `--fs-16`, `--fs-20` 다섯 단계 안에서 고른다. 예외는 지표 숫자(32px) 하나다.

**The Mono Is Evidence Rule.** 모노는 수치, ID, 원본처럼 기계가 낸 값에만 쓴다. 제목이나 문장에 모노를 쓰지 않는다.

## Layout

간격은 4px 단위(`spacing` 1~6: 4/8/12/16/24/32px)로만 잡는다.

홈은 상단 바 아래 3열 그리드다. 관제 열(`minmax(340px, 36fr)`), 일정·스킬·브레인 열(`minmax(360px, 36fr)`), 채널·기록 열(`minmax(280px, 28fr)`)을 32px 간격으로 두고, 안쪽 여백은 24px, 열 안의 섹션 간격은 24px이다. 상단 바는 화면 위에 붙어(`position: sticky`) 스크롤해도 남는다.

관제 화면(실행 상세)은 `240px 1fr 400px` 3열(태스크 보드 / 레인 / 오른쪽 패널) + 아래 질문 줄이며 간격과 여백은 12px로 더 조밀하다.

반응형 동작:
- 1280px 이하(홈): 관제 열과 가운데 열만 2열로 남고 채널·기록 열은 아래로 내려 자동 채움 그리드가 된다.
- 1279px 이하(관제): 오른쪽 패널이 화면 오른쪽에서 밀려 들어오는 서랍이 된다.
- 1024px 이하: 개요·완료 문서의 옆 열이 아래로 내려간다.
- 768px 이하: 1열. 홈은 내 차례, 진행 중 실행, 캘린더, 채널, 목표, 세컨드 브레인 순으로 다시 정렬한다. 상단 바의 사용량, 부제, 시계는 숨기고, 팝오버는 화면 너비 고정 시트(좌우 8px)가 된다.

### Named Rules
**The My-Turn-First Rule.** 화면이 좁아질수록 "내 차례"와 "진행 중 실행"이 위로 온다. 레이아웃을 바꿀 때 이 순서를 지킨다.

## Elevation & Depth

이 시스템은 평평하다. 깊이는 검정 바탕 위 회색 면 세 단계(`surface-1` → `surface-2` → `surface-3`)와 1px 테두리(`line`, `line-strong`)로 만든다. 그림자는 화면 위에 떠서 다른 내용을 덮는 팝오버에만 쓴다. 상태 표시용 테두리 고리(안쪽 1px 흰 고리, 선택 행의 왼쪽 2px 포인트색 막대, 옵션 칸의 4px 포인트색 고리)는 그림자가 아니라 형태 표시다.

### Shadow Vocabulary
- **팝오버 그림자** (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6)`): 상단 도구 패널(메시지·알림·설정)과 스킬 옵션 팝오버.

### Named Rules
**The Shadow Only Floats Rule.** 카드, 섹션, 버튼에는 그림자를 주지 않는다. 다른 내용 위에 떠 있는 요소만 그림자를 갖는다.

## Shapes

모서리는 작고 일정하다. 버튼, 칩 모양 토글, 세그먼트, 입력, 단계 칩은 6px(`rounded.sm`), 카드, 말풍선, 검색 입력, 보드 타일은 8px(`rounded.md`), 팝오버와 상태 칩은 12px(`rounded.lg`)이다. 검색창, 그룹 필터, 알약 수치, 팝오버 하단 버튼처럼 "고르는" 요소는 완전한 알약(`rounded.pill`)이다. 원형은 개수 배지, 실행 버튼, 상태 점에만 쓴다.

테두리는 1px가 기본이고, 섹션 시작선만 2px 포인트색이다. 문서 화면은 반대로 모서리가 없고(`border-radius: 0`) 1.5px 검은 선으로 상자와 표 머리를 긋는다. 사람이 하는 단계는 점선 테두리로 구분한다.

## Components

### Buttons
도구처럼 작고 단정하다.
- **Shape:** 살짝 둥근 모서리(`rounded.sm`), 1px `line-strong` 테두리.
- **Default** (`button`): `surface-3` 면, `ink-muted` 글자, 13px.
- **Primary** (`button-primary`): `accent` 면과 테두리, 흰 글자. 한 영역에 하나만.
- **Danger** (`button-danger`): 면은 기본과 같고 글자와 테두리를 흰색(`--bad`)으로 바꾼다. 빨간색을 쓰지 않는다.
- **Disabled:** 불투명도 0.5, 기본 커서.
- **Pill footer:** 스킬 옵션 팝오버의 저장·취소는 같은 버튼을 알약 모양에 8px 24px 여백으로 쓴다.
- **Link button:** 12px `accent-hover` 밑줄 글자.

### Chips
- **Style** (`chip`): 투명 면, 1px `line-strong` 테두리, 12px `ink-subtle` 글자, 12px 모서리.
- **State:** 강조는 `accent` 테두리 + `accent-hover` 글자, 실패·주의는 흰 테두리 + 흰 글자. 샘플 데이터 표시는 점선 테두리 알약이다.

### Cards / Containers
- **Corner Style:** 8px(`rounded.md`).
- **Background:** `surface-1`. 교착이나 주의처럼 멈춘 일은 `surface-2`.
- **Shadow Strategy:** 없음. Elevation & Depth 참고.
- **Border:** 1px `line`. 링크 카드는 호버 시 테두리만 `accent`로 바뀐다.
- **Internal Padding:** 12px.

### Inputs / Fields
- **Style** (`input`): `surface-1` 면, 1px `line` 테두리, 8px 모서리, 최소 높이 40px, placeholder는 `ink-faint`. 팝오버 안 입력은 `black` 면 + `line-strong` 테두리, 섹션 머리의 스킬 검색은 알약 모양.
- **Focus:** 전역 2px 흰 윤곽선, 2px 띄움. SVG 노드는 윤곽선 대신 3px 흰 고리.
- **Disabled:** 불투명도 0.6, 금지 커서.

### Navigation
- **상단 바:** 검정 면, 아래 1px `line`. 왼쪽에 NEWTEAM 워드마크와 부제, 프로젝트 선택, 오른쪽에 사용량 막대, 시계, 아이콘 버튼 셋(메시지·알림·설정).
- **아이콘 버튼:** 32px 정사각, 6px 모서리, 18px 선 SVG 아이콘(`stroke-width 1.8`). 호버와 열림(`aria-expanded`) 상태는 `surface-3` 면 + 흰 글자. 개수 배지는 `accent` 면 원형.
- **세그먼트 토글:** 1px `line-strong` 테두리 묶음, 눌린 쪽만 `surface-3` 면 + 흰 글자.
- **탭:** 투명, 선택된 탭은 `accent` 테두리 + 흰 글자.

### Section
홈의 모든 블록이 쓰는 기본 틀.
- 상자 없이 위쪽 2px `accent` 선, 16px 위 여백.
- 제목 줄: 아이콘 자리, 16px 굵은 제목, 12px `ink-subtle` 메타, 필요하면 오른쪽 도구.
- 접히는 섹션은 제목 줄 전체가 버튼이 되고 오른쪽 끝에 접힘 표시가 붙는다.
- 개수 표시(`count-badge`): 흰 원형 배경에 검은 숫자.

### Stage Rail
파이프라인 단계를 한 줄 칩으로 보인다.
- **기본:** 12px `ink-faint` 글자, 6px 모서리, 4px 8px 여백.
- **끝난 단계:** `ink-subtle` 글자.
- **현재 단계:** `accent` 면 + 흰 글자, `aria-current="step"`.
- **내 차례(`is-waiting`):** 면 없이 안쪽 1px 흰 고리(`box-shadow: inset 0 0 0 1px`), 흰 굵은 글자, 라벨 뒤에 " · 내 차례" 문구. 진행 중(면)과 사람 대기(고리)를 형태로 구분한다.

### Inbox Row (내 차례)
- 2열 행, 아래 1px `line`. 종류는 12px 굵은 `accent-hover`, 제목 14px 600, 상세 13px `ink-muted`.
- **교착:** 목록의 한 줄이 아니라 멈춘 일로 세운다. `surface-2` 면, 1px 흰 테두리, 8px 모서리, 제목 16px로 키우고 줄바꿈 허용, 종류 앞에 ✕, 모든 글자 흰색.

### Popovers
- **상단 도구 패널** (`popover`): 버튼 아래 오른쪽 정렬, 너비 340px(넓은 판 420px), 최대 높이 `min(70vh, 560px)`, `surface-2` 면, 1px `line-strong` 테두리, 12px 모서리, 팝오버 그림자. 머리는 14px 굵은 제목 + 12px 보조.
- **스킬 옵션:** 네이티브 `popover="auto"` 대화상자를 누른 버튼 위치에 고정한다. 너비 `min(520px, 100vw - 16px)`, 24px 안쪽 여백. 옵션 격자의 칸은 6px 점이고, 호버 시 10px, 선택 시 30px 흰 원 + 4px `accent` 고리가 된다. 닫히면 포커스를 누른 버튼으로 돌려준다.

### Data Marks
- **진행 막대:** 6px 높이 알약, `surface-3` 바탕 위 `accent` 채움. 상단 사용량 미터는 40×4px, `ink-subtle` 채움.
- **활동 히트맵:** 3px 모서리 정사각 칸, `surface-2`에서 `accent`까지 4단계 혼합. 오늘은 가운데 5px 흰 점, 선택은 2px 흰 윤곽선.
- **페이지 점:** 8px 점, 현재 페이지는 24px 흰 막대. 누르는 영역은 24px.

### Paper Document
완료 보고와 파이프라인 개요의 읽기 면. 흰 종이, 검은 글자, 명조 제목, 모서리 없는 1.5px 검은 선 상자. 단계 상자는 끝남 2.5px 선, 현재 `--p-now` 테두리 + 2px 고리, 사람 단계와 실패는 점선. 링크와 현재 표시만 `accent`.

## Do's and Don'ts

### Do:
- **Do** 유채색이 필요하면 `accent` 하나로 해결하고, 단계가 필요하면 `surface-2`와 섞는다.
- **Do** 포인트색 글자는 `accent-hover`로, `accent` 면 위 글자는 `white`로 쓴다.
- **Do** 상태마다 ●/○/✕ 기호와 문구를 함께 붙인다.
- **Do** 홈 블록은 Section 틀(위쪽 2px `accent` 선 + 제목 줄)로 시작한다.
- **Do** 사람이 처리할 일은 흰 테두리·굵은 글씨로 세우고(교착 카드, 단계 레일 `is-waiting`), 진행 중인 일은 `accent` 면으로 표시한다.
- **Do** 아이콘은 `currentColor` 선 SVG(18px, `stroke-width 1.8`)로 그린다.
- **Do** 전환은 `--dur`(200ms)로 색·면·테두리에만 주고, `prefers-reduced-motion`에서는 모두 끈다.

### Don't:
- **Don't** 두 번째 유채색(빨강, 초록, 노랑 등)을 상태 표시용으로 들이지 않는다.
- **Don't** `accent`(#2779a7)를 12~14px 본문 글자색으로 쓰지 않는다.
- **Don't** 색만으로 상태를 구분하지 않는다.
- **Don't** 섹션을 테두리 상자나 그림자 카드로 감싸지 않는다.
- **Don't** 팝오버가 아닌 요소에 드롭 그림자를 주지 않는다.
- **Don't** 관제 화면에 종이 재료(흰 면, 명조 제목)를 섞지 않는다. 종이는 읽기 화면 전용이다.
