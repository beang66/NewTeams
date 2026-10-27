import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createProgram, resolveDashboardDir, runTerminalChat } from '../src/cli.js'
import { Workflow } from '../src/engine/workflow.js'
import { fakeDeps, makeScript } from './fixtures/scripts/common.js'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'orch-cli-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }) })
it('new uses config, rejects duplicate names and path escapes', async () => {
  const config = join(root, 'config.json')
  await fs.writeFile(config, JSON.stringify({ projectsDir: join(root, 'projects') }))
  const run = (name: string) => createProgram().parseAsync(['node', 'orch', '--config', config, 'new', name])
  await run('todo')
  expect(await fs.stat(join(root, 'projects/todo/workspace/.git'))).toBeTruthy()
  await expect(run('todo')).rejects.toThrow('이미 존재')
  await expect(run('../escape')).rejects.toThrow('프로젝트 이름')
})
it('terminal chat displays draft and approves without launching any build runners', async () => {
  const deps = fakeDeps(makeScript())
  const wf = await Workflow.open(join(root, 'project'), deps)
  let text = ''
  const output = new Writable({ write(chunk, _encoding, done) { text += chunk.toString(); done() } })
  await runTerminalChat(wf, Readable.from(['할 일 앱\n/approve\n']), output)
  expect(wf.state().stage).toBe('SPEC_APPROVED')
  expect(text).toContain('스펙')
  expect(deps.claude.calls.map((call) => call.role)).toEqual(['master'])
})
it('terminal EOF and /exit leave the spec unapproved', async () => {
  const wf = await Workflow.open(join(root, 'project'), fakeDeps(makeScript()))
  const output = new Writable({ write(_chunk, _encoding, done) { done() } })
  await runTerminalChat(wf, Readable.from(['/exit\n']), output)
  expect(wf.state().stage).toBe('INTAKE')
})

it('configure generates independent AI choices and never overwrites an existing file', async () => {
  const file = join(root, 'agents.json')
  const args = ['node', 'orch', 'configure', '--master', 'codex', '--worker', 'claude', '--worker-model', 'sonnet', '--output', file]
  await createProgram().parseAsync(args)
  expect(JSON.parse(await fs.readFile(file, 'utf8')).agents).toEqual({ master: { provider: 'codex' }, worker: { provider: 'claude', model: 'sonnet' } })
  await expect(createProgram().parseAsync(args)).rejects.toThrow(/EEXIST/)
})

it('resolveDashboardDir uses an explicit dir, else the repo dashboard/dist only when index.html exists', async () => {
  const dist = join(root, 'dist')
  await fs.mkdir(dist)
  expect(resolveDashboardDir(dist)).toBe(dist)
  const fallback = resolveDashboardDir()
  const real = join(process.cwd(), '..', 'dashboard', 'dist')
  const exists = await fs.stat(join(real, 'index.html')).then(() => true, () => false)
  expect(fallback).toBe(exists ? real : undefined)
})
