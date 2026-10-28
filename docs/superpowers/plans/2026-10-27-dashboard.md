# 대시보드 구현 계획 (계획 2/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오케스트레이터의 진행 상황을 실시간으로 관제하고, 사람이 필요한 순간(스펙 승인, 교착, 로그인 만료)에 바로 개입할 수 있는 로컬 웹 대시보드를 만든다.

**Architecture:** 저장소 루트의 `dashboard/` 패키지(React + Vite + TS)다. 오케스트레이터의 기존 REST/SSE 계약만 쓰고, 상태 리듀서(`applyEvent`)와 타입은 `orchestrator/src`에서 그대로 가져와 중복을 없앤다. 화면은 얇게 두고, 이벤트 → 화면 모델 변환은 순수 함수(`src/model/`)로 분리해 단위 테스트한다. 빌드 결과는 오케스트레이터 서버가 `/`에서 서빙하므로 실행은 `orch serve` 하나로 끝난다.

**Tech Stack:** React 19, Vite, TypeScript (strict), vitest + @testing-library/react + jsdom, Playwright(@playwright/test), react-markdown, @tanstack/react-virtual, @fastify/static(오케스트레이터 쪽), 폰트 패키지 pretendard · @fontsource/inter · @fontsource/jetbrains-mono.

**Spec:** [docs/superpowers/specs/2026-10-26-agent-orchestrator-design.md](../specs/2026-10-26-agent-orchestrator-design.md) §7 (대시보드), §4 (메시지 프로토콜), §6 (저장 구조). 시각 기준: 루트 [DESIGN.md](../../../DESIGN.md) + 스펙 §7.6 보완. 제품 사실: 루트 [PRODUCT.md](../../../PRODUCT.md).

## Global Constraints

- 코드 위치: 저장소 루트 `dashboard/`. 테스트는 `dashboard/test/`(단위)와 `dashboard/e2e/`(Playwright).
- 오케스트레이터 타입·리듀서는 Vite/TS 경로 별칭 `@orch/*` → `../orchestrator/src/*`로 가져온다. 대시보드에 같은 로직을 다시 쓰지 않는다.
- 서버 계약(이미 있음, 바꾸지 않음): `GET /api/state`, `GET /api/agents`, `GET /api/events?after=<id>`, `GET /api/stream`(SSE, 각 이벤트 `id: <msg-id>`, `event: envelope`, `data: <Envelope JSON>`, 재연결 시 `Last-Event-ID`), `GET /api/prompts/:id`, `GET /api/human/*`, `POST /api/chat {message}`, `POST /api/spec/approve`, `POST /api/human/:eventId {action:'guidance'|'skip', text, restartSession?}`, `POST /api/resume`, `POST /api/ask {question}`. 이 계획에서 추가하는 것은 Task 2의 `GET /api/plan`과 정적 파일 서빙뿐이다.
- 서버는 `127.0.0.1`에만 바인딩(기존). 대시보드는 외부 CDN·외부 폰트·원격 리소스를 쓰지 않는다(전부 번들).
- 색 토큰(스펙 §7.6): 바탕 `#010102`, 면 `#0f1011`/`#141516`/`#18191a`, 선 `#23252a`/`#34343a`, 글자 `#f7f8f8`/`#d0d6e0`/`#8a8f98`/`#62666d`, 실행·선택 라벤더 `#5e6ad2`(hover `#828fff`), 승인 `#27a644`, 반려·막힘 `#eb5757`, 일시정지 `#f2c94c`. 빨강·노랑은 칩과 아이콘에만 쓰고 면을 채우지 않는다. 라벤더는 실행 중·현재 선택·주요 버튼·포커스 링에만 쓴다.
- 글자 크기는 12/13/14/16/20px 고정 단계만 쓴다(80px·56px 금지). 본문 `Pretendard, Inter, system-ui`, ID·원본 `JetBrains Mono`.
- 다크 테마 하나만 둔다. 애니메이션은 상태가 바뀔 때만, 150~250ms. 화면 진입 연출, 장식 그라데이션, 노드 그래프는 쓰지 않는다. `prefers-reduced-motion`이면 애니메이션을 끈다.
- Claude와 GPT(Codex)는 색이 아니라 레인 이름 옆 모노그램 배지 `C`/`G`로 구분한다. 배지 값은 `/api/agents`의 `roles[role].provider`에서 온다(`claude`→`C`, `codex`→`G`).
- 모달을 쓰지 않는다. 개입은 오른쪽 패널 안에서 처리한다.
- 에이전트가 만든 Markdown(iterations, report, spec 초안, 위키)은 `react-markdown`으로 렌더하고 원시 HTML을 허용하지 않는다.
- 문구는 한국어. 모든 버튼·입력에는 접근 가능한 이름이 있다. 키보드만으로 주의 카드 처리와 스펙 승인을 할 수 있어야 한다.
- 브레이크포인트: 1280px 이상 3열, 1024px 이하 오른쪽 패널은 서랍, 768px 이하 레인 대신 시간순 목록.

## Review Focus

1. **SSE가 끊겼다가 서버 재시작 후 다시 붙는 경우:** 이벤트가 중복되거나 빠지지 않아야 한다(ID로 중복 제거, `Last-Event-ID` 재생). → Task 3
2. **초기 `/api/state` 응답보다 SSE 이벤트가 먼저 도착하는 경우:** 그 이벤트가 상태에 반영돼야 하고 두 번 적용되면 안 된다(`state.lastEventId` 이하 이벤트는 무시, 이후는 적용). → Task 3
3. **에이전트가 만든 Markdown에 `<script>`나 `<img onerror>`가 들어 있는 경우:** 실행되지 않고 글자로 보이거나 제거돼야 한다. → Task 8
4. **메시지 3,000개 프로젝트:** 레인 화면은 보이는 시간 창의 이벤트만 DOM에 그려야 한다(화살표 DOM 수 ≤ 창 안 이벤트 수). → Task 7
5. **한글로 된 매우 긴 태스크 제목·지적 문구:** 줄바꿈 또는 말줄임으로 레이아웃을 깨지 않고, 전체 문구는 `title`로 볼 수 있어야 한다. → Task 6, Task 8

---

## 파일 구조

```
dashboard/
├─ package.json, tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts, index.html
├─ src/
│  ├─ main.tsx, App.tsx              진입점, 단계별 화면 전환
│  ├─ styles/tokens.css, base.css    색·글자·간격 토큰, 기본 스타일
│  ├─ api/client.ts                  REST 호출
│  ├─ api/useRun.ts                  초기 로드 + SSE 구독 + 리듀서 (Hook)
│  ├─ model/lanes.ts                 이벤트 → 레인·화살표
│  ├─ model/board.ts                 태스크 보드 그룹
│  ├─ model/attention.ts             주의 항목
│  ├─ model/usage.ts                 사용량·일시정지 정보
│  ├─ model/labels.ts                단계·상태·사유 한국어 표시
│  ├─ components/TopBar.tsx, StageRail.tsx, UsageGauges.tsx, PausedBanner.tsx
│  ├─ components/TaskBoard.tsx
│  ├─ components/LaneView.tsx, TimelineList.tsx
│  ├─ components/RightPanel.tsx, AttentionTab.tsx, MasterTab.tsx, DetailTab.tsx, Markdown.tsx
│  ├─ components/AskBar.tsx
│  └─ screens/IntakeScreen.tsx, ControlScreen.tsx, DoneScreen.tsx
├─ test/…                            (src 구조 그대로)
└─ e2e/fixtures/*.json, e2e/*.spec.ts
orchestrator/src/server/http.ts      (Task 2: /api/plan, 정적 서빙)
orchestrator/src/cli.ts              (Task 2: --dashboard 옵션)
```

---

### Task 1: 패키지 골격과 디자인 토큰

**Files:**
- Create: `dashboard/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `index.html`, `.gitignore`(node_modules, dist, test-results, playwright-report)
- Create: `dashboard/src/main.tsx`, `src/App.tsx`(빈 셸: `<h1 class="sr-only">에이전트 관제</h1>`), `src/styles/tokens.css`, `src/styles/base.css`
- Test: `dashboard/test/tokens.test.ts`, `dashboard/test/alias.test.ts`

**Interfaces:**
- Produces: CSS 변수 이름(이후 모든 컴포넌트가 사용) — `--bg`, `--surface-1`, `--surface-2`, `--surface-3`, `--line`, `--line-strong`, `--ink`, `--ink-muted`, `--ink-subtle`, `--ink-faint`, `--accent`, `--accent-hover`, `--ok`, `--bad`, `--warn`, `--fs-12`, `--fs-13`, `--fs-14`, `--fs-16`, `--fs-20`, `--font-body`, `--font-mono`, `--radius-sm`(6px), `--radius-md`(8px), `--radius-lg`(12px), `--space-1..6`(4/8/12/16/24/32px), `--dur`(200ms).
- Produces: 별칭 `@orch/*` (vite + tsconfig paths), 스크립트 `dev`, `build`, `test`(vitest run), `e2e`(playwright test).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tokens.test.ts — CSS 파일을 문자열로 읽어 토큰 값을 고정
it('스펙 §7.6 색 토큰', () => {
  const css = readFileSync('src/styles/tokens.css', 'utf8')
  for (const [k, v] of Object.entries({ '--bg': '#010102', '--accent': '#5e6ad2', '--ok': '#27a644', '--bad': '#eb5757', '--warn': '#f2c94c', '--ink': '#f7f8f8' }))
    expect(css).toMatch(new RegExp(`${k}:\\s*${v}`, 'i'))
})
it('글자 크기는 고정 단계만', () => {
  const sizes = [...readFileSync('src/styles/tokens.css', 'utf8').matchAll(/--fs-(\d+):\s*(\d+)px/g)].map(m => +m[2])
  expect(sizes.sort((a, b) => a - b)).toEqual([12, 13, 14, 16, 20])
})
it('외부 URL을 불러오지 않는다', () => {
  for (const f of ['index.html', 'src/styles/tokens.css', 'src/styles/base.css']) expect(readFileSync(f, 'utf8')).not.toMatch(/https?:\/\//)
})
// alias.test.ts
it('@orch 별칭으로 오케스트레이터 리듀서를 가져온다', async () => {
  const { applyEvent, initialState } = await import('@orch/store/state')
  expect(applyEvent(initialState, { id: 'msg-0001', ts: '2026-10-27T00:00:00Z', type: 'STATE_CHANGE', from: 'controller', to: 'all', payload: { stage: 'BUILD' } }).stage).toBe('BUILD')
})
```
- [ ] **Step 2: 실패 확인** — `cd dashboard && npm install && npm test` → FAIL (파일 없음)
- [ ] **Step 3: 구현** — 토큰 값은 Global Constraints 그대로. base.css: `body{background:var(--bg);color:var(--ink);font:400 var(--fs-14)/1.5 var(--font-body)}`, 포커스 링 `outline:2px solid color-mix(in srgb,var(--accent) 50%,transparent)`, `@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}`, `.sr-only`. 폰트는 npm 패키지에서 import(main.tsx). `index.html`의 `<html lang="ko">`, `<title>에이전트 관제</title>`.
- [ ] **Step 4: 통과 확인** — `npm test` → PASS, `npm run build` → `dashboard/dist/index.html` 생성
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): scaffold package and design tokens"`

---

### Task 2: 오케스트레이터 쪽 보강 — 계획 조회와 대시보드 서빙

**Files:**
- Modify: `orchestrator/src/server/http.ts`, `orchestrator/src/cli.ts`, `orchestrator/package.json`(@fastify/static)
- Test: `orchestrator/test/server/http.test.ts`, `orchestrator/test/cli.test.ts`

**Interfaces:**
- Produces:
```ts
GET /api/plan  → Plan (plan.json) | 404 {error:'plan 없음'}
export function buildServer(wf: Workflow, options?: { resume?: boolean; dashboardDir?: string }): FastifyInstance
// dashboardDir가 있으면 그 폴더를 '/'에서 정적 서빙, /api/* 이외의 GET은 index.html로 응답(SPA)
orch serve <name> [--dashboard <dir>]   // 기본값: <저장소>/dashboard/dist 가 있으면 사용
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('GET /api/plan은 plan.json을 돌려준다', async () => {
  await writeFile(wf.store.paths.plan, JSON.stringify(PLAN))
  expect((await app.inject('/api/plan')).json()).toEqual(PLAN)
})
it('plan이 없으면 404', async () => { expect((await app.inject('/api/plan')).statusCode).toBe(404) })
it('dashboardDir를 주면 / 와 SPA 경로에 index.html', async () => {
  const app2 = buildServer(wf, { dashboardDir: distWithIndex })
  expect((await app2.inject('/')).body).toContain('에이전트 관제')
  expect((await app2.inject('/tasks/t1')).body).toContain('에이전트 관제')
  expect((await app2.inject('/api/nope')).statusCode).toBe(404)
})
```
- [ ] **Step 2: 실패 확인** — `cd orchestrator && npm test -- server cli` → FAIL
- [ ] **Step 3: 구현** — `@fastify/static`(root=dashboardDir, `wildcard:false`) + `setNotFoundHandler`에서 GET이고 `/api/`로 시작하지 않으면 index.html. cli `serve`는 `--dashboard`가 없고 `../dashboard/dist/index.html`(cli.js 기준 저장소 루트 계산)이 있으면 자동으로 쓰고, 서버 주소를 출력할 때 `대시보드: http://127.0.0.1:<port>/`를 함께 출력한다.
- [ ] **Step 4: 통과 확인** — `npm test` 전체 → PASS, `npx tsc --noEmit` → 통과
- [ ] **Step 5: Commit** — `git commit -m "feat(server): plan endpoint and dashboard static serving"`

---

### Task 3: API 클라이언트와 실시간 상태 Hook

**Files:**
- Create: `dashboard/src/api/client.ts`, `dashboard/src/api/useRun.ts`
- Test: `dashboard/test/api/useRun.test.tsx`

**Interfaces:**
- Consumes: `@orch/store/state` (`RunState`, `applyEvent`), `@orch/protocol/messages` (`Envelope`), `@orch/protocol/plan` (`Plan`)
- Produces:
```ts
export interface AgentConfig { roles: Record<string, { provider: 'claude' | 'codex'; model: string }> }
export const api: {
  state(): Promise<RunState>; plan(): Promise<Plan | null>; agents(): Promise<AgentConfig>; events(after?: string): Promise<Envelope[]>
  prompt(id: string): Promise<string>; human(path: string): Promise<string | null>   // 404 → null
  chat(message: string): Promise<{ reply: string; specDraft?: string }>; approveSpec(): Promise<void>
  answer(eventId: string, body: { action: 'guidance' | 'skip'; text: string; restartSession?: boolean }): Promise<void>
  resume(): Promise<void>; ask(question: string): Promise<string>
}
export class ApiError extends Error { status: number }   // 409 등 서버 메시지를 그대로 보존
export interface RunView { state: RunState; events: Envelope[]; plan: Plan | null; agents: AgentConfig | null; connected: boolean; loading: boolean; error?: string }
export function useRun(opts?: { eventSourceFactory?: (url: string) => EventSource }): RunView
```
**동기화 규칙(알고리즘):**
```
1. EventSource('/api/stream')를 먼저 연다. 도착하는 이벤트는 초기화가 끝날 때까지 버퍼에 쌓는다.
2. state, plan, agents, events()를 병렬로 받는다. events는 초기 목록, state는 서버 리듀서 결과.
3. 초기화 후: 버퍼 이벤트 중 id > state.lastEventId 인 것만 applyEvent하고 events에 추가.
4. 이후 이벤트: 이미 본 id(Set)면 무시. 아니면 applyEvent + 추가. STATE_CHANGE에 stage가 있거나
   task 수가 바뀌면 plan을 다시 받는다(final-fix 태스크 추가 대비).
5. onerror → connected=false. 브라우저 EventSource가 자동 재연결하며 Last-Event-ID를 보낸다.
   재연결 후 첫 이벤트를 받으면 connected=true.
```
ID 비교는 `BigInt(id.slice(4))`로 한다(msg-10000 이상 대비).

- [ ] **Step 1: 실패하는 테스트 작성** (`FakeEventSource` 클래스를 테스트에 두고 `emit(envelope)`, `fail()` 제공, `fetch`는 `vi.stubGlobal`)

```ts
it('초기 상태보다 먼저 온 이벤트는 lastEventId 이후 것만 한 번 적용', async () => {   // Review Focus 2
  // 서버 state.lastEventId = msg-0005, SSE가 초기화 전에 msg-0005, msg-0006 전송
  const { result } = renderHook(() => useRun({ eventSourceFactory: () => es }))
  es.emit(ev('msg-0005', 'STATE_CHANGE', { stage: 'PLAN' })); es.emit(ev('msg-0006', 'STATE_CHANGE', { stage: 'BUILD' }))
  resolveFetches()
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.state.stage).toBe('BUILD'); expect(result.current.events.map(e => e.id)).toEqual([...초기5개, 'msg-0006'])
})
it('재연결 후 같은 id가 다시 와도 중복되지 않는다', async () => {   // Review Focus 1
  es.emit(ev('msg-0007')); es.fail(); expect(result.current.connected).toBe(false)
  es.emit(ev('msg-0007')); es.emit(ev('msg-0008'))
  expect(result.current.events.filter(e => e.id === 'msg-0007')).toHaveLength(1); expect(result.current.connected).toBe(true)
})
it('409 응답은 서버 메시지를 담은 ApiError', async () => {
  stubFetch(409, { error: 'chat은 INTAKE 단계에서만 가능' })
  await expect(api.chat('x')).rejects.toMatchObject({ status: 409, message: 'chat은 INTAKE 단계에서만 가능' })
})
it('human 404는 null', async () => { stubFetch(404, {}); expect(await api.human('spec.draft.md')).toBeNull() })
```
- [ ] **Step 2: 실패 확인** — `npm test -- api` → FAIL
- [ ] **Step 3: 구현** — 위 알고리즘대로. `human(path)`는 경로 조각마다 `encodeURIComponent`.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): API client and live run state hook"`

---

### Task 4: 화면 모델 (순수 함수)

> **시나리오 반영 추가 (2026-10-28, `docs/scenarios/2026-10-28-user-scenarios.md` §6):** `model/since.ts`를 추가한다.
> `export function sinceLastVisit(events: Envelope[], lastSeenId: string | null): { fromTs: string | null; approved: number; rejected: number; paused: number; autoResumed: boolean; humanOpen: number; ids: string[] } | null` — lastSeenId 이후 이벤트가 없으면 null, lastSeenId가 null이면(첫 방문) null.
> `export function sinceText(s): string` → `"2시간 전부터 · 승인 3 · 반려 2 · 일시정지 1회(자동 재개됨) · 주의 0"` (0인 항목은 생략하되 주의는 항상 표시). 시간 문구는 "N분 전/N시간 전/N일 전".
> 테스트: 승인·반려·일시정지 집계, 자동 재개 여부, lastSeenId가 없을 때 null.

**Files:**
- Create: `dashboard/src/model/labels.ts`, `lanes.ts`, `board.ts`, `attention.ts`, `usage.ts`, `since.ts`
- Test: `dashboard/test/model/*.test.ts`

**Interfaces:**
- Produces:
```ts
// labels.ts
export const STAGE_ORDER: Stage[]   // INTAKE, SPEC_APPROVED, SEED, PLAN, BUILD, INTEGRATE, FINAL_QA, REPORT, DONE
export const stageLabel: Record<Stage, string>   // INTAKE '요구사항', SPEC_APPROVED '스펙 승인', SEED '시드', PLAN '기획', BUILD '개발', INTEGRATE '통합', FINAL_QA '최종 QA', REPORT '보고', DONE '완료'
export const reasonLabel: (code: string) => string   // humanRenderer와 같은 표 + workflow_error '워크플로 오류', openai_cap 'OpenAI 지출 상한'
export const typeLabel: Record<MessageType, string>  // ASSIGN '지시', REPORT '보고', REVISION '수정', REVIEW_REQUEST '리뷰 요청', REJECT '반려', APPROVE '승인', ESCALATE '마스터 호출', GUIDANCE '지침', CHAT '대화', …

// lanes.ts
export interface Lane { key: string; title: string; role: string; badge?: 'C' | 'G'; task?: string; status: 'running' | 'waiting' | 'blocked' | 'paused' | 'done'; round?: number; tokens: number }
export interface Arrow { id: string; from: string; to: string; ts: number; type: MessageType; task?: string; tone: 'accent' | 'ok' | 'bad' | 'warn' | 'neutral' }
export function laneKey(side: string, task?: string): string   // 'dev'|'qa' + task → 'dev:t1'; 'harness'|'orchestrator'|'controller' → 'system'; 그 밖은 그대로
export function buildLanes(events: Envelope[], state: RunState, agents: AgentConfig | null): { lanes: Lane[]; arrows: Arrow[]; pausedSpans: { start: number; end?: number }[] }
export function windowArrows(arrows: Arrow[], fromMs: number, toMs: number): Arrow[]   // 이진 탐색, ts 오름차순 가정

// board.ts
export type BoardGroup = 'review' | 'rejected' | 'running' | 'pending' | 'done' | 'blocked'
export function boardGroups(state: RunState, plan: Plan | null): { group: BoardGroup; label: string; tasks: { id: string; title: string; round: number; status: TaskStatus }[] }[]
// 순서: 검수 중(review) → 반려(rejected) → 진행 중(running) → 대기(pending) → 완료(approved+merged) → 건너뜀(blocked). 'plan','final' 의사 태스크는 제외.

// attention.ts
export type AttentionItem =
  | { kind: 'spec'; draftPath: 'spec.draft.md' }                        // stage INTAKE이고 spec.draft.md가 있다고 알려진 경우
  | { kind: 'human'; eventId: string; task?: string; reason: string; detail: string; findings: Finding[]; tried: string[] }
  | { kind: 'login'; eventId: string }                                  // HUMAN_REQUIRED reason 'auth'
export function attentionItems(state: RunState, events: Envelope[], opts: { hasSpecDraft: boolean }): AttentionItem[]
// human: state.humanRequired의 각 id에 대해, 해당 태스크의 마지막 REJECT findings와 그 이후 GUIDANCE 텍스트들(tried)

// usage.ts
export interface UsageView { byProvider: Record<'claude' | 'codex', { tokens: number; cached: number }>; apiSpendUsd: number; apiCapUsd: number; paused?: { reason: string; until?: Date; remainingMs?: number; needsHuman: boolean } }
export function usageView(events: Envelope[], state: RunState, agents: AgentConfig | null, now: Date, apiCapUsd?: number /*=8*/): UsageView
```
**설계 결정:** CLI는 구독 한도 잔량(%)을 알려 주지 않는다. 그래서 스펙 §7.2의 "Claude 한도, Codex 한도" 게이지는 **누적 토큰 + 한도 상태(정상 / 일시정지·재개 시각)**로 표시한다. 이벤트의 provider는 `from`의 역할을 `agents.roles`로 찾아 정한다(reviewer는 항상 codex). `needsHuman`은 일시정지 중이면서 그 이후 HUMAN_REQUIRED(auth/openai_cap)가 열려 있을 때 true다(Task 11의 "PAUSED(rate_limit) 뒤 HUMAN_REQUIRED(auth)" 순서 반영).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('dev/qa는 태스크별 레인, harness는 system 레인', () => {
  expect(laneKey('dev', 't1')).toBe('dev:t1'); expect(laneKey('harness')).toBe('system'); expect(laneKey('reviewer')).toBe('reviewer')
})
it('레인 배지는 /api/agents의 provider', () => {
  const { lanes } = buildLanes([assign('t1'), reviewReq('t1')], stateWith({ t1: 'review' }), AGENTS_CLAUDE_WORKER)
  expect(lanes.find(l => l.key === 'dev:t1')!.badge).toBe('C'); expect(lanes.find(l => l.key === 'reviewer')!.badge).toBe('G')
})
it('반려 화살표는 bad, 승인은 ok, 실행 중 지시는 accent', () => {
  const { arrows } = buildLanes([assign('t1'), reject('t1'), approve('t1')], S, A)
  expect(arrows.map(a => a.tone)).toEqual(['accent', 'bad', 'ok'])
})
it('PAUSED~RESUMED 구간', () => { expect(buildLanes([paused(t(1)), resumed(t(5))], S, A).pausedSpans).toEqual([{ start: t(1), end: t(5) }]) })
it('windowArrows는 창 안의 것만', () => {   // Review Focus 4
  const arrows = Array.from({ length: 3000 }, (_, i) => arrow(i * 1000))
  expect(windowArrows(arrows, 10_000, 20_000)).toHaveLength(11)
})
it('보드 그룹 순서와 의사 태스크 제외', () => {
  expect(boardGroups(stateWith({ plan: 'approved', a: 'merged', b: 'review', c: 'rejected', d: 'pending' }), PLAN).map(g => g.group)).toEqual(['review', 'rejected', 'pending', 'done'])
})
it('주의: 교착 카드에 마지막 반려 지적과 시도한 지침', () => {
  const items = attentionItems(stateWithHuman('msg-0010'), [reject('t1', [F('F-1')]), guidance('t1', '서버에서 검증'), human('msg-0010', 't1', 'repeat_finding')], { hasSpecDraft: false })
  expect(items[0]).toMatchObject({ kind: 'human', task: 't1', reason: 'repeat_finding', tried: ['서버에서 검증'] })
})
it('auth HUMAN_REQUIRED는 login 카드', () => { expect(attentionItems(stateWithHuman('msg-3'), [human('msg-3', undefined, 'auth')], { hasSpecDraft: false })[0].kind).toBe('login') })
it('사용량: provider별 토큰 합과 재개까지 남은 시간', () => {
  const u = usageView([withUsage(report('t1'), 1000, 800), withUsage(approve('t1'), 500, 0)], pausedState('2026-10-27T05:30:00Z'), AGENTS_CLAUDE_WORKER, new Date('2026-10-27T05:00:00Z'))
  expect(u.byProvider.claude.tokens).toBe(1000); expect(u.byProvider.codex.tokens).toBe(500); expect(u.paused!.remainingMs).toBe(30 * 60_000)
})
```
(`ASSIGN`의 `from`은 master/controller이므로, 토큰을 provider에 귀속할 때는 `usage`가 붙은 이벤트의 **응답한 역할**을 쓴다: REPORT/REVISION→dev, REVIEW_REQUEST의 `payload.qa.usage`→qa, REJECT/APPROVE(from reviewer)→reviewer, GUIDANCE→master. 테스트 헬퍼 `withUsage`는 이 규칙에 맞는 이벤트를 만든다.)

- [ ] **Step 2: 실패 확인** — `npm test -- model` → FAIL
- [ ] **Step 3: 구현** — Interfaces와 주석의 규칙대로. 시간은 `Date.parse(e.ts)`.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): view models for lanes, board, attention, usage"`

---

### Task 5: 화면 뼈대 — 상단 바, 단계 레일, 사용량, 일시정지 배너

> **시나리오 반영 추가 (S3, S8):**
> - `components/SinceBar.tsx`: 상단 바 바로 아래 한 줄. `sinceLastVisit`(Task 4)가 null이 아니면 `sinceText`를 보여 주고, 누르면 `onOpenTimeline(ids)`, [확인함]이나 화면 클릭 시 닫힌다. 마지막 확인 ID는 localStorage 키 `orch.lastSeen.<프로젝트 경로>`에 저장한다(읽기·쓰기를 try/catch로 감싸고, 실패해도 화면은 정상). 탭이 다시 보이게 될 때(`visibilitychange`)와 [확인함] 시 현재 마지막 이벤트 ID로 갱신.
> - 텔레그램 연결 칩: `api.telegram()`(`GET /api/telegram` → `{ state: 'off'|'connecting'|'connected'|'error', botUsername?, lastError? }`, Task 3의 client에 메서드 추가)를 30초마다 읽어 상단 바 오른쪽에 작은 칩으로 표시. off는 칩 숨김, connected는 회색 `텔레그램 @이름`, error는 노랑 `텔레그램 끊김`(title에 lastError).
> - 테스트: 요약 줄 표시·닫기·localStorage 실패 시에도 렌더, 텔레그램 칩 상태별 표시.

**Files:**
- Create: `dashboard/src/components/TopBar.tsx`, `StageRail.tsx`, `UsageGauges.tsx`, `PausedBanner.tsx`, `dashboard/src/screens/ControlScreen.tsx`(3열 그리드 빈 영역 포함), `src/App.tsx` 수정(단계별 화면 전환: INTAKE→IntakeScreen 자리 표시, DONE→DoneScreen 자리 표시, 그 밖→ControlScreen)
- Test: `dashboard/test/components/topbar.test.tsx`

**Interfaces:**
- Consumes: `RunView`(Task 3), `usageView`, `attentionItems`, `stageLabel`(Task 4)
- Produces: `<ControlScreen run={RunView} />`의 슬롯 영역 클래스 `.board`, `.lanes`, `.panel`, `.askbar` (Task 6~9가 채움). 그리드: 1280px 이상 `240px 1fr 400px`, 1024px 이하 `240px 1fr` + 패널 서랍(`.panel[data-open]`), 768px 이하 1열.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
it('단계 레일은 현재 단계에 aria-current', () => {
  render(<StageRail stage="BUILD" />)
  expect(screen.getByText('개발').closest('li')).toHaveAttribute('aria-current', 'step')
})
it('주의 0이면 강조 없음, 1 이상이면 강조', () => {
  const { rerender } = render(<TopBar run={runWith({ humanRequired: [] })} />)
  expect(screen.getByRole('button', { name: /주의 0/ })).not.toHaveClass('is-alert')
  rerender(<TopBar run={runWith({ humanRequired: ['msg-1'] })} />)
  expect(screen.getByRole('button', { name: /주의 1/ })).toHaveClass('is-alert')
})
it('사용량: provider별 토큰과 API 지출/$8', () => {
  render(<UsageGauges usage={{ byProvider: { claude: { tokens: 12345, cached: 10000 }, codex: { tokens: 500, cached: 0 } }, apiSpendUsd: 1.2, apiCapUsd: 8 }} />)
  expect(screen.getByText('12,345')).toBeInTheDocument(); expect(screen.getByText('$1.20 / $8')).toBeInTheDocument()
})
it('일시정지 배너: 자동 재개 시각과 남은 시간', () => {
  render(<PausedBanner paused={{ reason: 'rate_limit', until: new Date('2026-10-27T05:30:00Z'), remainingMs: 1_800_000, needsHuman: false }} />)
  expect(screen.getByRole('status')).toHaveTextContent(/사용량 한도.*재개.*30분/)
})
it('로그인이 필요하면 배너에 재개 버튼 대신 안내', () => {
  render(<PausedBanner paused={{ reason: 'rate_limit', needsHuman: true }} />)
  expect(screen.getByRole('status')).toHaveTextContent('터미널에서 다시 로그인 필요')
})
```
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 남은 시간은 1초마다 갱신(`setInterval`, 언마운트 시 해제). 주의 버튼은 오른쪽 패널의 주의 탭을 연다(`onOpenAttention` prop). 연결이 끊기면 상단 바 오른쪽에 `연결 끊김 — 다시 연결 중` 칩(노랑).
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): top bar, stage rail, usage, paused banner"`

---

### Task 6: 태스크 보드

**Files:**
- Create: `dashboard/src/components/TaskBoard.tsx`
- Test: `dashboard/test/components/taskboard.test.tsx`

**Interfaces:**
- Consumes: `boardGroups`(Task 4)
- Produces: `<TaskBoard state plan selectedTask onSelect(taskId) />`

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
it('그룹 머리에 개수, 반려 태스크에 회차 rN/5', () => {
  render(<TaskBoard state={stateWith({ a: ['rejected', 3] })} plan={PLAN} onSelect={vi.fn()} />)
  expect(screen.getByRole('heading', { name: '반려 1' })).toBeInTheDocument(); expect(screen.getByText('r3/5')).toBeInTheDocument()
})
it('긴 한글 제목은 말줄임 + title에 전체 문구', () => {   // Review Focus 5
  const long = '사용자가 할 일을 추가하고 완료 표시를 한 뒤 새로고침해도 목록이 그대로 복원되는지 확인하는 기능 구현'.repeat(2)
  render(<TaskBoard state={stateWith({ a: 'running' })} plan={planWithTitle('a', long)} onSelect={vi.fn()} />)
  expect(screen.getByTitle(long)).toHaveClass('truncate')
})
it('클릭하면 onSelect(taskId), 선택된 항목은 aria-pressed', async () => {
  const onSelect = vi.fn(); render(<TaskBoard state={S} plan={PLAN} selectedTask="a" onSelect={onSelect} />)
  await userEvent.click(screen.getByRole('button', { name: /b/ })); expect(onSelect).toHaveBeenCalledWith('b')
  expect(screen.getByRole('button', { name: /a/ })).toHaveAttribute('aria-pressed', 'true')
})
it('계획이 없으면 안내 문구', () => { render(<TaskBoard state={initialState} plan={null} onSelect={vi.fn()} />); expect(screen.getByText('기획이 끝나면 태스크가 여기에 나타납니다')).toBeInTheDocument() })
```
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 회차 표시는 반려 그룹에만. `rejectLimit`은 5(스펙 §8) — prop `rejectLimit=5`.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): task board"`

---

### Task 7: 실시간 레인 화면과 좁은 화면용 시간순 목록

**Files:**
- Create: `dashboard/src/components/LaneView.tsx`, `dashboard/src/components/TimelineList.tsx`
- Test: `dashboard/test/components/laneview.test.tsx`

**Interfaces:**
- Consumes: `buildLanes`, `windowArrows`, `typeLabel`(Task 4)
- Produces: `<LaneView events state agents selectedId? onSelectEvent(id) windowMs? follow? width? />`(windowMs 기본 5분, follow 기본 true, width 기본은 ResizeObserver 측정값 — 세 prop은 초기값이며 이후 내부 상태로 바뀐다), `<TimelineList events selectedId? onSelectEvent />`(`role="list"`, `aria-label="이벤트 목록"`)

**동작:**
- SVG 하나. 왼쪽 200px 레인 머리(이름, 배지, 상태 칩, 현재 태스크, rN, 경과 시간, 토큰). 오른쪽은 시간 축. 화살표는 출발 레인 → 도착 레인 세로선 + 화살촉, 옆에 `typeLabel` 짧게.
- 기본은 **실시간 따라가기**(오른쪽 끝 = 지금). 사용자가 가로로 스크롤하거나 확대하면 따라가기를 끄고, 토글 버튼으로 다시 켠다.
- 확대/축소: 창 폭 **5분·1시간·전체 3단계**(버튼 그룹, 시나리오 §6에서 5단계→3단계로 줄임; SinceBar가 구간 이동을 대신한다). 창 안의 화살표만 그린다(`windowArrows`). `highlightIds?: string[]`를 받으면 그 이벤트들의 화살표를 옅게 강조한다(S3).
- 완료된 레인(status done) 접기 토글(기본 켜짐: 완료 레인을 한 줄로 축소).
- 일시정지 구간은 빗금 패턴(`--warn` 20% 투명).
- 화살표 클릭 또는 Enter → `onSelectEvent(id)`. 각 화살표는 `role="button"`과 `aria-label="<발신> → <수신>: <종류> <id>"`.
- 768px 이하에서는 `TimelineList`(가상 스크롤, @tanstack/react-virtual)로 바꿔 그린다.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
it('창 밖 화살표는 DOM에 없다', () => {   // Review Focus 4
  const events = manyEvents(3000)   // 1초 간격
  render(<LaneView events={events} state={S} agents={A} windowMs={60_000} follow onSelectEvent={vi.fn()} />)
  expect(screen.getAllByRole('button', { name: /→/ }).length).toBeLessThanOrEqual(61)
})
it('화살표를 Enter로 선택', async () => {
  const on = vi.fn(); render(<LaneView events={[assign('t1')]} state={S} agents={A} onSelectEvent={on} />)
  screen.getByRole('button', { name: /지시 msg-0001/ }).focus(); await userEvent.keyboard('{Enter}'); expect(on).toHaveBeenCalledWith('msg-0001')
})
it('반려 화살표는 bad 톤 클래스', () => { render(<LaneView events={[reject('t1')]} …/>); expect(screen.getByRole('button', { name: /반려/ })).toHaveClass('tone-bad') })
it('일시정지 구간 빗금', () => { const { container } = render(<LaneView events={[paused(t(1)), resumed(t(5))]} …/>); expect(container.querySelector('rect.paused-span')).not.toBeNull() })
it('완료 레인 접기', async () => { /* 완료 태스크 레인이 접힌 상태 → 토글 후 펼쳐짐 */ })
it('TimelineList는 최신이 아래, 가상 스크롤로 일부만 렌더', () => { render(<TimelineList events={manyEvents(3000)} …/>); expect(screen.getAllByRole('listitem').length).toBeLessThan(100) })
```
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 위 동작대로. jsdom에는 레이아웃이 없으므로 너비는 prop(`width`, 기본 `ResizeObserver` 측정)으로 받는다. 상태 칩 색: running 라벤더, waiting 회색, blocked 빨강, paused 노랑, done 초록.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): live lane sequence view and timeline list"`

---

### Task 8: 오른쪽 패널 — 주의 · 마스터 · 상세(사람용 | 원본)

**Files:**
- Create: `dashboard/src/components/RightPanel.tsx`, `AttentionTab.tsx`, `MasterTab.tsx`, `DetailTab.tsx`, `Markdown.tsx`
- Test: `dashboard/test/components/panel.test.tsx`

**Interfaces:**
- Consumes: `api`(Task 3), `attentionItems`, `reasonLabel`(Task 4)
- Produces: `<RightPanel run tab onTab selection={{ eventId?: string; taskId?: string }} />`, `<Markdown source={string} />`

**동작:**
- **주의 탭:** 카드 목록.
  - `human` 카드: 제목(태스크 + `reasonLabel`), 반복된 지적 목록(id·심각도·문구), 마스터가 시도한 지침, 지침 입력 textarea + [지침 보내기](`action:'guidance'`) + [이 태스크 건너뛰기](`action:'skip'`, 확인 문구를 같은 카드 안에서 한 번 더 묻는 2단계 버튼) + 체크박스 "새 세션으로 다시 시작"(`restartSession`). 스펙 §7.4의 "재분할" 선택지는 서버 API가 지원하지 않으므로 넣지 않는다(재분할은 마스터가 결정한다).
  - **시나리오 반영 추가 (S4, S5):** 건너뛰기 확인 문구는 `정말 건너뛸까요? 이 태스크에 의존하는 <n>개 태스크도 함께 건너뜁니다`(plan의 deps로 계산, 0개면 뒷부분 생략). `plan` 태스크의 교착 카드에는 건너뛰기 버튼을 두지 않는다. 제출이 409(ActionConflict)이면 카드를 `이미 처리됨`(회색, 버튼 없음)으로 바꾼다 — 텔레그램에서 먼저 처리한 경우. 카드 머리에 [근거 보기] 링크(상세 [사람용] 탭으로 이동)를 두고, 모바일 폭에서도 보인다. login 카드에서 [재개] 후 5초 안에 같은 사유의 HUMAN_REQUIRED가 다시 오면 카드 안에 `아직 로그인되지 않았습니다`를 보여 준다. 테스트: 409 → 이미 처리됨, 의존 개수 문구, plan 카드 건너뛰기 없음, 로그인 재실패 문구.
  - `login` 카드: "터미널에서 다시 로그인 필요" + 안내 문구 "Claude: 터미널에서 `claude` 실행 후 `/login` · Codex: `codex login`"(글자로만 표시, 실행하지 않음) + [로그인했어요, 재개](`api.resume()`).
  - `spec` 카드: "스펙 초안이 준비됐습니다" + [스펙 보기](INTAKE 화면으로 이동).
  - 제출 중에는 버튼 비활성 + "보내는 중…", 실패하면 카드 안에 `ApiError.message`.
- **마스터 탭:** CHAT 이벤트를 대화 형식으로(사용자 오른쪽, 마스터 왼쪽). INTAKE가 아니면 입력창 대신 "요구사항 대화는 끝났습니다. 아래 '마스터에게 묻기'를 쓰세요."
- **상세 탭:** 선택한 태스크 또는 이벤트.
  - [사람용]: `human/iterations/<task>.md`를 `Markdown`으로, 그 태스크 마지막 회차의 증거 캡처 썸네일(`/api/human/evidence/<task>/r<n>/<png>`, manifest는 `api.human(...manifest.json)`).
  - [원본]: 선택 이벤트의 Envelope JSON(들여쓰기 2) + `promptRef`가 있으면 `api.prompt(id)` 전문, 모노 폰트, "복사" 버튼.
- **Markdown:** `react-markdown`, `skipHtml`, 링크는 `rel="noreferrer"`, `raw/events.jsonl#msg-XXXX` 링크는 클릭 시 해당 이벤트를 선택하고 원본 탭으로 이동.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
it('Markdown의 HTML은 실행되지 않는다', () => {   // Review Focus 3
  const { container } = render(<Markdown source={'# 제목\n<script>window.__x=1</script><img src=x onerror="window.__y=1">'} />)
  expect(container.querySelector('script, img[onerror]')).toBeNull(); expect((window as any).__x).toBeUndefined()
})
it('원본 링크 클릭 → 이벤트 선택 + 원본 탭', async () => {
  const onSelect = vi.fn(); render(<Markdown source="[원본](../raw/events.jsonl#msg-0042)" onRawLink={onSelect} />)
  await userEvent.click(screen.getByRole('link', { name: '원본' })); expect(onSelect).toHaveBeenCalledWith('msg-0042')
})
it('교착 카드: 지침 보내기 → POST human {action:guidance, text, restartSession:false}', async () => {
  const answer = vi.spyOn(api, 'answer').mockResolvedValue()
  render(<AttentionTab items={[HUMAN_ITEM]} />)
  await userEvent.type(screen.getByRole('textbox', { name: '지침' }), '입력 검증은 서버에서')
  await userEvent.click(screen.getByRole('button', { name: '지침 보내기' }))
  expect(answer).toHaveBeenCalledWith('msg-0010', { action: 'guidance', text: '입력 검증은 서버에서', restartSession: false })
})
it('건너뛰기는 두 번 눌러야 전송', async () => { /* 첫 클릭 → "정말 건너뛸까요?" 버튼으로 바뀜, 두 번째 클릭에 answer(skip) */ })
it('제출 실패 시 카드 안에 서버 메시지', async () => { vi.spyOn(api, 'answer').mockRejectedValue(new ApiError(409, '열린 HUMAN_REQUIRED가 아님')); /* … */ expect(screen.getByRole('alert')).toHaveTextContent('열린 HUMAN_REQUIRED가 아님') })
it('로그인 카드: 재개 버튼 → api.resume', async () => { /* … */ })
it('긴 지적 문구는 줄바꿈되어 패널을 넘지 않는다', () => { /* .finding 에 overflow-wrap:anywhere 클래스 확인 */ })   // Review Focus 5
it('상세 원본 탭: Envelope JSON과 프롬프트 전문', async () => { vi.spyOn(api, 'prompt').mockResolvedValue('프롬프트 본문'); /* … */ })
```
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 위 동작대로. 1024px 이하에서는 패널이 오른쪽 서랍(`aside[data-open]`, Esc로 닫힘, 열리면 첫 포커스 이동).
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): attention, master and detail panel"`

---

### Task 9: 요구사항 화면, 완료 화면, 마스터에게 묻기

**Files:**
- Create: `dashboard/src/screens/IntakeScreen.tsx`, `dashboard/src/screens/DoneScreen.tsx`, `dashboard/src/components/AskBar.tsx`
- Modify: `dashboard/src/App.tsx`, `dashboard/src/screens/ControlScreen.tsx` (Task 6~8 컴포넌트 배치)
- Test: `dashboard/test/screens/screens.test.tsx`

**Interfaces:**
- Consumes: `api.chat`, `api.approveSpec`, `api.human('spec.draft.md' | 'report.md')`, `api.ask`
- Produces: 완성된 `App`

**동작:**
- **IntakeScreen(INTAKE):** 가운데 마스터 대화(CHAT 이벤트 + 입력창, Enter 전송·Shift+Enter 줄바꿈), 오른쪽 스펙 초안(`spec.draft.md`, `chat` 응답에 specDraft가 있으면 다시 불러옴). 초안이 있을 때만 [스펙 승인] 활성. 승인 후 서버가 다음 단계로 진행하면 SSE로 stage가 바뀌어 자동으로 관제 화면으로 넘어간다. 첫 화면(이벤트 0개) 빈 상태 문구: "만들고 싶은 것을 마스터에게 설명해 주세요. 대화가 끝나면 오른쪽에 스펙 초안이 채워집니다."
- **DoneScreen(DONE):** `report.md`를 Markdown으로, 상단에 "완료" 칩과 [관제 화면 보기] 토글(레인 기록을 다시 볼 수 있게).
- **AskBar(하단):** "마스터에게 묻기" 입력 → `api.ask` 응답을 입력창 위에 펼침(Markdown, 원본 링크 동작 포함). 오른쪽에 최근 이벤트 한 줄(`typeLabel` + 발신 → 수신 + 시각). **추가(S6):** 입력창 옆에 작게 `사용량을 씁니다`.
- **추가(S7, 문서 형식):** DoneScreen과 상세 [사람용] 탭의 본문은 와이어프레임 `docs/wireframes/dashboard-wireframes.html`의 7번·3번(✦) 문서 형식을 따른다. `src/styles/paper.css`에 `.paper` 범위 토큰(와이어프레임의 `--p-*` 값 그대로: 바탕 `#f3f0e8`, 시트 `#fbf9f4`, 글자 `#141414`/`#3d3a35`/`#6b665d`, 선 `#141414`/`#cfc9bd`, 승인 `#1f6f3a`, 반려 `#a8281e`, 주의 `#8a6100`, 현재 `#4b55c0`)을 두고, 상단 바·하단 묻기는 다크 그대로. 세리프 제목 글꼴은 Noto Serif KR을 npm 패키지(`@fontsource/noto-serif-kr`, 700 한 굵기, 한국어 서브셋)로 번들. 완료 화면에 [Markdown 내려받기] 버튼: `report.md`를 그대로 파일로 저장(원본 프롬프트 없음). PDF는 브라우저 인쇄로 대신하고 `@media print`에서 상단 바·하단을 숨긴다. 테스트: paper 토큰 값, 내려받기 버튼이 report 내용으로 Blob을 만든다.
- **로딩:** `run.loading`이면 각 영역 스켈레톤(회색 막대, 애니메이션 없음).

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
it('초안이 없으면 스펙 승인 비활성', () => { render(<IntakeScreen run={intakeRun([])} draft={null} />); expect(screen.getByRole('button', { name: '스펙 승인' })).toBeDisabled() })
it('대화 전송 → api.chat, 응답에 specDraft 있으면 초안 다시 불러옴', async () => { /* chat mock → { reply, specDraft:'…' }, human('spec.draft.md') 호출 확인 */ })
it('Shift+Enter는 줄바꿈, Enter는 전송', async () => { /* … */ })
it('승인 → api.approveSpec', async () => { /* … */ })
it('DONE이면 보고서 화면', async () => { vi.spyOn(api, 'human').mockResolvedValue('# 최종 평가\n완료'); render(<App runOverride={doneRun} />); expect(await screen.findByRole('heading', { name: '최종 평가' })).toBeInTheDocument() })
it('묻기 → 답변 표시', async () => { vi.spyOn(api, 'ask').mockResolvedValue('msg-0023에서 권한 문제로 멈췄습니다'); /* … */ })
it('로딩 중 스켈레톤', () => { render(<App runOverride={{ ...run, loading: true }} />); expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0) })
```
(`App`은 테스트용 `runOverride?: RunView` prop을 받는다. 없으면 `useRun()`을 쓴다.)
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 위 동작대로.
- [ ] **Step 4: 통과 확인** — `npm test` 전체 → PASS, `npm run build` → 통과
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): intake, done screens and ask bar"`

---

### Task 10: 브라우저 E2E — 가짜 이벤트 스트림으로 상태별 화면 확인

> **시나리오 반영 변경:** 상태별 테스트 대신 시나리오 흐름 테스트로 쓴다 — S1(대화→초안→승인→관제 전환), S2(주의 0 강조 없음, 연결 끊김 칩), S3(마지막 확인 ID 저장→새 이벤트→요약 줄 숫자), S4(지침 전송→처리됨, 409→이미 처리됨), S5(일시정지 배너·주의 0 유지, 로그인 카드→재개), S6(보드→사람용→원본→프롬프트, 클릭 3회), S7(완료→근거 링크→Markdown 내려받기), 그리고 Task 12의 파이프라인 개요 열기. 아래 원래 테스트 목록은 이 흐름 안에 포함된다. 실행 순서상 Task 12를 먼저 끝낸 뒤 진행한다.

**Files:**
- Create: `dashboard/e2e/fixtures/{intake,build,paused,deadlock,done}.json`(각각 `{state, plan, agents, events}`), `dashboard/e2e/mockApi.ts`, `dashboard/e2e/states.spec.ts`
- Modify: `dashboard/playwright.config.ts` (webServer: `vite preview --port 4318`, 프로젝트 desktop 1440×900 + mobile 390×844)

**Interfaces:**
- Consumes: 완성된 대시보드(Task 1~9)
- Produces: `npm run e2e`

`mockApi.ts`: `page.route('**/api/**')`로 픽스처를 응답한다. `/api/stream`은 픽스처 이벤트를 SSE 본문으로 한 번에 돌려준다(`content-type: text/event-stream`, 각 이벤트 `id:`/`event: envelope`/`data:`). POST는 호출 내용을 기록하고 204를 돌려준다. 이벤트 픽스처는 실제 스모크 로그의 형태를 따르되 내용은 가상 데이터로 만든다(실제 `orchestrator/projects/` 파일을 복사하지 않는다).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('INTAKE: 대화 → 초안 → 승인', async ({ page }) => {
  const calls = await mockApi(page, 'intake'); await page.goto('/')
  await page.getByRole('textbox', { name: '마스터에게 보내기' }).fill('할 일 앱 만들어줘'); await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '스펙 승인' })).toBeEnabled()
  await page.getByRole('button', { name: '스펙 승인' }).click(); expect(calls).toContainEqual({ method: 'POST', path: '/api/spec/approve' })
})
test('BUILD: 레인, 보드, 화살표 선택 → 상세 원본', async ({ page }) => { /* 반려 화살표 클릭 → 상세 탭 원본에 msg id */ })
test('PAUSED: 배너에 재개 시각', async ({ page }) => { /* role=status 텍스트 */ })
test('교착: 주의 카드에서 지침 보내기', async ({ page }) => { /* POST /api/human/msg-… body 확인 */ })
test('DONE: 보고서', async ({ page }) => { /* heading */ })
test('모바일 폭: 시간순 목록과 패널 서랍, 가로 스크롤 없음', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockApi(page, 'build'); await page.goto('/')
  await expect(page.getByRole('list', { name: '이벤트 목록' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
```
- [ ] **Step 2: 실패 확인** — `npx playwright install chromium && npm run e2e` → 픽스처/모의 서버 없음으로 FAIL
- [ ] **Step 3: 구현** — 픽스처 5종과 `mockApi.ts`. 실패하는 테스트가 화면 버그를 드러내면 해당 컴포넌트를 고친다(고친 파일은 보고서에 적는다).
- [ ] **Step 4: 통과 확인** — `npm run e2e` → desktop·mobile 모두 PASS. 이어서 Impeccable 검사 1회: `~/.claude/skills/impeccable/scripts/impeccable detect --json dashboard/src` (실행할 수 없으면 건너뛰고 보고서에 적는다). 지적이 나오면 한 번에 고치고 한 번만 다시 확인한다.
- [ ] **Step 5: Commit** — `git commit -m "test(dashboard): e2e state screens with mocked API"`

---

### Task 11: 실제 서버로 확인 (수동)

**Files:**
- Modify: `docs/smoke-test.md` (대시보드 확인 결과 절 추가)

- [ ] **Step 1:** `cd dashboard && npm run build`, `cd ../orchestrator && npm run build && node dist/cli.js --config <설정> serve todo-smoke` (기존 로컬 스모크 프로젝트, DONE 상태 — **새 CLI 호출은 하지 않는다**).
- [ ] **Step 2:** 브라우저에서 `http://127.0.0.1:4317/` 열기. 확인 항목: DONE 보고서 화면, [관제 화면 보기]로 레인 59개 이벤트 재생, 반려 화살표 → 상세 원본에 프롬프트 전문, iterations 사람용 탭, 최종 QA 캡처 썸네일, "마스터에게 묻기"는 실제 CLI를 부르므로 **사용자 확인 후에만** 실행.
- [ ] **Step 3:** 결과와 스크린샷 경로를 `docs/smoke-test.md`에 기록.
- [ ] **Step 4: Commit** — `git commit -m "docs: record dashboard check against smoke project"`

---

### Task 12: 파이프라인 개요 화면 (문서 형식, 시나리오 반영 추가)

와이어프레임 2-1번(✦). 단계 레일 오른쪽의 [관제 | 개요] 전환으로 연다. **Task 9 다음, Task 10 전에 실행한다.**

**Files:**
- Create: `dashboard/src/model/pipeline.ts`, `dashboard/src/screens/PipelineOverview.tsx`
- Modify: `dashboard/src/components/TopBar.tsx`(전환 버튼), `dashboard/src/screens/ControlScreen.tsx`
- Test: `dashboard/test/model/pipeline.test.ts`, `dashboard/test/screens/pipeline.test.tsx`

**Interfaces:**
- Consumes: `RunView`, `Plan`, `AgentConfig`, `stageLabel`, `.paper` 토큰(Task 9)
- Produces:
```ts
export type StepState = 'done' | 'now' | 'future' | 'human'
export interface PipelineView {
  fixed: string                                   // "작업 C sonnet · 검수 G 읽기 전용 · 병렬 3 · 반려 상한 5 · 같은 지적 2회 · API $8" (agents와 기본값에서 생성)
  intake: { stage: Stage; state: StepState; note: string }[]   // 요구사항, 스펙 승인(사람), 시드, 기획⇄검수
  loop: { harnessRejects: number; reviewRejects: number; deadlocks: number; humanOpen: string[]; reviewingTask?: string }
  finish: { stage: Stage; state: StepState }[]    // 통합, 최종 QA, 보고, 완료
  tasks: { id: string; title: string; round: number; rejects: number; status: TaskStatus }[]
  tokens: { role: string; provider: 'C' | 'G'; tokens: number; cachedPct: number }[]
}
export function pipelineView(run: RunView): PipelineView
```
**동작:** 와이어프레임 2-1 그대로 — 1·2·3 구간의 단계 상자(굵은 선=지난 단계, 라벤더 외곽선=지금, 회색=아직, 점선 빨강=되돌아간 경로와 횟수), 고정 조건 박스, 오른쪽 "태스크별 루프"·"토큰은 어디에 썼나" 표(고정폭 숫자). 상자 안 링크는 해당 iterations 문서(상세 [사람용])로, 메시지 ID는 원본으로 간다. 1024px 이하에서는 오른쪽 표가 그림 아래로 내려간다.

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
it('지금 단계는 now, 지난 단계는 done', () => { expect(pipelineView(runAt('BUILD')).intake.map(s => s.state)).toEqual(['done', 'human', 'done', 'done']) })
it('하네스 반려와 검수 반려를 따로 센다', () => { expect(pipelineView(runWith([reject('t1', 'harness'), reject('t1', 'reviewer'), reject('t2', 'reviewer')])).loop).toMatchObject({ harnessRejects: 1, reviewRejects: 2 }) })
it('고정 조건은 agents 설정을 반영한다', () => { expect(pipelineView(runWithAgents({ dev: { provider: 'codex', model: 'codex-default' } })).fixed).toMatch(/^작업 G/) })
it('개요 화면: 표의 반려 수와 지금 위치 강조', () => { render(<PipelineOverview run={RUN} />); expect(screen.getByRole('row', { name: /t3.*3.*3/ })).toBeInTheDocument(); expect(document.querySelector('.stp.now')).not.toBeNull() })
```
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run build` PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): pipeline overview in document style"`
