# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
React + Vite (대시보드). 오케스트레이터는 Node/TypeScript. 대시보드는 오케스트레이터에서 SSE로 실시간 이벤트를 받고, REST로 사용자 입력을 보낸다. 로컬 전용 실행.

## Users
에이전트 파이프라인을 직접 운영하는 1인 사용자(제품 기획·개발 실무자). 프로젝트를 맡긴 뒤 진행 상황을 관제하고, 스펙 승인과 교착 해결처럼 사람이 필요한 순간에만 개입한다. 데스크톱 브라우저에서 장시간 띄워 두고 수시로 확인한다.

## Product Purpose
프로젝트를 요구사항 수집부터 완료까지 역할별 AI 에이전트가 수행하게 하는 로컬 시스템. Claude가 작업하고 ChatGPT(Codex)가 읽기 전용으로 검수하며, 승인이 날 때까지 수정 루프를 돈다. 대시보드의 성공 기준은 "지금 무엇이 진행 중이고, 어디서 막혔고, 내가 할 일이 있는지"를 몇 초 안에 파악할 수 있는 것과, 모든 의사결정의 근거(사람용 요약과 AI 원본)를 추적할 수 있는 것이다.

## Positioning
서로 다른 모델 간 교차 검증(Claude 작업 / GPT 판정)과 증거 강제 하네스를 쓰며, 모든 에이전트 간 메시지가 하나의 중계자를 거쳐 사람용 기록과 원본(raw) 로그로 분리 저장된다. 의사결정 과정 전체가 실시간으로 보인다.

## Operating Context
- 흐름: INTAKE → SPEC 승인(사람) → SEED → PLAN ⇄ GPT 검수 → BUILD(병렬, 기본 3) ⇄ QA + GPT 검수 → INTEGRATE → FINAL_QA → REPORT. 위키는 태스크 승인마다 갱신한다.
- 역할: 마스터(Opus), 기획(Opus/Sonnet), 개발 ×N(Sonnet, 교착 시 Opus), QA(Sonnet + Playwright), 검수(GPT, Codex CLI 읽기 전용, 예비로 OpenAI API mini), 위키(Haiku).
- 메시지 7종: ASSIGN, ESCALATE/GUIDANCE, REPORT, REVIEW_REQUEST, REJECT, REVISION, APPROVE. 상태 이벤트: PAUSED, RESUMED, STATE_CHANGE.
- 교착 규칙: 반려 3회 또는 같은 지적 ID 2회 반복이면 마스터에게 ESCALATE하고, 해결되지 않으면 사람에게 넘긴다.
- 과금: Claude와 ChatGPT 모두 구독제 CLI. 사용량 한도에 걸리면 PAUSED로 바꾸고 리셋 후 재개한다. OpenAI API 크레딧은 $10이며 누적 $8에서 하드 캡을 건다.
- 저장: projects/<name>/human/(intake, spec, plan, iterations, evidence, timeline, decisions, wiki, report)과 raw/(events.jsonl, prompts, sessions), state.json.
- 메신저: 텔레그램, 2차 연동(알림 + 승인 버튼 + 진행 요약).

## Capabilities and Constraints
- 1차 도메인 팩은 웹앱 개발이다. 콘텐츠/SNS, 리서치/문서, 범용 업무는 이후 팩으로 붙인다.
- 사람이 개입하는 지점: 스펙 승인, 교착. 그 밖에는 자동으로 진행한다.
- 마스터에게 로그에 관해 자연어로 질문할 수 있다(timeline을 먼저 보고, 필요한 raw 메시지만 ID로 조회).
- 미정: 다중 프로젝트 동시 실행 여부.

## Evidence on Hand
아직 실제 실행 데이터, 캡처, 사용자 사례는 없다. 목업에는 가상의 데이터임을 명시하고, 실적이나 수치를 지어내지 않는다.

## Product Principles
1. 관제가 먼저다: 화면의 1순위는 진행 상태, 막힌 곳, 내 차례 여부다.
2. 주장보다 증거: 완료나 승인 표시에는 항상 근거(테스트, 캡처, 판정)가 연결된다.
3. 사람용과 원본은 분리하되 서로 연결한다: 요약에서 원본으로 한 번에 이동할 수 있다.
4. 개입은 드물고 분명하게: 사람이 필요한 순간만 눈에 띄게 하고, 나머지는 조용히 흐르게 한다.
5. 비용이 보인다: 토큰, 사용량 한도, API 지출이 늘 보인다.
