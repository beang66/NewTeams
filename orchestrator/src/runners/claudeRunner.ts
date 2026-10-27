import type { Config } from '../config.js'
import { classifyClaudeFailure, parseClaudeStream } from './streamParsers.js'
import { rawLogAppender, spawnCli } from './spawnCli.js'
import { RunnerError, type Runner, type RunRequest, type RunResult } from './types.js'

export class ClaudeRunner implements Runner {
  constructor(private cfg: Config) {}

  async run(req: RunRequest): Promise<RunResult> {
    const args = ['-p', '--output-format', 'stream-json', '--verbose']
    if (req.model !== 'default') args.push('--model', req.model)
    if (req.resumeSessionId) args.push('--resume', req.resumeSessionId)
    if (req.fork) args.push('--fork-session')
    if (req.allowedTools?.length) args.push('--allowedTools', req.allowedTools.join(','))
    for (const d of req.addDirs ?? []) args.push('--add-dir', d)
    if (req.mcpConfig) args.push('--mcp-config', req.mcpConfig)
    if (req.role === 'dev' || req.role === 'qa') args.push('--permission-mode', 'acceptEdits')

    const r = await spawnCli(this.cfg.claudeBin, args, {
      cwd: req.cwd, stdin: req.prompt, timeoutMs: req.timeoutMs, onLine: rawLogAppender(req.rawLogPath),
    })
    if (r.timedOut) throw new RunnerError('timeout', `claude timed out after ${req.timeoutMs}ms`)
    if (r.exitCode !== 0) throw classifyClaudeFailure(r.stdoutLines, r.stderr, r.exitCode)
    return parseClaudeStream(r.stdoutLines)
  }
}
