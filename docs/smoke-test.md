# 실제 CLI 스모크 테스트

2026-10-27에 사용자 승인으로 실제 CLI 호출을 실행했다. 첫 Claude 호출은 이미 소진된 구독 한도로 중단됐고, 같은 프로젝트를 마스터·작업 AI 모두 Codex로 설정해 재개했다. 최종 상태는 **DONE** (`msg-0059`)이다. 프로젝트와 원본은 로컬 `orchestrator/projects/todo-smoke/`에 보존했다. 원격 푸시는 하지 않았다.

## 실행 방법

Node.js ≥22.12, git, 로그인된 Claude Code 또는 Codex CLI가 필요하다. `orchestrator/`에서 빌드하고, [AI 설정 방법](agent-configuration.md)에 따라 설정 파일을 만든다. 다음 명령은 기존 프로젝트를 현재 단계부터 재개한다.

```powershell
npm run build
node dist/cli.js configure --master codex --worker codex --output codex.json
node dist/cli.js --config codex.json serve todo-smoke
```

서버는 `http://127.0.0.1:4317`에만 바인딩한다. `GET /api/state`, `GET /api/events`, `GET /api/agents`로 상태를 확인한다. SSE는 `GET /api/stream`과 `Last-Event-ID`로 누락 이벤트를 재생한다. 요구사항은 `POST /api/chat`, 스펙 승인은 `POST /api/spec/approve`로 보낸다. 정지 원인은 `POST /api/ask`에 질문을 보내 확인한다. 사람 요청은 `POST /api/human/<eventId>`의 지침 또는 건너뛰기로 처리한다. 실행 중 CLI 구독 한도가 50%를 넘으면 운영자가 중단한다. 자동 테스트는 가짜 러너와 픽스처만 사용한다.

## 실제 결과

| 기준 | 결과와 원본 근거 |
|---|---|
| 한 페이지 할 일 앱 완료 | **완료.** `msg-0052` 개발 승인, `msg-0053` 병합, `msg-0057` 최종 QA 승인, `msg-0059` DONE. [최종 보고서](../orchestrator/projects/todo-smoke/human/report.md) |
| 반려 → 수정 → 승인 | **확인.** 계획 `msg-0013` 반려 → `msg-0015` 수정 → `msg-0017` 승인. 개발 `msg-0042`·`msg-0046` 반려 → `msg-0050` 수정 → `msg-0052` 승인. [이벤트 요약](../orchestrator/projects/todo-smoke/human/evidence/smoke-summary.json) |
| 브라우저 QA | **확인.** 작업 QA 각 회차 10개 시나리오·18개 PNG, 최종 QA 10개 시나리오·24개 PNG. 최종 캡처가 병합 커밋 이후인지 `verifyEvidence`로 독립 재검증해 통과했다. [최종 manifest](../orchestrator/projects/todo-smoke/human/evidence/final/r1/manifest.json) |
| 자동 테스트 | **통과.** 오케스트레이터 24파일·225테스트, 타입 검사·빌드. 병합된 앱의 `npm test` 7개 통과. |
| “왜 멈췄어?” 로그 질의 | **확인.** 과거 한도·권한·설정 정지와 당시 FINAL_QA 진행 상황을 이벤트 ID에 근거해 답했다. [질의 응답](../orchestrator/projects/todo-smoke/human/evidence/ask-why-paused.md) |
| 중단 후 재개 | **확인.** Claude 한도 중단 프로젝트를 Codex 설정으로 재개했다. 강제 종료·복원은 가짜 러너 회귀 테스트로 검증했다. |
| 대시보드 | 계획 2 범위이며 구현·검증 전이다. |

이번 실행은 **스펙 승인 1회만으로 무인 완료**한 사례는 아니다. 초기 개발·QA 권한과 CLI 옵션 충돌, 증거 부족으로 `msg-0023`, `msg-0028`, `msg-0036`에서 사람 개입이 필요했다. 제어 코드와 프롬프트를 수정하고 실제 근거를 제공해 재개했다. 최종 보고서가 생성될 때는 REPORT 단계였고, 이후 `msg-0059`로 DONE이 기록됐다. 원본 이벤트는 수정하지 않았다.

앱은 빈 값 거부, Enter·버튼 추가, 앞뒤 공백 제거, 완료 전환, 개별 삭제, 새로고침 후 복원, HTML 문자열의 텍스트 표시를 실제 브라우저에서 확인했다. 최종 QA에서는 브라우저 정책상 localStorage 내부 값을 직접 조회하지 못했으므로 새로고침 전후 화면으로 복원을 검증했다. 개발 4·5회차의 테스트 선행 증거 반려는 원본 세션에서 테스트 추가 → 구현 모듈 부재 실패 → 구현 추가 → 6개 통과 순서를 확인해 해결했다. 구현 전 실패는 모듈 로딩 실패이며 개별 assertion 실행 증거는 아니다. 7번째 테스트의 선행 작성도 주장하지 않는다.

## 사용량과 한계

첫 Claude Code 2.1.310 호출은 2026-10-27 10:50 KST에 five_hour 100%로 거부됐다. 구조화 이벤트의 초기화 예정 시각은 14:30 KST였고 원본 `msg-0002`에는 당시 파서의 잘못된 11:50 KST 대기가 보존돼 있다. 파서는 `resetsAt`을 우선하도록 수정했다. 이후 실호출은 Codex CLI 0.163.0으로 수행했다. OpenAI API 예비 모델은 호출하지 않았고 프로젝트의 API 누적 지출은 $0이다. CLI 구독 사용량을 달러 비용으로 환산한 값은 아니다.

원본 `turn.completed` 중 입력 토큰이 0보다 큰 호출만 사용해 호출별 `cached_input_tokens / input_tokens`을 구하고 역할별 산술평균을 계산했다. [전체 집계](../orchestrator/projects/todo-smoke/human/evidence/smoke-summary.json):

| 역할 | 완료 호출 | 평균 캐시 비율 |
|---|---:|---:|
| master | 5 | 61.6% |
| planner | 2 | 60.1% |
| dev | 6 | 94.5% |
| qa | 4 | 90.2% |
| reviewer | 5 | 12.7% |
| wiki | 1 | 36.2% |
| logQuery | 1 | 32.3% |
| seed | 2 | 51.9% |

이 수치는 이번 프로젝트의 실제 CLI 기록이며, 최초 거부된 Claude 호출은 입력 토큰 0으로 평균에서 제외했다. 작업 중 제한된 환경의 `npm test`는 `spawn EPERM`이었지만, 권한이 허용된 환경에서 같은 명령이 7개 통과했다. 이 차이와 복구 과정은 [최종 보고서](../orchestrator/projects/todo-smoke/human/report.md)에 기록돼 있다.
