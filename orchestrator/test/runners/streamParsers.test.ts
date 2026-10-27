import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseClaudeStream, parseCodexStream, classifyClaudeFailure, classifyFailure } from '../../src/runners/streamParsers.js'
import { RunnerError } from '../../src/runners/types.js'
import { VerdictSchema } from '../../src/protocol/messages.js'

const fx = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const lines = (rel: string): string[] => readFileSync(join(fx, rel), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)

describe('parseClaudeStream', () => {
  it('claude 픽스처를 파싱', () => {
    const r = parseClaudeStream(lines('claude/simple.jsonl'))
    expect(r.sessionId).toMatch(/[0-9a-f-]{36}/); expect(r.text).toContain('OK'); expect(r.usage.in).toBeGreaterThan(0)
  })
  it('fork 결과의 sessionId는 원본과 다르다', () => {
    expect(parseClaudeStream(lines('claude/resume-fork.jsonl')).sessionId).not.toBe(parseClaudeStream(lines('claude/simple.jsonl')).sessionId)
  })
  it('usage 매핑을 픽스처 숫자로 고정 (in = input + cache_creation + cache_read)', () => {
    expect(parseClaudeStream(lines('claude/simple.jsonl')).usage).toEqual({ in: 2 + 34951 + 26449, cached: 26449, out: 4, costUsd: 0.007256890000000001 })
  })
  it('JSON이 아닌 경고 줄이 섞여도 파싱한다', () => {
    const l = lines('claude/simple.jsonl'); l.splice(1, 0, 'Warning: something deprecated', '')
    expect(parseClaudeStream(l).text).toContain('OK')
  })
  it('결과 줄이 없으면 format 오류', () => {
    const l = lines('claude/simple.jsonl').slice(0, -1)
    expect(() => parseClaudeStream(l)).toThrowError(RunnerError)
    try { parseClaudeStream(l) } catch (e) { expect((e as RunnerError).kind).toBe('format') }
  })
  it('실제 session limit 응답은 구조화된 resetsAt을 사용한다', () => {
    try { parseClaudeStream(lines('claude/session-limit.jsonl')); expect.unreachable() } catch (error) {
      expect(error).toMatchObject({ kind: 'rate_limit', resetAt: new Date('2026-10-27T05:30:00Z') })
    }
  })
  it('is_error 결과는 classifyFailure로 던진다', () => {
    const l = [JSON.stringify({ type: 'result', is_error: true, result: 'Invalid API key · Please run /login', session_id: 's' })]
    try { parseClaudeStream(l); expect.unreachable() } catch (e) { expect((e as RunnerError).kind).toBe('auth') }
  })
})

describe('classifyClaudeFailure', () => {
  it('allowed 한도 이벤트는 인증 오류를 가리지 않는다', () => {
    const stream = [
      JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1793079000 } }),
      JSON.stringify({ type: 'result', is_error: true, result: 'Please login again' }),
    ]
    expect(classifyClaudeFailure(stream, '', 1).kind).toBe('auth')
  })
  it('잘못된 타임스탬프는 Invalid Date 대신 한도 기본 대기를 사용한다', () => {
    const event = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 'not-a-date' } }
    const error = classifyClaudeFailure([JSON.stringify(event)], '', 1)
    expect(error.kind).toBe('rate_limit')
    expect(Number.isFinite(error.resetAt!.getTime())).toBe(true)
  })
})

describe('parseCodexStream', () => {
  it('simple 픽스처: 텍스트와 usage 매핑 (out = output + reasoning)', () => {
    const r = parseCodexStream(lines('codex/simple.jsonl'))
    expect(r.text).toBe('OK')
    expect(r.usage).toEqual({ in: 20186, cached: 12416, out: 5 })
  })
  it('schema 픽스처의 최종 text는 유효한 JSON', () => {
    expect(() => JSON.parse(parseCodexStream(lines('codex/schema.jsonl')).text)).not.toThrow()
  })
  it('agent_message를 Verdict JSON으로 바꾸면 VerdictSchema로 파싱된다', () => {
    const verdict = '{"verdict":"reject","findings":[{"id":"F-1","severity":"major","file":null,"issue":"x","evidence_ref":null}],"resolved":[]}'
    const l = lines('codex/schema.jsonl').map((s) => {
      const o = JSON.parse(s)
      if (o.type === 'item.completed' && o.item?.type === 'agent_message') o.item.text = verdict
      return JSON.stringify(o)
    })
    expect(VerdictSchema.safeParse(JSON.parse(parseCodexStream(l).text)).success).toBe(true)
  })
  it('turn.completed가 여러 개면 usage를 합산, 마지막 agent_message 사용', () => {
    const t = (i: number, o: number, r?: number) => JSON.stringify({ type: 'turn.completed', usage: { input_tokens: i, cached_input_tokens: 1, output_tokens: o, ...(r !== undefined ? { reasoning_output_tokens: r } : {}) } })
    const m = (text: string) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })
    const r = parseCodexStream([m('first'), t(10, 2, 3), 'junk', m('last'), t(5, 1)])
    expect(r.text).toBe('last'); expect(r.usage).toEqual({ in: 15, cached: 2, out: 6 })
  })
  it('agent_message가 없으면 format 오류', () => {
    try { parseCodexStream(['{"type":"turn.started"}']); expect.unreachable() } catch (e) { expect((e as RunnerError).kind).toBe('format') }
  })
})

describe('classifyFailure', () => {
  const now = new Date(2026, 9, 26, 10, 0, 0)
  it('한도 메시지는 rate_limit, 리셋 시각 파싱', () => {
    const e = classifyFailure('Claude usage limit reached. Your limit will reset at 2pm (Asia/Seoul).', 1)
    expect(e.kind).toBe('rate_limit'); expect(e.resetAt).toBeInstanceOf(Date)
  })
  it('reset at 2pm / 2:30pm / 14:00', () => {
    expect(classifyFailure('rate limit; reset at 2pm', 1, now).resetAt).toEqual(new Date(2026, 9, 26, 14, 0))
    expect(classifyFailure('rate limit; reset at 2:30pm', 1, now).resetAt).toEqual(new Date(2026, 9, 26, 14, 30))
    expect(classifyFailure('usage limit, resets at 14:00', 1, now).resetAt).toEqual(new Date(2026, 9, 26, 14, 0))
  })
  it('이미 지난 시각은 다음 날', () => {
    expect(classifyFailure('rate limit; reset at 9am', 1, now).resetAt).toEqual(new Date(2026, 9, 27, 9, 0))
  })
  it('ISO 시각', () => {
    expect(classifyFailure('rate limit, reset at 2026-10-27T03:00:00Z', 1, now).resetAt).toEqual(new Date('2026-10-27T03:00:00Z'))
  })
  it('파싱 불가면 now + 1h', () => {
    expect(classifyFailure('429 too many', 1, now).resetAt).toEqual(new Date(now.getTime() + 3600_000))
  })
  it('인증 오류는 auth', () => { expect(classifyFailure('Invalid API key · Please run /login', 1).kind).toBe('auth') })
  it('한도와 인증이 같이 매치되면 rate_limit', () => {
    expect(classifyFailure('usage limit reached, please login again', 1).kind).toBe('rate_limit')
  })
  it('그 밖은 crash', () => { expect(classifyFailure('segfault', 139).kind).toBe('crash') })
})
