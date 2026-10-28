import { describe, expect, it } from 'vitest'
import type { Envelope, Finding } from '../../src/protocol/messages.js'
import { initialState, type RunState } from '../../src/store/state.js'
import { hhmm } from '../../src/render/humanRenderer.js'
import { clip, detailText, messageForEvent, reportSummary, stageLabel, statusText, tasksText, type FormatContext } from '../../src/telegram/format.js'
import { approve, assign, chat, guidance, humanRequired, planOf, reject as rejectEv, resumed, paused, stage } from '../helpers.js'

const F = (id: string, severity: Finding['severity'], issue: string): Finding => ({ id, severity, issue })
const reject = (task: string, findings: Finding[], round = 1): Envelope => rejectEv(task, round, findings)
const human = (id: string, task: string, reason: string, detail?: string): Envelope => ({ ...humanRequired(task, reason, detail), id })
const specChat = (): Envelope => ({ ...chat('master', '스펙 초안'), payload: { text: '스펙 초안', specApprovalRequired: true } })

const baseState: RunState = { ...structuredClone(initialState) }
const ctx: FormatContext = { events: [], state: baseState, plan: null, dashboardUrl: 'http://localhost:4000' }
const ctxWith = (events: Envelope[]): FormatContext => ({ ...ctx, events })
const ctxStage = (s: string): FormatContext => ctxWith([stage(s)])

describe('messageForEvent', () => {
  it('교착 알림: 첫 줄, 소리, 버튼 3개', () => {
    const m = messageForEvent(human('msg-0058', 't3', 'repeat_finding'), ctxWith([reject('t3', [F('F-3-1', 'major', '새로고침 후 완료 상태가 사라짐')])]))!
    expect(m.text.split('\n')[0]).toBe('🔴 t3 사람 필요 — 같은 지적 반복: 새로고침 후 완료 상태가 사라짐')
    expect(m.silent).toBe(false)
    expect(m.kind).toBe('human')
    expect(m.eventId).toBe('msg-0058')
    expect(m.buttons!.flat().map((b) => b.callback?.kind)).toEqual(['guide', 'skip', 'detail'])
  })
  it('교착 알림: minor보다 blocker/major 지적을 고른다', () => {
    const m = messageForEvent(human('msg-1', 't3', 'reject_limit'), ctxWith([reject('t3', [F('a', 'minor', '사소'), F('b', 'blocker', '치명')])]))!
    expect(m.text.split('\n')[0]).toBe('🔴 t3 사람 필요 — 반려 상한 도달: 치명')
  })
  it('login: auth / openai_cap', () => {
    const a = messageForEvent(human('msg-2', 't1', 'auth'), ctx)!
    expect(a).toMatchObject({ kind: 'login', silent: false, text: '🔴 멈춤 — 터미널에서 다시 로그인 필요' })
    expect(a.buttons!.flat().map((b) => b.callback?.kind)).toEqual(['resume'])
    expect(messageForEvent(human('msg-3', 't1', 'openai_cap'), ctx)!.text.split('\n')[0]).toBe('🔴 멈춤 — OpenAI API 지출 상한($8) 도달')
  })
  it('workflow_error는 error + 자세히 버튼', () => {
    const m = messageForEvent(human('msg-4', 't1', 'workflow_error', '부서짐'), ctx)!
    expect(m.kind).toBe('error')
    expect(m.buttons!.flat().map((b) => b.callback?.kind)).toEqual(['detail'])
  })
  it('스펙 초안: 승인 + url 버튼', () => {
    const m = messageForEvent(specChat(), ctx)!
    expect(m).toMatchObject({ kind: 'spec', silent: false })
    expect(m.text.split('\n')[0]).toBe('🟣 스펙 초안 준비됨 — 승인하면 작업을 시작합니다')
    expect(m.buttons!.flat().map((b) => b.callback?.kind ?? 'url')).toEqual(['approve', 'url'])
  })
  it('스펙 요약: 구현 범위 bullet 우선, 없으면 첫 줄', () => {
    const a = messageForEvent(specChat(), { ...ctx, specSummary: ['# 제목', '구현 범위', '- 할 일 목록', '- 완료 표시', '', '제외', '- 인증'] })!
    expect(a.text).toContain('- 할 일 목록')
    expect(a.text).toContain('- 완료 표시')
    expect(a.text).not.toContain('인증')
    const b = messageForEvent(specChat(), { ...ctx, specSummary: ['첫 줄 요약', '둘째 줄'] })!
    expect(b.text).toContain('첫 줄 요약')
    expect(b.text).not.toContain('둘째 줄')
  })
  it('dashboardUrl이 없으면 url 버튼을 만들지 않는다', () => {
    expect(messageForEvent(specChat(), { ...ctx, dashboardUrl: null })!.buttons!.flat().some((b) => b.url)).toBe(false)
  })
  it('사용자 CHAT / 승인 요구 없는 마스터 CHAT은 null', () => {
    expect(messageForEvent(chat('user', 'hi'), ctx)).toBeNull()
    expect(messageForEvent(chat('master', 'hi'), ctx)).toBeNull()
  })
  it('단계 전환은 무음, 버튼 없음', () => {
    const m = messageForEvent(stage('BUILD'), ctxStage('PLAN'))!
    expect(m).toMatchObject({ kind: 'stage', silent: true, text: '기획 → 개발' })
    expect(m.buttons).toBeUndefined()
  })
  it('이전 단계가 없으면 새 라벨만', () => {
    expect(messageForEvent(stage('BUILD'), ctx)!.text).toBe('개발')
  })
  it('DONE: 수용 기준 집계 / 없으면 기본', () => {
    const d = stage('DONE')
    const a = messageForEvent(d, { ...ctx, reportMd: '# 보고\n수용 기준 7 / 9 충족' })!
    expect(a).toMatchObject({ kind: 'done', silent: false })
    expect(a.text.split('\n')[0]).toBe('✅ 완료 — 수용 기준 7/9')
    expect(a.buttons!.flat().map((b) => b.callback?.kind)).toEqual(['report'])
    expect(messageForEvent(d, ctx)!.text.split('\n')[0]).toBe('✅ 완료')
  })
  it('paused / resumed', () => {
    const until = '2026-10-26T05:30:00.000Z'
    expect(messageForEvent(paused('rate_limit', until), ctx)).toMatchObject({
      kind: 'paused', silent: true, text: `⏸ 일시정지 — 사용량 한도, ${hhmm(until)} 재개 예정`,
    })
    expect(messageForEvent(resumed(), ctx)).toMatchObject({ kind: 'resumed', silent: true, text: '▶ 재개' })
  })
  it('APPROVE는 approved/무음', () => {
    expect(messageForEvent(approve('t1'), ctx)).toMatchObject({ kind: 'approved', silent: true })
  })
  it('알리지 않는 이벤트는 null', () => {
    expect(messageForEvent(assign('t1'), ctx)).toBeNull()
  })
})

describe('detailText', () => {
  it('반복 지적, 지침, 회차를 담고 원본 프롬프트·diff는 없다', () => {
    const hr = { ...human('msg-0058', 't3', 'repeat_finding'), promptRef: 'raw/prompts/x.md' }
    const events = [
      reject('t3', [F('F-3-1', 'major', '상태 사라짐')], 1),
      guidance('t3', 'hint', '```\ndiff --git a b\n```\n상태를 저장하세요'),
      reject('t3', [F('F-3-1', 'major', '상태 사라짐'), F('F-3-2', 'minor', '오타')], 2),
      hr,
    ]
    const t = detailText('msg-0058', ctxWith(events))
    expect(t).toContain('F-3-1')
    expect(t).toContain('major')
    expect(t).toContain('상태 사라짐')
    expect(t).toContain('상태를 저장하세요')
    expect(t).toContain('2회차')
    expect(t).not.toMatch(/raw\/prompts|```|diff --git/)
  })
  it('없는 이벤트', () => {
    expect(detailText('msg-9999', ctx)).toContain('찾을 수 없')
  })
})

describe('sanitize (via messages)', () => {
  const body = 'SECRET_BODY_TEXT'
  const dirty = ['앞 문장', 'FENCE', "const x = '" + body + "'", 'FENCE', 'diff --git a/f b/f', 'index 1..2', '--- a/f', '+++ b/f', '@@ -1 +1 @@', '-' + body + 'OLD', '+' + body + 'NEW', '뒤 문장'].join('\n').replaceAll('FENCE', '```')
  it('코드 블록 본문과 diff 줄이 지침/지적/상세에 남지 않는다', () => {
    const events = [reject('t3', [F('F-1', 'major', dirty)]), guidance('t3', 'hint', dirty), human('msg-7', 't3', 'repeat_finding', dirty)]
    const m = messageForEvent(events[2]!, ctxWith(events))!
    const d = detailText('msg-7', ctxWith(events))
    for (const t of [m.text, d]) {
      expect(t).not.toContain(body)
      expect(t).not.toMatch(/@@|\+\+\+|---|index 1/)
    }
    expect(m.text).toContain('앞 문장')
    expect(d).toContain('앞 문장')
  })
  it('닫히지 않은 펜스는 끝까지 제거, 긴 줄은 200자로', () => {
    const m = messageForEvent(human('msg-8', 't1', 'workflow_error', 'ok\n```\n' + body), ctx)!
    expect(m.text).not.toContain(body)
    const long = messageForEvent(human('msg-9', 't1', 'workflow_error', '가'.repeat(500)), ctx)!
    expect(long.text.length).toBeLessThan(260)
  })
  it('specSummary도 정제한다', () => {
    const m = messageForEvent(specChat(), { ...ctx, specSummary: ['구현 범위', '- 항목', '```', body, '```'] })!
    expect(m.text).not.toContain(body)
  })
  it('여러 줄 specSummary의 코드 블록 안 목록도 제거한다', () => {
    const m = messageForEvent(specChat(), { ...ctx, specSummary: ['구현 범위', '```', '- ' + body, '```', '- 안전한 요약'] })!
    expect(m.text).not.toContain(body)
    expect(m.text).toContain('안전한 요약')
  })
  it('사유가 없으면 알 수 없음', () => {
    expect(messageForEvent({ ...human('msg-10', 't1', 'x'), payload: {} }, ctx)!.text.split('\n')[0]).toBe('🔴 t1 사람 필요 — 알 수 없음')
  })
})

describe('clip', () => {
  it('짧으면 그대로', () => { expect(clip('abc')).toBe('abc') })
  it('4096 안에서 서로게이트를 자르지 않는다', () => {
    const long = '가'.repeat(3000) + '😀'.repeat(1000)
    const c = clip(long)
    expect(c.length).toBeLessThanOrEqual(3900 + 20)
    expect(c).toMatch(/…\(대시보드에서 보기\)$/)
    expect(() => encodeURIComponent(c)).not.toThrow()
  })
  it('경계가 서로게이트 중간이면 한 칸 줄인다', () => {
    const c = clip('a' + '😀'.repeat(10), 2)
    expect(() => encodeURIComponent(c)).not.toThrow()
    expect(c.startsWith('a')).toBe(true)
  })
})

describe('statusText / tasksText / reportSummary', () => {
  const st: RunState = {
    ...baseState, stage: 'BUILD', humanRequired: ['msg-1'], paused: { reason: 'rate_limit' },
    tasks: { t1: { status: 'running', round: 1 }, t2: { status: 'rejected', round: 2 }, t3: { status: 'merged', round: 1 } },
  }
  const c = { ...ctx, state: st, plan: planOf(['t1'], ['t2'], ['t3']) }
  it('statusText: 단계, 진행·반려·주의, 일시정지', () => {
    expect(statusText(c)).toMatch(/개발[\s\S]*진행 중 1[\s\S]*반려 1[\s\S]*주의 1[\s\S]*일시정지/)
  })
  it('tasksText: 태스크별 줄', () => {
    const t = tasksText(c)
    expect(t).toContain('t1')
    expect(t).toContain('t2')
    expect(t).toContain('t3')
  })
  it('tasksText: 계획이 없으면 안내', () => {
    expect(tasksText({ ...ctx, state: baseState })).toContain('아직')
  })
  it('reportSummary: null / 코드블록 제거', () => {
    expect(reportSummary(null, ctx)).toContain('아직')
    const r = reportSummary('# 보고\n수용 기준 3/4\n```\ncode\n```\n끝', ctx)
    expect(r).toContain('수용 기준 3/4')
    expect(r).not.toContain('```')
    expect(r).not.toContain('code')
  })
  it('reportSummary는 코드 펜스 없는 diff 본문도 제거한다', () => {
    const r = reportSummary('# 보고\n변경 요약\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-OLD_SECRET\n+NEW_SECRET\n검증 완료', ctx)
    expect(r).not.toMatch(/OLD_SECRET|NEW_SECRET|@@|--- a/)
    expect(r).toContain('검증 완료')
  })
  it('stageLabel', () => { expect(stageLabel('FINAL_QA')).toBe('최종 QA') })
})

describe('plan 태스크 사람 필요', () => {
  it('plan은 건너뛰기 버튼을 제공하지 않는다', () => {
    const m = messageForEvent(human('msg-0070', 'plan', 'repeat_finding'), ctx)!
    expect(m.buttons!.flat().map((b) => b.callback?.kind)).toEqual(['guide', 'detail'])
  })
})
