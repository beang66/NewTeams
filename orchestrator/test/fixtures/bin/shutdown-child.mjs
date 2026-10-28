import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [mode, dir] = process.argv.slice(2)
if (mode === 'heartbeat') {
  writeFileSync(join(dir, 'descendant.pid'), String(process.pid))
  setInterval(() => appendFileSync(join(dir, 'heartbeat'), '.'), 25)
} else if (mode === 'worker') {
  writeFileSync(join(dir, 'worker.pid'), String(process.pid))
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'heartbeat', dir], { stdio: 'inherit', windowsHide: true })
  setInterval(() => {}, 1000)
} else {
  const { installCliShutdown, installServeShutdown } = await import('../../../src/cli.ts')
  const { spawnCli } = await import('../../../src/runners/spawnCli.ts')
  const { runChecks } = await import('../../../src/harness/checks.ts')
  const app = { close: async () => {
    appendFileSync(join(dir, 'closed'), 'yes')
    if (mode === 'close-error') throw new Error('fake close failure')
    if (mode === 'close-hang') await new Promise(() => {})
  }, addHook: () => {} }
  if (mode === 'terminal') installCliShutdown()
  else installServeShutdown(app)
  const args = [fileURLToPath(import.meta.url), 'worker', dir]
  if (mode === 'harness') {
    void runChecks(dir, [`"${process.execPath}" ${args.map(a => `"${a}"`).join(' ')}`, `"${process.execPath}" -e "require('fs').writeFileSync('unexpected','yes')"`], 60_000).catch(() => {})
  } else {
    void spawnCli(process.execPath, args, { cwd: dir, stdin: '', timeoutMs: 60_000 }).then(() => {
      void spawnCli(process.execPath, ['-e', "require('fs').writeFileSync('unexpected','yes')"], { cwd: dir, stdin: '', timeoutMs: 60_000 }).catch(() => {})
    })
  }
  // Windows cannot deliver Unix signals to a child. Emitting invokes the same installed handler.
  process.stdin.on('data', () => { process.emit('SIGTERM'); process.emit('SIGINT') })
}
