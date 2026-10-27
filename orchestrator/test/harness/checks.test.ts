import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkOwnership, runChecks, verifyEvidence } from '../../src/harness/checks.js'
import { rmDir, tmpDir } from '../helpers.js'

let root: string
beforeAll(async () => { root = await tmpDir() })
afterAll(async () => { await rmDir(root) })

function evidence(name: string, ts: string, withPng: boolean, mtime?: Date): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify([{ scenarioId: 's1', steps: [{ step: 1, action: 'click', screenshot: 's1-1.png', ts }] }]))
  if (withPng) {
    const p = join(dir, 's1-1.png')
    writeFileSync(p, 'x')
    if (mtime) utimesSync(p, mtime, mtime)
  }
  return dir
}

describe('checkOwnership', () => {
  it('소유 범위 밖 파일', () => { expect(checkOwnership(['src/a.ts', 'src/b.ts'], ['src/a.ts'])).toEqual(['src/b.ts']) })
  it('glob과 역슬래시', () => {
    expect(checkOwnership(['src\\x\\a.ts', 'lib/b.ts'], ['src/**'])).toEqual(['lib/b.ts'])
  })
})

describe('verifyEvidence', () => {
  it('manifest의 캡처가 없으면 실패', async () => {
    const r = await verifyEvidence(evidence('missing', '2026-10-26T16:00:00Z', false), new Date(0))
    expect(r.ok).toBe(false); expect(r.problems[0]).toContain('없음')
  })
  it('캡처 시각이 마지막 코드 변경보다 이전이면 실패', async () => {
    const old = new Date('2026-10-26T10:00:00Z')
    const r = await verifyEvidence(evidence('old', '2026-10-26T10:00:00Z', true, old), new Date('2026-10-26T15:00:00Z'))
    expect(r.ok).toBe(false); expect(r.problems[0]).toContain('코드 변경 이전')
  })
  it('최신이면 통과 (ts와 mtime 중 늦은 쪽)', async () => {
    const r = await verifyEvidence(evidence('fresh', '2026-10-26T10:00:00Z', true, new Date('2026-10-26T16:00:00Z')), new Date('2026-10-26T15:00:00Z'))
    expect(r).toEqual({ ok: true, problems: [] })
  })
  it('manifest 없음/잘못됨', async () => {
    const dir = join(root, 'nomanifest'); mkdirSync(dir)
    const r = await verifyEvidence(dir, new Date(0))
    expect(r.ok).toBe(false); expect(r.problems[0]).toContain('manifest')
    writeFileSync(join(dir, 'manifest.json'), '{"bad":1}')
    expect((await verifyEvidence(dir, new Date(0))).problems[0]).toContain('manifest')
  })
})

describe('runChecks', () => {
  it('runChecks는 실패한 명령을 잡는다', async () => {
    const r = await runChecks(root, ['node -e "process.exit(0)"', 'node -e "process.exit(2)"'], 10_000)
    expect(r.ok).toBe(false)
    expect(r.results.map((x) => x.exitCode)).toEqual([0, 2])
  })
  it('출력은 끝 4000자만', async () => {
    const r = await runChecks(root, ['node -e "process.stdout.write(\'a\'.repeat(5000)+\'END\')"'], 10_000)
    expect(r.results[0].output.length).toBe(4000)
    expect(r.results[0].output.endsWith('END')).toBe(true)
  })
  it('시간 초과', async () => {
    const r = await runChecks(root, ['node -e "setTimeout(()=>{},10000)"'], 300)
    expect(r.ok).toBe(false)
    expect(r.results[0].exitCode).toBe(-1)
    expect(r.results[0].output.endsWith('\n(시간 초과)')).toBe(true)
  })
})
