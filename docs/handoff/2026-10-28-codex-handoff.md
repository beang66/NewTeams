# 작업 인계 (2026-10-28) — Claude Code → Codex

이전 인계 문서([2026-10-27-codex-handoff.md](2026-10-27-codex-handoff.md))는 오케스트레이터 코어 단계의 기록이다. **지금 상태와 다음 할 일은 이 문서가 기준이다.**

- 저장소: `C:\myproject\new-team\superpower`, 브랜치 `orchestrator-v2`
- 원격 `origin/orchestrator-v2`는 `4633ab8`까지 올라가 있다. **그 뒤 커밋 11개(`1694f43` ~ `79f313f`)는 아직 푸시하지 않았다.** 원격 `main`은 별개 프로젝트이니 건드리지 말 것. 푸시는 사용자 확인 후에만.
- 작업 트리의 `DESIGN.md` 변경(표 구분선 서식)은 이 작업과 무관하다. 커밋하지 말 것.

## 1. 한눈에 보는 진행 상황

| 계획 | 문서 | 상태 |
|---|---|---|
| 계획 1: 오케스트레이터 코어 | `docs/superpowers/plans/2026-10-26-orchestrator-core.md` | ✅ 완료. 실제 CLI 스모크(전부 Codex 설정)로 DONE 확인: `docs/smoke-test.md` |
| 계획 2: 대시보드 | `docs/superpowers/plans/2026-10-27-dashboard.md` | ⏸ **Task 3에서 멈춤.** 사용자가 와이어프레임·시나리오를 먼저 하자고 해서 중단 |
| 사용자 시나리오 | `docs/scenarios/2026-10-28-user-scenarios.md` | ✅ 작성 완료(사용자 리뷰 전). 와이어프레임 대조 표 §6 포함 |
| 와이어프레임 | `docs/wireframes/dashboard-wireframes.html` | ✅ 9+1 화면. 2-1(파이프라인 개요)·3(사람용)·7(완료)은 문서(paper) 형식. **시나리오 §6의 수정 사항은 아직 미반영** |
| 계획 3: 텔레그램 | `docs/superpowers/plans/2026-10-28-telegram.md` | ▶ **Task 5 진행 중(미커밋 WIP).** Task 1~4 완료 |

테스트(마지막 확인 `79f313f`): `cd orchestrator && npx tsc --noEmit && npm test` → 29 files / 299 tests 통과. 대시보드: `cd dashboard && npm test && npm run build`.

## 2. 지금 바로 할 일 — 텔레그램 Task 5 마무리

작업 트리에 **커밋되지 않은 Task 5 진행분**이 있다(구현 에이전트가 테스트를 먼저 써서 실패를 확인한 직후 중단됨):
- 새 파일: `orchestrator/src/server/actions.ts`, `orchestrator/test/server/actions.test.ts`
- 수정: `orchestrator/src/server/http.ts`, `orchestrator/src/cli.ts`

할 일:
1. `git diff`와 새 파일을 읽고, 계획 Task 5의 Interfaces와 아래 판단(R-TG5)에 맞게 마무리한다. 진행분이 이상하면 버리고(`git checkout -- orchestrator/src/server/http.ts orchestrator/src/cli.ts` + 새 파일 삭제) 다시 해도 된다.
2. `npx tsc --noEmit && npm test` 통과 확인 후 커밋.

**R-TG5 (Task 5에 적용할 결정):**
- 동작을 바꾸지 않는 리팩터다. 기존 `test/server/http.test.ts`는 수정 없이 통과해야 한다(`buildServer` 호출 방식만 불가피하면 조정).
- `createWorkflowActions(wf, onDriveError)`: chat·approveSpec·answer·resume은 **하나의 Promise 큐**로 직렬화한다(실패한 동작이 큐를 막으면 안 됨). `ask`는 큐에 넣지 않는다. approveSpec·answer·resume 성공 후 `drive()`.
- 기존 409 판별 정규식 `/INTAKE|스펙 초안|열린 HUMAN_REQUIRED/`에 맞는 에러는 `ActionConflict`로 바꾼다(메시지 유지).
- "같은 HUMAN_REQUIRED에 두 번 답하면 두 번째는 충돌" 테스트는 `Workflow.answerHuman`이 이미 해결된 ID에 충돌 에러를 던지는지에 기대고 있다. 그렇지 않다면 Workflow를 몰래 고치지 말고 사용자에게 알릴 것.
- `buildServer(wf, { actions?, telegramStatus?, resume?, dashboardDir? })`. `actions`가 없으면 내부에서 기존 `workflow_error` HUMAN_REQUIRED 발행 동작으로 만든다. `GET /api/telegram` → `telegramStatus?.() ?? { state: 'off' }`.
- `cli.ts serve`는 actions를 한 번 만들어 서버에 넘긴다(Task 7에서 봇에도 넘김).

## 3. 그다음 — 텔레그램 Task 6~8

계획 문서의 각 태스크를 그대로 따른다. 이 결정들은 계획 문서 밖에서 내렸으니 반드시 반영한다:
- **R2 (Task 6):** 기존 `attachNotifier`는 HUMAN_REQUIRED, STATE_CHANGE(stage), PAUSED, CHAT(spec)만 넘긴다. 봇에는 RESUMED와 APPROVE도 필요하다 → `attachNotifier(bus, notifier, types?: MessageType[])` 세 번째 인자를 추가하고, 봇은 `NOTIFY_TYPES + ['RESUMED','APPROVE']`로 붙인다(기존 필터 규칙 유지).
- **Task 4 결과 (Task 6이 쓸 것):** `BotApi` 생성자는 `(token, apiBase, { fetchImpl?, sleep?, timeoutMs? })`. 호출자가 abort하면 `TelegramApiError(method, 0, 'aborted')` → 정상 종료로 취급할 것. 타임아웃은 `'timeout'`.
- **Task 3 결과:** `Outbox`는 `push`(동기, 절대 throw 안 함), `flush()`, `stop()`, `size()`, `pendingLoud()`. 전송마다 15초 제한. stop 후 push는 무시.
- **R3 (Task 8):** 실제 텔레그램 확인은 사용자가 봇을 만들고 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 설정한 뒤에만. **에이전트는 토큰을 입력하거나 보지 않는다.**

## 4. 대시보드 계획 재개 시 할 일
1. Task 3(`dashboard/src/api/client.ts`, `useRun.ts`, `test/fakes.ts` 등 — `4633ab8`에 포함)은 **리뷰를 받지 않았다.** 계획 Task 3 요구사항으로 리뷰부터 할 것.
2. 시나리오 문서 §6 대조 표를 와이어프레임과 대시보드 계획에 반영한 뒤 Task 4부터 진행: "마지막 확인 이후" 요약 줄, "이미 처리됨" 상태, 건너뛰기 시 의존 태스크 안내, 묻기 사용량 표시, 보고서 내보내기, 텔레그램 연결 칩(`GET /api/telegram`), 레인 시간 창 3단계 등.
3. 문서 영역(paper) 토큰을 DESIGN.md "문서 영역 보완" 절로 추가할지는 사용자 결정 대기.
4. Task 10(E2E)은 상태별 테스트 대신 시나리오 S1~S7 흐름 테스트로 바꾸자는 제안이 있다(시나리오 §7).

## 5. 판단 기록 (로컬 ledger 요약)

진행 기록 원본은 git 밖(`.superpowers/sdd/<계획>/progress.md`)에 있다. 같은 폴더에서 이어 가면 읽을 수 있다. 핵심만 옮긴다.

**대시보드 계획:** R1 `@orch/*` 별칭 → `../orchestrator/src/*`(bundler 해석) + zod 의존성 · R2 Task 11(실서버 확인)은 사용자 확인 후, `/api/ask`는 명시 승인 시에만 · Task 1 폰트는 `Pretendard Variable` 동적 서브셋 · Task 2 정적 서빙은 시작 시 파일 목록을 고정(빌드 후 재시작 필요).

**텔레그램 계획:** R1 humanRenderer는 `reasonLabel` export만 허용 · R2 위 §3 · R3 위 §3 · Task 1 버튼 데이터는 Map 기반 자기 키 조회(`toString:` 등 → null), `pollTimeoutSec` 정수 ≥1, URL 검증 · Task 2 `sanitize`는 코드 블록·diff 본문까지 통째로 제거, 한 줄 200자 제한, 사유 없으면 `알 수 없음`.

**미뤄 둔 사소한 지적(브랜치 최종 리뷰에서 고를 것):**
- 텔레그램: `z.url()`이 http 외 스킴 허용 · specSummary가 원소별 sanitize라 나뉜 코드 블록 누수 가능 · diff 필터가 `--- `로 시작한 줄 뒤 목록을 지울 수 있음 · Outbox 15초 타이머가 종료를 지연시킬 수 있음 · flush가 진행 중 drain을 기다리지 않음 · 가짜 서버 `photoBytes`가 필드명과 무관 · `res.json()` 중 타임아웃이 HTTP 200으로 보고됨.
- 대시보드: tsconfig include에 `e2e/` 없음 · `/api`(슬래시 없음)가 index.html로 감 · cli 테스트 cwd 의존.
- 코어(이전 인계 문서와 ledger 참고): commitHuman 경로 지정 없음 · codex `error` 이벤트 처리 · 판정 번복 등.

## 6. 지켜야 할 규칙 (변함없음)
- 각 태스크는 실패하는 테스트 먼저 → 구현 → 통과 → 커밋. 태스크마다 검토.
- 테스트는 실제 `claude`/`codex`/OpenAI/Telegram을 호출하지 않는다(가짜 러너·가짜 서버).
- 비밀값(OpenAI 키, 텔레그램 토큰·chat id)은 환경 변수에서만. 로그·에러·이벤트·설정 파일에 남기지 않는다.
- 텔레그램으로 원본 프롬프트·diff·파일 내용을 보내지 않는다.
- `raw/events.jsonl`은 추가만. 검수(판정)는 항상 GPT 읽기 전용.
- 판단이 필요하면 스펙/시나리오를 기준으로 정하고 기록한다(`Ruling: 결정 — 이유 — 틀리면 비용`).
