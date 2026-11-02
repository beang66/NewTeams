import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type { Config } from '../config.js'
import { classifyFailure, parseCodexStream } from './streamParsers.js'
import { rawLogAppender, spawnCli } from './spawnCli.js'
import { RunnerError, type Runner, type RunRequest, type RunResult } from './types.js'

function codexFailureMessage(lines: string[]): string | undefined {
  const msgs: string[] = []
  for (const l of lines) {
    const s = l.trim()
    if (!s.startsWith('{')) continue
    try {
      const o = JSON.parse(s)
      if (o?.type === 'turn.failed') msgs.push(String(o.error?.message ?? 'turn failed'))
      else if (o?.type === 'error') msgs.push(String(o.message ?? 'error'))
    } catch { /* JSON 아닌 줄 */ }
  }
  return msgs.length ? msgs.join('\n') : undefined
}

export class CodexRunner implements Runner {
  constructor(private cfg: Config) {}

  async run(req: RunRequest): Promise<RunResult> {
    let tmp: string | undefined
    try {
      const sandbox = req.role === 'dev' || req.role === 'qa' ? 'workspace-write' : 'read-only'
      const args = ['exec', '--json', '--skip-git-repo-check', '-C', req.cwd]
      // --approve-for-me already selects workspace-write and conflicts with --sandbox.
      if (sandbox === 'workspace-write') args.push('--approve-for-me')
      else args.push('--sandbox', 'read-only')
      if (req.model !== 'codex-default' && req.model !== 'default') args.push('--model', req.model)
      for (const dir of req.addDirs ?? []) args.push('--add-dir', dir)
      if (req.mcpConfig) {
        const config = JSON.parse(readFileSync(req.mcpConfig, 'utf8')) as { mcpServers: Record<string, { command: string; args: string[] }> }
        for (const [name, server] of Object.entries(config.mcpServers)) {
          if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid MCP server name')
          args.push('-c', `mcp_servers.${name}.command=${JSON.stringify(server.command)}`, '-c', `mcp_servers.${name}.args=${JSON.stringify(server.args)}`)
        }
      }
      // 이미지·출력 스키마는 이어갈 때 resume/fork 하위 명령의 옵션이어야 다음 프롬프트에 붙는다.
      const promptOpts: string[] = []
      for (const img of req.images ?? []) promptOpts.push('-i', img)
      if (req.outputSchema) {
        tmp = mkdtempSync(join(os.tmpdir(), 'codex-schema-'))
        const file = join(tmp, 'schema.json')
        writeFileSync(file, JSON.stringify(req.outputSchema), 'utf8')
        promptOpts.push('--output-schema', file)
      }
      if (req.resumeSessionId) args.push(req.fork ? 'fork' : 'resume', ...promptOpts, req.resumeSessionId)
      else args.push(...promptOpts)
      args.push('-')

      const r = await spawnCli(this.cfg.codexBin, args, {
        cwd: req.cwd, stdin: req.prompt, timeoutMs: req.timeoutMs, onLine: rawLogAppender(req.rawLogPath),
      })
      if (r.timedOut) throw new RunnerError('timeout', `codex timed out after ${req.timeoutMs}ms`)
      const eventMsg = codexFailureMessage(r.stdoutLines)
      if (eventMsg !== undefined || r.exitCode !== 0) {
        throw classifyFailure(`${eventMsg ?? ''}\n${r.stderr}`, r.exitCode || 1)
      }
      return parseCodexStream(r.stdoutLines)
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true })
    }
  }
}
