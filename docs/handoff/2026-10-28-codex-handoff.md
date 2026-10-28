# 작업 인계 (2026-10-28) — Claude Code → Codex

이전 인계 문서([2026-10-27-codex-handoff.md](2026-10-27-codex-handoff.md))는 오케스트레이터 코어 단계의 기록이다. **지금 상태와 다음 할 일은 이 문서가 기준이다.**

- 저장소: `C:\myproject\New-teams\orchestration-platform`, 브랜치 `orchestrator-v2`
- 원격 기준은 `4633ab8`이며 이후 구현은 로컬 커밋이다. 정확한 차이는 `git status -sb`, `git log origin/orchestrator-v2..HEAD`로 확인한다. 원격 `main`은 별개 프로젝트이니 건드리지 말 것. 푸시는 사용자 확인 후에만.
- 작업 트리의 `DESIGN.md` 변경(표 구분선 서식)은 이 작업과 무관하다. 커밋하지 말 것.

## 1. 한눈에 보는 진행 상황

| 계획 | 문서 | 상태 |
|---|---|---|
| 계획 1: 오케스트레이터 코어 | `docs/superpowers/plans/2026-10-26-orchestrator-core.md` | ✅ 완료. 실제 CLI 스모크(전부 Codex 설정)로 DONE 확인: `docs/smoke-test.md` |
| 계획 2: 대시보드 | `docs/superpowers/plans/2026-10-27-dashboard.md` | 별도 작업에서 재개됨. `1d1037e`까지 보드·레인·상세/주의 패널 커밋을 확인했다. 최신 상태는 해당 ledger와 git log가 기준 |
| 사용자 시나리오 | `docs/scenarios/2026-10-28-user-scenarios.md` | ✅ 작성 완료(사용자 리뷰 전). 와이어프레임 대조 표 §6 포함 |
| 와이어프레임 | `docs/wireframes/dashboard-wireframes.html` | ✅ 9+1 화면. 2-1(파이프라인 개요)·3(사람용)·7(완료)은 문서(paper) 형식. **시나리오 §6의 수정 사항은 아직 미반영** |
| 계획 3: 텔레그램 | `docs/superpowers/plans/2026-10-28-telegram.md` | Task 1~7 구현·검토 완료. Task 8 실제 계정·휴대폰 연결 확인은 사용자 설정/승인 대기 |
| 작업 팩 통합 | `docs/work-pack-integration-2026-10-28.md` | ✅ 관계·계약, 리서치·리포트 이식, 웹앱 교차 검수, 콘텐츠·IP 기획 팩 완료. CLI/API/UI 연결은 후속 범위 |
| 화면 통합 기준 | `docs/ui-integration-criteria.md` | ✅ 이전 업무 UI와 현재 관제 UI의 정보구조·화면별 합격 기준·모션·접근성·성능·UI-01~14 검수 기준 정의 |

검증 이력: Codex가 타입 검사·빌드 및 337개 전체 테스트를 통과했고, 별도 controller가 `b6606ad`의 348개 통과를 기록했다. 최종 종료 보완은 가짜 자식 프로세스를 사용하는 관련 5파일/31테스트·타입 검사·빌드·재검토를 통과했다. 마지막 전체 회귀 결과는 아래 최신 검증 절과 로컬 ledger에 기록한다. 실제 Telegram/모델 호출은 하지 않았다.

## 2. 완료한 텔레그램 작업 — 다시 구현하지 말 것

초기 인계의 Task 5 WIP는 `dbf7106`으로 완료했다. Task 6 봇은 `e9df777`, Task 7 CLI 연결·S8·설정 안내는 `310628a`, 인증 재개·재시작 복구·URL 제한 보완은 `b6606ad`에 있다. 기존 파일을 되돌리거나 초기 WIP부터 다시 만들지 않는다.

- HTTP와 봇이 같은 WorkflowActions를 공유한다. 중복 응답은 충돌이며, ask는 수신 루프와 변경 큐를 막지 않는다.
- 봇은 허용 채팅만 처리하고, 확인·지침·상세 캡처·명령·재시작 offset을 지원한다. 전송 경계에서 비밀값·코드 블록·diff·원본 프롬프트 경로를 걸러낸다.
- 실제 CLI의 종료 신호는 새 하위 작업 시작을 막고 자신이 만든 러너/하네스 자식 트리만 종료한 뒤 끝낸다. HTTP/봇 정리는 3초까지 기다리며, 자식 종료 성공 전 부모를 강제 종료하지 않는다. 임베디드 `app.close()` 자체가 워크플로 취소 API인 것은 아니다.
- 실제 계정 확인 안내: [telegram-setup.md](../telegram-setup.md). 다른 작업의 대시보드 변경과 별도 DESIGN.md 수정은 보존했다.

**R-TG5 (Task 5에 적용할 결정):**
- 동작을 바꾸지 않는 리팩터다. 기존 `test/server/http.test.ts`는 수정 없이 통과해야 한다(`buildServer` 호출 방식만 불가피하면 조정).
- `createWorkflowActions(wf, onDriveError)`: chat·approveSpec·answer는 **하나의 Promise 큐**로 직렬화한다(실패한 동작이 큐를 막으면 안 됨). `ask`와 게이트의 `resume`은 큐 밖이다. 인증 대기 중 chat이 큐를 잡을 수 있으므로 resume까지 직렬화하면 영구 대기가 된다. approveSpec·answer·resume 성공 후 단일 실행 드라이버를 호출한다.
- 기존 409 판별 정규식 `/INTAKE|스펙 초안|열린 HUMAN_REQUIRED/`에 맞는 에러는 `ActionConflict`로 바꾼다(메시지 유지).
- "같은 HUMAN_REQUIRED에 두 번 답하면 두 번째는 충돌" 테스트는 `Workflow.answerHuman`이 이미 해결된 ID에 충돌 에러를 던지는지에 기대고 있다. 그렇지 않다면 Workflow를 몰래 고치지 말고 사용자에게 알릴 것.
- `buildServer(wf, { actions?, telegramStatus?, resume?, dashboardDir? })`. `actions`가 없으면 내부에서 기존 `workflow_error` HUMAN_REQUIRED 발행 동작으로 만든다. `GET /api/telegram` → `telegramStatus?.() ?? { state: 'off' }`.
- `cli.ts serve`는 actions를 한 번 만들어 서버에 넘긴다(Task 7에서 봇에도 넘김).

## 3. 바로 다음 — 텔레그램 Task 8 실제 확인

Task 6~7은 완료됐다. 사용자가 BotFather에서 봇을 만들고 실행 터미널에 환경 변수를 직접 설정한 다음 실제 API 호출을 승인해야 Task 8을 진행한다. 에이전트에게 토큰이나 chat id 값을 보내지 않는다. 준비 후 `orch telegram-check`로 연결 메시지를 확인하고, 기존 DONE 스모크 프로젝트로 `/status`, `/tasks`, `/report`를 확인한다. 새 AI 작업이나 `/ask`는 별도 명시 승인 없이 실행하지 않는다. 확인한 결과만 문서에 기록한다.

계획 문서의 각 태스크를 그대로 따른다. 이 결정들은 계획 문서 밖에서 내렸으니 반드시 반영한다:
- **R2 (Task 6):** 기존 `attachNotifier`는 HUMAN_REQUIRED, STATE_CHANGE(stage), PAUSED, CHAT(spec)만 넘긴다. 봇에는 RESUMED와 APPROVE도 필요하다 → `attachNotifier(bus, notifier, types?: MessageType[])` 세 번째 인자를 추가하고, 봇은 `NOTIFY_TYPES + ['RESUMED','APPROVE']`로 붙인다(기존 필터 규칙 유지).
- **Task 4 결과 (Task 6이 쓸 것):** `BotApi` 생성자는 `(token, apiBase, { fetchImpl?, sleep?, timeoutMs? })`. 호출자가 abort하면 `TelegramApiError(method, 0, 'aborted')` → 정상 종료로 취급할 것. 타임아웃은 `'timeout'`.
- **Task 3 결과:** `Outbox`는 `push`(동기, 절대 throw 안 함), `flush()`, `stop()`, `size()`, `pendingLoud()`. 전송마다 15초 제한. stop 후 push는 무시.
- **R3 (Task 8):** 실제 텔레그램 확인은 사용자가 봇을 만들고 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 설정한 뒤에만. **에이전트는 토큰을 입력하거나 보지 않는다.**

## 4. 대시보드 초기 인계 이력 (별도 작업의 최신 ledger 우선)

아래 목록은 최초 인계 시점의 대기 항목이다. 이후 다른 작업이 대시보드 구현을 재개했으므로 현재 git log·테스트·해당 계획 ledger와 대조하고 완료된 일을 반복하지 않는다. 이번 Codex 텔레그램 마무리에서 대시보드 기능의 완료 여부를 다시 판정하지 않았다.
1. Task 3(`dashboard/src/api/client.ts`, `useRun.ts`, `test/fakes.ts` 등 — `4633ab8`에 포함)은 **리뷰를 받지 않았다.** 계획 Task 3 요구사항으로 리뷰부터 할 것.
2. 시나리오 문서 §6 대조 표를 와이어프레임과 대시보드 계획에 반영한 뒤 Task 4부터 진행: "마지막 확인 이후" 요약 줄, "이미 처리됨" 상태, 건너뛰기 시 의존 태스크 안내, 묻기 사용량 표시, 보고서 내보내기, 텔레그램 연결 칩(`GET /api/telegram`), 레인 시간 창 3단계 등.
3. 문서 영역(paper) 토큰을 DESIGN.md "문서 영역 보완" 절로 추가할지는 사용자 결정 대기.
4. Task 10(E2E)은 상태별 테스트 대신 시나리오 S1~S7 흐름 테스트로 바꾸자는 제안이 있다(시나리오 §7).

## 5. 판단 기록 (로컬 ledger 요약)

진행 기록 원본은 git 밖(`.superpowers/sdd/<계획>/progress.md`)에 있다. 같은 폴더에서 이어 가면 읽을 수 있다. 핵심만 옮긴다.

**대시보드 계획:** R1 `@orch/*` 별칭 → `../orchestrator/src/*`(bundler 해석) + zod 의존성 · R2 Task 11(실서버 확인)은 사용자 확인 후, `/api/ask`는 명시 승인 시에만 · Task 1 폰트는 `Pretendard Variable` 동적 서브셋 · Task 2 정적 서빙은 시작 시 파일 목록을 고정(빌드 후 재시작 필요).

**텔레그램 계획:** R1 humanRenderer는 `reasonLabel` export만 허용 · R2 위 §3 · R3 위 §3 · Task 1 버튼 데이터는 Map 기반 자기 키 조회(`toString:` 등 → null), `pollTimeoutSec` 정수 ≥1, URL 검증 · Task 2 `sanitize`는 코드 블록·diff 본문까지 통째로 제거, 한 줄 200자 제한, 사유 없으면 `알 수 없음`.

**미뤄 둔 사소한 지적(브랜치 최종 리뷰에서 고를 것):**
- 텔레그램: URL 스킴 제한, 스펙 분할 코드 블록, API 본문 읽기 중 abort/timeout 분류는 이후 수정했다. 남은 minor는 diff 필터가 `--- ` 뒤 일반 목록을 지울 수 있음 · Outbox의 15초 타이머 및 in-flight flush 의미 · 가짜 서버 `photoBytes` 필드명 검증 · 짧은 chat id 치환이 오류 문구 일부를 바꿀 수 있음이다. 실제 CLI 종료는 별도의 종료 경로로 보완했다.
- 대시보드: tsconfig include에 `e2e/` 없음 · `/api`(슬래시 없음)가 index.html로 감 · cli 테스트 cwd 의존.
- 코어(이전 인계 문서와 ledger 참고): commitHuman 경로 지정 없음 · codex `error` 이벤트 처리 · 판정 번복 등.

## 6. 지켜야 할 규칙 (변함없음)
- 각 태스크는 실패하는 테스트 먼저 → 구현 → 통과 → 커밋. 태스크마다 검토.
- 테스트는 실제 `claude`/`codex`/OpenAI/Telegram을 호출하지 않는다(가짜 러너·가짜 서버).
- 비밀값(OpenAI 키, 텔레그램 토큰·chat id)은 환경 변수에서만. 로그·에러·이벤트·설정 파일에 남기지 않는다.
- 텔레그램으로 원본 프롬프트·diff·파일 내용을 보내지 않는다.
- `raw/events.jsonl`은 추가만. 검수(판정)는 항상 GPT 읽기 전용.
- 판단이 필요하면 스펙/시나리오를 기준으로 정하고 기록한다(`Ruling: 결정 — 이유 — 틀리면 비용`).

## 7. 최신 검증 — Codex 종료 보완 후

- `npx tsc --noEmit`, `npm run build`: 통과.
- `npm test -- --maxWorkers=1 --testTimeout=30000`: 33파일 / 353테스트 통과 (153.36초).
- 종료 회귀는 가짜 러너·하네스와 그 손자 프로세스만 사용했다. 종료 신호 후 자식 트리 종료, 새 작업 방지, 지연/실패하는 close, 반복 신호를 검증했다. Windows에서 실행했으며 POSIX 프로세스 그룹 종료 분기는 이 호스트에서 실행 검증하지 않았다.
- 종료 Important 수정은 별도 재검토를 통과했고 Task 7 및 텔레그램 전체 구현은 검토상 통과다. Task 8 실제 Telegram 확인은 여전히 사용자 설정과 승인 대기다.
- 와이어프레임은 사용자의 ACI 관점 검토 요청에 따라 읽기 전용으로 검토했다. 현재 설계는 사람의 관제가 중심이며, 에이전트용 행동 목록·사전 조건·버전/결과 계약은 보완이 필요하다. 와이어프레임 자체는 수정하지 않았다.
