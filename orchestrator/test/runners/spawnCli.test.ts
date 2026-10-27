import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnCli } from '../../src/runners/spawnCli.js'
import { rmDir, tmpDir } from '../helpers.js'

const fakeCli = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'bin', 'fake-cli.mjs')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

let root: string
let dirWithSpace: string
beforeAll(async () => {
  root = await tmpDir()
  dirWithSpace = join(root, 'dir with space')
  mkdirSync(dirWithSpace)
})
afterAll(async () => { await rmDir(root) })

describe('spawnCli', () => {
  it('한글 20KB 프롬프트가 stdin으로 손실 없이 전달된다 (공백 있는 cwd)', async () => {
    const prompt = '가나다라마바사 '.repeat(3000)
    const r = await spawnCli(process.execPath, [fakeCli], { cwd: dirWithSpace, stdin: prompt, timeoutMs: 10_000 })
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdoutLines.at(-1)!).result).toBe(`${Buffer.byteLength(prompt)}:${sha256(prompt)}`)
  })
  it('onLine이 줄마다 호출된다', async () => {
    const seen: string[] = []
    const r = await spawnCli(process.execPath, [fakeCli], { cwd: root, stdin: 'x', timeoutMs: 10_000, onLine: (l) => seen.push(l) })
    expect(seen).toEqual(r.stdoutLines)
    expect(seen.length).toBe(2)
  })
  it('제한 시간 초과 시 프로세스를 죽이고 timedOut', async () => {
    const t0 = Date.now()
    const r = await spawnCli(process.execPath, [fakeCli], { cwd: root, stdin: '', timeoutMs: 300, env: { FAKE_MODE: 'sleep' } })
    expect(r.timedOut).toBe(true)
    expect(Date.now() - t0).toBeLessThan(8000)
  })
  it('0이 아닌 종료 코드와 stderr를 돌려준다', async () => {
    const r = await spawnCli(process.execPath, [fakeCli], { cwd: root, stdin: '', timeoutMs: 10_000, env: { FAKE_MODE: 'limit' } })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('usage limit')
  })
  it('실행 파일이 없으면 reject하지 않고 exitCode 비0', async () => {
    const r = await spawnCli('definitely-not-a-binary-xyz', [], { cwd: root, stdin: '', timeoutMs: 5000 })
    expect(r.exitCode).not.toBe(0)
  })
})
