import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const fixture = fileURLToPath(new URL('./fixtures/bin/shutdown-child.mjs', import.meta.url))
let dir: string
let cli: ChildProcess | undefined
afterEach(async () => {
  if (cli?.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(cli.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else cli.kill('SIGKILL')
  }
  for (const file of ['worker.pid', 'descendant.pid']) {
    const pid = await fs.readFile(join(dir, file), 'utf8').then(Number, () => undefined)
    if (pid) { try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ } }
  }
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 })
})

it.each(['runner', 'harness', 'terminal', 'close-error', 'close-hang'])('CLI shutdown stops its %s child tree and schedules no new child', async mode => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orch-shutdown-'))
  cli = spawn(process.execPath, ['--import', 'tsx', fixture, mode, dir], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let errors = ''
  cli.stderr!.on('data', chunk => { errors += chunk.toString() })
  await vi.waitFor(async () => expect(await fs.readFile(join(dir, 'heartbeat'), 'utf8')).not.toBe(''), { timeout: 10_000 })
  const exited = new Promise<number | null>(resolve => cli!.once('exit', resolve))
  const start = Date.now()
  cli.stdin!.write('stop')
  const expectedCode = mode === 'close-error' ? 1 : 0
  await vi.waitFor(() => expect(cli!.exitCode, errors).toBe(expectedCode), { timeout: 5000 })
  expect(await exited).toBe(expectedCode)
  expect(Date.now() - start).toBeLessThan(5000)
  if (mode !== 'terminal') expect(await fs.readFile(join(dir, 'closed'), 'utf8')).toBe('yes')
  const heartbeat = await fs.readFile(join(dir, 'heartbeat'), 'utf8')
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(await fs.readFile(join(dir, 'heartbeat'), 'utf8')).toBe(heartbeat)
  for (const file of ['worker.pid', 'descendant.pid']) {
    const pid = Number(await fs.readFile(join(dir, file), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  }
  expect(await fs.stat(join(dir, 'unexpected')).then(() => true, () => false)).toBe(false)
}, 20_000)
