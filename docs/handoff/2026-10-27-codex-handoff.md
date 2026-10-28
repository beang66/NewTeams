# 작업 인계: 오케스트레이터 코어 (계획 1/2) — Codex용

- 작성: 2026-10-27, Claude Code 세션(사용량 한도 직전)
- 저장소: `C:\myproject\New-teams\orchestration-platform`, 브랜치 `orchestrator-v2` (원격 `origin` = github.com/beang66/NewTeams)
- 원격 `main`은 별개 프로젝트(NewTeams Studio)이므로 **건드리지 말 것**

## 1. 먼저 읽을 문서 (이 순서)
1. 스펙(최종 권위): `docs/superpowers/specs/2026-10-26-agent-orchestrator-design.md`
2. 구현 계획: `docs/superpowers/plans/2026-10-26-orchestrator-core.md` — 태스크 14개, 각 태스크의 Interfaces/테스트가 계약
3. CLI 실제 동작 기록: `docs/cli-contract.md` (claude 2.1.310, codex-cli 0.163.0에서 녹화)
4. 진행 기록(ledger): `.superpowers/sdd/2026-10-26-orchestrator-core/progress.md` — git에는 없음(ignored), 로컬 파일. 모든 판단(Ruling R1~R20)과 미뤄 둔 사소한 지적이 여기 있음
5. 태스크별 요구사항/보고서: 같은 폴더의 `task-N-brief.md`, `task-N-report.md`

## 2. 최신 변경: 사용자 선택형 마스터/작업 AI (2026-10-27)

- 사용자 요청으로 마스터/작업 AI를 각각 Claude/Codex 및 모델·상향 모델로 설정할 수 있게 구현했다. [설정 문서](../agent-configuration.md), `orch configure`, `GET /api/agents`, 예제 JSON 참고.
- 기본값은 기존 Claude 역할 모델이며, 검수 판정은 계속 GPT다. Codex 작업/QA는 자동 승인 검토(workspace-write), 마스터/기획/검수 등은 read-only. Codex 기획/작업 시드와 제공자별 세션을 분리했다.
- 실제 all-Codex 스모크는 기존 `orchestrator/projects/todo-smoke`에서 DONE(`msg-0059`)에 도달했다. 로컬 설정은 `.superpowers/codex-smoke.json`이며 첫 Claude 한도 시도 이후 원본을 모두 유지했다.
- Windows 실행 권한, 상호 배타 CLI 옵션, 마스터 오류 상세 누락, 프롬프트 계약 누락, Playwright 로그의 앱 파일 혼입을 실제 실행으로 확인해 수정했다. 선택적으로 `restartSession:true`로 작업 세션을 복구할 수 있다.
- 작업 QA는 Chromium에서 localStorage 직접 조회를 포함해 10개 시나리오와 회차당 PNG 18장을 생성했다. 최종 QA는 10개 시나리오·PNG 24장으로 병합 이후 촬영 조건을 통과했다. GPT의 TDD 증거 부족 반려 후 마스터가 원본 dev 로그 9→13→18행을 조회해 지침을 냈고 6회차 승인·병합·최종 승인·보고서가 완료됐다. `/api/ask`의 이벤트 근거 답변도 확인했다. 초기 권한·옵션·증거 문제 때문에 스펙 승인 1회만의 무인 완료 기준은 미충족이다.
- 전체 24 files / 225 tests 통과 (`--maxWorkers=1 --testTimeout=30000`), 타입 검사·빌드 통과. 마지막 마스터 원본 조회 프롬프트는 별도 스냅샷 테스트 통과.
- `DESIGN.md`의 별도 사용자 변경은 계속 보존한다. 원격 푸시 없음. 상세 수치와 제한은 [smoke-test.md](../smoke-test.md) 참고.

## 2-1. 이전 Task 13 완료 시 상태 (이력)

- Task 1~11: 기존 완료 상태 유지.
- Task 12: a858c28 재검토 완료. 승인된 자식이 미병합 부모(사람 대기)를 앞질러 병합되는 경로를 회귀 테스트로 재현하고 수정했다. 병렬 태스크가 wiki/merge 대기 중 실패해도 unhandled rejection이 발생하지 않도록 즉시 catch를 연결했다.
- Task 13: HTTP/SSE 서버, 콘솔 Notifier, `orch new/chat/serve`, JSON 설정 파일 옵션, 스모크 절차 구현 완료. 검증 결과는 아래 기록 및 로컬 ledger 참고.
- 이연 항목 중 수정: `commitHuman`에 unrelated staged 파일이 섞이던 문제, 중복/경로로 부적합한 태스크 id 검증 누락.
- Task 14 실제 Claude 호출 1회가 구독 한도 100%로 거부되어 중단됐다. 실제 Codex 검수/OpenAI 호출 및 원격 푸시는 하지 않았다. 자세한 실행 증거는 smoke-test.md 참고.

### Task 13 계약 보완

- `GET /api/prompts/:id`는 이벤트 id를 해당 이벤트의 `promptRef`에 연결한다. 기존 저장 파일명(예: `plan-r1-planner`)도 허용한다. 기존 raw 파일을 개명하거나 수정하지 않는다.
- SSE는 구독을 먼저 연결한 뒤 과거 이벤트를 재생하고 id로 중복을 제거한다. 전송 버퍼 역압을 기다리며, 서버 종료 시 열린 SSE 연결을 정리한다.
- 최초 specDraft가 생성된 CHAT payload에 `specApprovalRequired: true`를 기록해 Notifier가 승인 대기를 알린다.
- 실행 드라이버는 한 번에 하나만 동작한다. 서버의 백그라운드 워크플로 실패는 콘솔 및 `HUMAN_REQUIRED(reason=workflow_error)`로 드러난다.
- 서버는 `127.0.0.1`에만 바인딩한다. CLI `serve`는 현재 단계를 자동 재개한다. `chat /approve`는 승인을 저장하고 종료하며 실제 BUILD는 `serve`에서 시작한다.
- `--config <path>`로 JSON 설정을 읽는다. 프로젝트 상대 경로는 실행 디렉터리 기준이다.

### Task 14 시도 후 수정 검증

- 한도 파싱 수정 후 `npm test -- --maxWorkers=1 --testTimeout=30000`: 23 files / 214 tests 통과. 타입 검사·빌드 통과.
- 기본 병렬 실행은 기존 workspace git 충돌 테스트 2개가 5초 제한을 초과했다. 해당 테스트 코드는 변경하지 않았다.
- 실제 원본 raw 재생으로 파서/비정상 종료 경로 모두 정확한 초기화 시각(14:30 KST)을 확인했다.

### Task 13 완료 시 로컬 검증

- Node v24.22.1, `npm test`: 23 files / 210 tests 통과.
- `npx tsc --noEmit`, `npm run build`, 빌드된 CLI `--help`: 통과.
- 빌드된 CLI로 임시 프로젝트 `new → serve → GET /api/state` 확인: INTAKE 응답, 실제 모델 호출 없음.
- 작업 중 별도로 변경된 루트 `DESIGN.md`의 표 정렬은 보존하고 이 작업 커밋에서 제외했다.

## 3. 남은 작업

1. **Task 14:** 실제 all-Codex 재개로 DONE에 도달했다. 59개 이벤트, 계획/개발 반려→수정→승인, 앱 병합, 최종 QA 10시나리오·24캡처, `/api/ask`, 보고서를 확인했다. 초기 Claude 한도와 실행 중 복구 지침 때문에 스펙 승인 1회만의 무인 완료는 미충족이다. [smoke-test.md](../smoke-test.md)에 증거와 캐시 수치를 기록했다.
2. **대시보드 계획 2:** 별도 후속 작업. 레인, 사람용/원본 전환, 주의 카드는 아직 구현하지 않았다.
3. **푸시 이력:** 2026-10-27 사용자 요청으로 로컬 경로를 익명화하고 미게시 변경을 한 커밋으로 정리해 `orchestrator-v2`에 푸시한다. 원래 30커밋은 로컬 `codex/pre-push-20261027`에 보존한다. `main`은 별개 프로젝트이므로 건드리지 않는다.

### 검토 후 남긴 minor/제약

- 병렬 풀 실패 시 끝까지 완료된 형제 태스크의 wiki 갱신은 건너뛸 수 있다. 승인 결과는 재시작 시 병합된다.
- wiki/merge를 기다리는 동안 새 태스크 디스패치가 지연될 수 있다. workflow.ts 분리는 후속 유지보수 항목이다.
- CLI 강제 종료 시 자식 모델 CLI까지 종료됐는지 확인해야 한다. 현재 러너 취소는 timeout 중심이다.
- 기존 의존성 commander 15는 Node ≥22.12를 요구한다(초기 스펙의 Node ≥20과 차이). 이 세션 검증은 설치된 Node에서 수행했으며 Node 20 호환성을 주장하지 않는다.
- CLI 로그인·실제 한도 정지·all-Codex 성공 실행·역할별 캐시 비율은 확인했다. 한도 오류의 재개 시각 파싱은 구조화된 resetsAt 기준으로 수정했다. OpenAI 예비 모델 호출은 여전히 미검증이다.
- 나머지 초기 ledger의 minor는 자동으로 해결됐다고 간주하지 않는다.

## 4. 작업 방식 (이전 세션에서 지켜 온 규칙)
- 계획의 각 태스크: 실패하는 테스트 먼저(RED 확인) → 구현 → 테스트 통과 → 커밋. 커밋 메시지 끝에 `Co-Authored-By:` 줄을 붙여 왔음(Codex는 자기 규칙에 맞게).
- 테스트에서 실제 CLI·OpenAI API를 절대 호출하지 않음(FakeRunner, 가짜 실행 파일 사용).
- 프롬프트는 항상 stdin으로 전달(Windows 명령줄 길이 제한).
- 시스템은 자격 증명을 입력·저장하지 않음. OpenAI 키는 `OPENAI_API_KEY` 환경 변수에서만.
- `raw/events.jsonl`은 추가만, 수정 금지.
- 검수(판정)는 항상 GPT(Codex CLI, `--sandbox read-only`). Claude가 판정하는 경로 없음.
- 판단이 필요하면 스펙을 기준으로 결정하고 ledger에 `Ruling: <결정> — <이유> — <틀리면 비용>` 형식으로 남김.

## 5. 사용자에게 확인이 필요한 미결 사항
- **기록 보존**: 초기 녹화 원본의 실제 PC 경로가 포함된 과거 커밋은 로컬 백업 브랜치에만 보존한다. GitHub로 보낼 현재 스냅샷의 해당 경로는 `USER`로 익명화했다.
- 사용자의 `/remote-control` 문의는 Codex 원격 접속 방법 확인이었고, 공식 문서에 따른 PC 설정·QR 연결 방법을 안내했다. 푸시 요청은 아니다.
- OpenAI 예비 모델 `gpt-5-mini`는 키가 없어 실제 확인 안 됨.
