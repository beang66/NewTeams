import { expect, test, type Page } from '@playwright/test'
import { mockApi, type Mock } from './mockApi'

// Scenario flows from docs/scenarios/2026-10-28-user-scenarios.md §3 (S1–S7) and §7, plus the pipeline overview.
// Desktop project (1440x900). The mobile flow lives in mobile.spec.ts.

const attentionBtn = (page: Page, n: number) => page.getByRole('button', { name: `주의 ${n}`, exact: true })
const board = (page: Page) => page.getByRole('complementary', { name: '태스크 보드' })
const panel = (page: Page) => page.getByRole('complementary', { name: '오른쪽 패널' })
const ticker = (page: Page) => page.locator('.ticker')

const DRAFT = ['# 할 일 앱 스펙 초안', '', '## 구현 범위', '- 할 일 추가, 완료 표시, 삭제', '', '## 제외 범위', '- 로그인, 서버 동기화', '', '## 수용 기준', '- 새로고침해도 완료 상태가 유지된다'].join('\n')

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}
const lastSeen = (page: Page, mock: Mock) => {
  const first = mock.fixture.events[0]!
  return page.evaluate((k) => localStorage.getItem(k), `orch.lastSeen.${first.id}.${first.ts}`)
}

/** The user leaves (tab hidden, last-seen id stored), the run moves on, and the user comes back. */
async function awayAndBack(page: Page, mock: Mock) {
  await page.goto('/#/run')
  await expect(board(page)).toBeVisible()
  const lastBefore = mock.fixture.events.at(-1)!.id
  await setVisibility(page, 'hidden')
  expect(await lastSeen(page, mock)).toBe(lastBefore)
  for (const task of ['t2', 't4', 't1']) mock.push({ type: 'APPROVE', from: 'reviewer', to: 'controller', task })
  for (const task of ['t3', 't3']) mock.push({ type: 'REJECT', from: 'reviewer', to: 'controller', task, payload: { verdict: 'reject', findings: [], resolved: [] } })
  mock.push({ type: 'PAUSED', from: 'orchestrator', to: 'all', payload: { reason: 'rate_limit', until: '2026-10-28T04:40:00.000Z' } })
  const last = mock.push({ type: 'RESUMED', from: 'orchestrator', to: 'all' })
  await expect(ticker(page)).toContainText(last.id)
  await setVisibility(page, 'visible')
  return { lastBefore, last: last.id }
}

test('S1: 대화 → 초안 → 승인 → 관제 화면 전환', async ({ page }) => {
  const mock = await mockApi(page, 'intake')
  let turn = 0
  mock.onPost('/api/chat', (body) => {
    mock.push({ type: 'CHAT', from: 'user', to: 'master', payload: { text: (body as { message: string }).message } })
    turn += 1
    if (turn === 1) {
      mock.push({ type: 'CHAT', from: 'master', to: 'user', payload: { text: '저장은 브라우저에만 하면 될까요?' } })
      return { json: { reply: '저장은 브라우저에만 하면 될까요?' } }
    }
    mock.setHuman('spec.draft.md', DRAFT)
    mock.push({ type: 'CHAT', from: 'master', to: 'user', payload: { text: '스펙 초안을 정리했습니다', specApprovalRequired: true } })
    return { json: { reply: '스펙 초안을 정리했습니다', specDraft: true } }
  })
  mock.onPost('/api/spec/approve', () => {
    mock.push({ type: 'STATE_CHANGE', from: 'controller', to: 'all', payload: { stage: 'SPEC_APPROVED' } })
  })

  await page.goto('/#/run')
  await expect(page.getByText('만들고 싶은 것을 마스터에게 설명해 주세요')).toBeVisible()
  await expect(page.getByRole('button', { name: '스펙 승인', exact: true })).toBeDisabled() // 빈 초안은 승인할 수 없다

  const input = page.getByRole('textbox', { name: '마스터에게 보내기' })
  await input.fill('할 일 앱 만들어 줘')
  await page.keyboard.press('Enter')
  await expect(page.getByText('저장은 브라우저에만 하면 될까요?')).toBeVisible()
  await expect(page.getByRole('button', { name: '스펙 승인', exact: true })).toBeDisabled()

  await input.fill('네, 브라우저에만 저장해요')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '할 일 앱 스펙 초안' })).toBeVisible()
  const approve = page.getByRole('button', { name: '스펙 승인', exact: true })
  await expect(approve).toBeEnabled()
  expect(mock.calls.filter((c) => c.path === '/api/chat')).toHaveLength(2)

  await approve.click()
  expect(mock.calls).toContainEqual({ method: 'POST', path: '/api/spec/approve' })
  await expect(board(page)).toBeVisible() // 관제 화면
  await expect(page.getByText('기획이 끝나면 태스크가 여기에 나타납니다')).toBeVisible()
  await expect(approve).toHaveCount(0)
})

test('S1 예외: 이미 승인된 스펙은 서버 사유를 화면에 보여 준다', async ({ page }) => {
  const mock = await mockApi(page, 'intake')
  mock.setHuman('spec.draft.md', DRAFT)
  mock.onPost('/api/spec/approve', () => ({ status: 409, json: { error: '이미 승인된 스펙입니다' } }))
  await page.goto('/#/run')
  await page.getByRole('button', { name: '스펙 승인', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('이미 승인된 스펙입니다')
})

test('S2: 맡겨 두고 확인 — 주의 0은 강조 없음, 연결이 끊기면 칩, 복구 시 빠진 이벤트 보충', async ({ page }) => {
  const mock = await mockApi(page, 'build')
  await page.goto('/#/run')

  // 2초 안에 세 가지 답: 진행 중인가(단계 레일), 막혔나(주의 0·배너 없음), 내 차례인가(주의 0)
  await expect(page.getByRole('heading', { name: /todo-app/ })).toBeVisible()
  await expect(attentionBtn(page, 0)).toBeVisible()
  await expect(attentionBtn(page, 0)).not.toHaveClass(/is-alert/)
  await expect(page.locator('.paused-banner')).toHaveCount(0)
  await expect(page.getByText('텔레그램 @orch_todo_bot')).toBeVisible()
  await expect(page.getByText('연결 끊김')).toHaveCount(0)

  // 보드: 검수 중 1, 반려 1(r2/3), 진행 중 1
  await expect(board(page).getByRole('heading', { name: '검수 중 1' })).toBeVisible()
  await expect(board(page).getByRole('heading', { name: '반려 1' })).toBeVisible()
  await expect(board(page).getByRole('heading', { name: '진행 중 1' })).toBeVisible()
  await expect(board(page).getByText('r2/3')).toBeVisible()

  // 서버가 끊기면 상단에 칩, 그사이 쌓인 이벤트는 다시 붙을 때 받아온다
  mock.dropStream()
  await expect(page.getByText('연결 끊김 — 다시 연결 중')).toBeVisible()
  const missed = mock.push({ type: 'APPROVE', from: 'reviewer', to: 'controller', task: 't2' })
  mock.restoreStream()
  await expect(page.getByText('연결 끊김')).toHaveCount(0, { timeout: 10_000 })
  await expect(ticker(page)).toContainText(missed.id)
  await expect(board(page).getByRole('heading', { name: '완료 2' })).toBeVisible()
})

test('S3: 돌아오면 "마지막 확인 이후" 한 줄 요약이 숫자와 함께 뜨고 확인함으로 닫힌다', async ({ page }) => {
  const mock = await mockApi(page, 'build')
  const { last } = await awayAndBack(page, mock)

  const since = page.locator('.since-bar')
  await expect(since).toContainText('2시간 전부터 · 승인 3 · 반려 2 · 일시정지 1회(자동 재개됨) · 주의 0')
  await since.getByRole('button', { name: '확인함' }).click()
  await expect(since).toHaveCount(0)
  expect(await lastSeen(page, mock)).toBe(last)
})

test('S3: 요약을 누르면 그 구간의 이벤트가 레인에서 옅게 강조된다', async ({ page }) => {
  const mock = await mockApi(page, 'build')
  await awayAndBack(page, mock)
  await expect(page.locator('.arrow.is-highlight')).toHaveCount(0)
  await page.locator('.since-text').click()
  await expect.poll(() => page.locator('.arrow.is-highlight').count()).toBeGreaterThan(0)
  await expect(page.locator('.since-bar')).toHaveCount(0) // 아무 데나 클릭하면 요약이 닫힌다
})

test('결정 큐: 맨 위에서 교착을 고르면 처리 카드로 간다', async ({ page }) => {
  await mockApi(page, 'deadlock')
  await page.goto('/#/run')
  const queue = page.getByRole('region', { name: /결정 큐/ })
  await expect(queue.getByRole('button')).toHaveCount(1)
  await expect(queue).toContainText('t3')
  await page.screenshot({ path: 'test-results/decision-queue.png' })
  await page.keyboard.press('j')
  await page.keyboard.press('Enter')
  await expect(panel(page).getByRole('tab', { name: /주의/ })).toHaveAttribute('aria-selected', 'true')
  await expect(panel(page).getByLabel('지침')).toBeFocused()
})

test.describe('S4: 교착을 푼다', () => {
  test('근거를 보고 지침을 보내면 카드가 사라지고 주의가 0이 된다', async ({ page }) => {
    const mock = await mockApi(page, 'deadlock')
    const humanId = mock.fixture.ids.human!
    mock.onPost(`/api/human/${humanId}`, (body) => {
      const b = body as { action: string; text: string }
      mock.push({ type: 'GUIDANCE', from: 'user', to: 'controller', task: 't3', payload: { action: b.action, text: b.text, resolves: humanId } })
    })
    await page.goto('/#/run')
    await attentionBtn(page, 1).click()

    const card = page.locator('.acard')
    await expect(attentionBtn(page, 1)).toHaveClass(/is-alert/)
    await expect(card.getByRole('heading', { name: /t3 · 같은 지적 반복/ })).toBeVisible()
    await expect(card.getByRole('list', { name: '반복된 지적' })).toContainText('F-3-1')
    await expect(card.getByText('마스터가 시도한 지침')).toBeVisible()
    await expect(card).toContainText('저장 키를 todo.items 하나로 통일하고')

    // (선택) 근거 보기 → 상세 [사람용]
    await card.getByRole('button', { name: '근거 보기' }).click()
    await expect(panel(page).getByRole('tab', { name: '상세' })).toHaveAttribute('aria-selected', 'true')
    await expect(panel(page).getByRole('heading', { name: /t3 · 완료 상태가/ })).toBeVisible()
    await panel(page).getByRole('tab', { name: /^주의/ }).click()

    await card.getByLabel('지침').fill('persist.ts에서 로드 시 완료 필드를 덮어쓰지 마세요')
    await card.getByRole('button', { name: '지침 보내기' }).click()

    await expect(page.getByText('지금 사람이 처리할 일이 없습니다')).toBeVisible()
    await expect(attentionBtn(page, 0)).toBeVisible()
    const sent = mock.calls.filter((c) => c.path === `/api/human/${humanId}`)
    expect(sent).toEqual([{ method: 'POST', path: `/api/human/${humanId}`, body: { action: 'guidance', text: 'persist.ts에서 로드 시 완료 필드를 덮어쓰지 마세요', restartSession: false } }])
  })

  test('다른 곳에서 먼저 응답했으면 409 → "이미 처리됨"', async ({ page }) => {
    const mock = await mockApi(page, 'deadlock')
    mock.onPost(`/api/human/${mock.fixture.ids.human!}`, () => ({ status: 409, json: { error: '이미 처리됨' } }))
    await page.goto('/#/run')
    await attentionBtn(page, 1).click()
    const card = page.locator('.acard')
    await card.getByLabel('지침').fill('다시 시도해 주세요')
    await card.getByRole('button', { name: '지침 보내기' }).click()
    await expect(card.getByText('이미 처리됨')).toBeVisible()
    await expect(card.getByRole('button', { name: '지침 보내기' })).toHaveCount(0)
    expect(mock.calls.filter((c) => c.path.startsWith('/api/human/'))).toHaveLength(1)
  })

  test('건너뛰기는 한 번 더 확인하고, 의존 태스크도 함께 건너뛴다고 알려 준다', async ({ page }) => {
    const mock = await mockApi(page, 'deadlock')
    const humanId = mock.fixture.ids.human!
    mock.onPost(`/api/human/${humanId}`, (body) => {
      mock.push({ type: 'STATE_CHANGE', from: 'controller', to: 'all', task: 't3', payload: { taskStatus: 'blocked' } })
      mock.push({ type: 'GUIDANCE', from: 'user', to: 'controller', task: 't3', payload: { action: (body as { action: string }).action, text: '', resolves: humanId } })
    })
    await page.goto('/#/run')
    await attentionBtn(page, 1).click()
    const card = page.locator('.acard')
    await card.getByRole('button', { name: '이 태스크 건너뛰기' }).click()
    expect(mock.calls.filter((c) => c.path.startsWith('/api/human/'))).toHaveLength(0) // 아직 보내지 않음
    const confirm = card.getByRole('button', { name: /정말 건너뛸까요\?.*의존하는 1개 태스크도 함께 건너뜁니다/ })
    await expect(confirm).toBeVisible()
    await confirm.click()
    await expect(board(page).getByRole('heading', { name: '건너뜀 1' })).toBeVisible()
    expect(mock.calls.find((c) => c.path === `/api/human/${humanId}`)?.body).toMatchObject({ action: 'skip' })
  })
})

test.describe('S5: 한도·로그인으로 멈춘 것', () => {
  test('사용량 한도 일시정지는 배너만 뜨고 주의는 늘지 않으며, 재개되면 배너가 사라진다', async ({ page }) => {
    const mock = await mockApi(page, 'paused')
    await page.goto('/#/run')
    const banner = page.locator('.paused-banner')
    await expect(banner).toHaveAttribute('role', 'status')
    await expect(banner).toHaveText('일시정지 · 사용량 한도 — 14:30에 자동 재개 (1시간 12분 남음)')
    await expect(attentionBtn(page, 0)).not.toHaveClass(/is-alert/)
    await expect(page.getByText('지금 사람이 처리할 일이 없습니다')).toBeVisible()

    mock.push({ type: 'RESUMED', from: 'orchestrator', to: 'all' })
    await expect(banner).toHaveCount(0)
    await expect(attentionBtn(page, 0)).toBeVisible()
  })

  test('로그인 만료는 주의 카드로 올라오고, 로그인 전에 재개하면 "아직 로그인되지 않았습니다"', async ({ page }) => {
    const mock = await mockApi(page, 'build')
    let resumes = 0
    mock.onPost('/api/resume', () => {
      resumes += 1
      mock.push({ type: 'RESUMED', from: 'orchestrator', to: 'all' })
      if (resumes === 1) { // 아직 로그인하지 않음 → 바로 다시 로그인 만료
        mock.push({ type: 'PAUSED', from: 'orchestrator', to: 'all', payload: { reason: 'auth' } })
        mock.push({ type: 'HUMAN_REQUIRED', from: 'orchestrator', to: 'user', payload: { reason: 'auth', detail: 'claude 로그인이 만료됐습니다' } })
      }
    })
    await page.goto('/#/run')
    mock.push({ type: 'PAUSED', from: 'orchestrator', to: 'all', payload: { reason: 'auth' } })
    mock.push({ type: 'HUMAN_REQUIRED', from: 'orchestrator', to: 'user', payload: { reason: 'auth', detail: 'claude 로그인이 만료됐습니다' } })

    // 자동 재개 대기와 구분되는 문구, 그리고 주의 1
    await expect(page.locator('.paused-banner')).toHaveText('일시정지 · 로그인 만료 — 터미널에서 다시 로그인 필요')
    await expect(attentionBtn(page, 1)).toHaveClass(/is-alert/)
    const card = page.locator('.acard')
    await expect(card.getByRole('heading', { name: '터미널에서 다시 로그인 필요' })).toBeVisible()
    await expect(card).toContainText('/login')
    await expect(card.getByRole('textbox')).toHaveCount(0) // 비밀번호·지침 입력란 없음

    await card.getByRole('button', { name: '로그인했어요, 재개' }).click()
    expect(mock.calls).toContainEqual({ method: 'POST', path: '/api/resume' })
    await expect(page.getByText('아직 로그인되지 않았습니다')).toBeVisible()
    await expect(page.locator('.acard')).toHaveCount(1) // 이전 카드는 재개로 정리되고 새 카드만 남는다

    // 이번엔 로그인을 마치고 재개: 배너와 카드가 사라진다
    await page.getByRole('button', { name: '로그인했어요, 재개' }).click()
    await expect(page.locator('.paused-banner')).toHaveCount(0)
    await expect(page.getByText('지금 사람이 처리할 일이 없습니다')).toBeVisible()
    await expect(attentionBtn(page, 0)).toBeVisible()
    expect(mock.calls.filter((c) => c.path === '/api/resume')).toHaveLength(2)
  })
})

test('S6: 보드 → 사람용 → 원본 → 프롬프트, 클릭 두 번', async ({ page }) => {
  const mock = await mockApi(page, 'deadlock')
  await page.goto('/#/run')

  // 1. 보드에서 t3
  await board(page).getByRole('button', { name: /^t3 / }).click()
  const doc = panel(page)
  await expect(doc.getByRole('tab', { name: '사람용' })).toHaveAttribute('aria-selected', 'true')
  await expect(doc.getByRole('heading', { name: '1회차 — 검수 반려' })).toBeVisible()
  await expect(doc.getByRole('heading', { name: '2회차 — 하네스 반려' })).toBeVisible()
  await expect(doc.getByRole('heading', { name: '3회차 — 같은 지적 반복' })).toBeVisible()

  // 2. 2회차 [원본] → 원본 탭: 봉투 JSON과 프롬프트 전문
  await doc.getByRole('link', { name: '원본' }).nth(1).click()
  const r2 = mock.fixture.ids.t3r2!
  await expect(doc.getByRole('tab', { name: '원본' })).toHaveAttribute('aria-selected', 'true')
  await expect(doc.locator('.raw-block').filter({ has: page.getByRole('heading', { name: 'Envelope' }) })).toContainText(`"id": "${r2}"`)
  await expect(doc.locator('.raw-block').filter({ has: page.getByRole('heading', { name: '프롬프트' }) })).toContainText('직전 검수가 F-3-1(새로고침 후 완료 상태가 사라짐)을 지적했습니다')
})

test('S6: 마스터에게 묻기 — 답에 인용된 메시지 ID를 누르면 원본으로 간다', async ({ page }) => {
  const mock = await mockApi(page, 'deadlock')
  const cited = mock.fixture.ids.t3rej3!
  mock.onPost('/api/ask', () => ({ json: { answer: `t3은 같은 지적 F-3-1이 세 번 반복돼 오래 걸렸습니다. [원본](../raw/events.jsonl#${cited})` } }))
  await page.goto('/#/run')
  await expect(page.getByText('사용량을 씁니다')).toBeVisible()
  await page.getByRole('textbox', { name: '마스터에게 묻기' }).fill('t3이 왜 세 번 걸렸어?')
  await page.getByRole('button', { name: '묻기', exact: true }).click()
  expect(mock.calls).toContainEqual({ method: 'POST', path: '/api/ask', body: { question: 't3이 왜 세 번 걸렸어?' } })
  await page.getByRole('region', { name: '마스터 답변' }).getByRole('link', { name: '원본' }).click()
  await expect(panel(page).getByRole('tab', { name: '원본' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel(page)).toContainText(`"id": "${cited}"`)
})

test.describe('S7: 완료된 결과 검토와 공유', () => {
  test('보고서 → 근거 링크 → 원본, 되돌아오기', async ({ page }) => {
    const mock = await mockApi(page, 'done')
    await page.goto('/#/run')
    await expect(page.getByRole('heading', { name: '최종 평가', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: '수용 기준별 결과' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: '숫자로 보기' })).toContainText('반려')

    await page.locator('.done-article').getByRole('link', { name: '원본' }).first().click() // 첫 수용 기준의 근거
    await expect(panel(page).getByRole('tab', { name: '원본' })).toHaveAttribute('aria-selected', 'true')
    await expect(panel(page)).toContainText(`"id": "${mock.fixture.ids.t2ok!}"`)

    await page.getByRole('button', { name: '보고서 보기' }).click()
    await expect(page.getByRole('heading', { name: '최종 평가', level: 1 })).toBeVisible()
  })

  test('Markdown 내려받기는 report.md를 그대로 저장한다', async ({ page }) => {
    const mock = await mockApi(page, 'done')
    await page.goto('/#/run')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown 내려받기' }).click()])
    expect(download.suggestedFilename()).toBe('report.md')
    const chunks: Buffer[] = []
    for await (const c of (await download.createReadStream())!) chunks.push(c as Buffer)
    expect(Buffer.concat(chunks).toString('utf8')).toBe(mock.fixture.human['report.md'])
  })
})

test('파이프라인 개요: 열고, 검수 중인 태스크 링크로 관제 화면의 상세로 돌아온다', async ({ page }) => {
  await mockApi(page, 'build')
  await page.goto('/#/run')
  await page.getByRole('button', { name: '개요' }).click()
  const overview = page.getByRole('region', { name: '파이프라인 개요' })
  await expect(overview).toBeVisible()
  await expect(overview.getByRole('heading', { level: 2 })).toContainText('파이프라인 개요')
  await expect(board(page)).toHaveCount(0)

  await overview.getByRole('button', { name: '지금 t2 검수 중' }).click()
  await expect(overview).toHaveCount(0)
  await expect(board(page).getByRole('button', { name: /^t2 / })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel(page).getByRole('tab', { name: '상세' })).toHaveAttribute('aria-selected', 'true')
})
