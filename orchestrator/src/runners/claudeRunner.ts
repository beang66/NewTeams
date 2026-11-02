import type { Config } from '../config.js'
import { classifyClaudeFailure, parseClaudeStream } from './streamParsers.js'
import { rawLogAppender, spawnCli } from './spawnCli.js'
import { RunnerError, type Runner, type RunRequest, type RunResult } from './types.js'

export class ClaudeRunner implements Runner {
  constructor(private cfg: Config) {}

  async run(req: RunRequest): Promise<RunResult> {
    // 사용자 전역 설정(플러그인·훅·MCP)을 싣지 않는다: 저장소 내용을 읽는 에이전트가 메모리 플러그인·커넥터에 닿지 않게.
    const args = ['-p', '--output-format', 'stream-json', '--verbose']
    if (!req.userSettings) args.push('--setting-sources', 'project,local', '--strict-mcp-config')
    if (req.effort) args.push('--effort', req.effort)
    if (req.model !== 'default') args.push('--model', req.model)
    if (req.resumeSessionId) args.push('--resume', req.resumeSessionId)
    if (req.fork) args.push('--fork-session')
    if (req.allowedTools?.length) args.push('--allowedTools', req.allowedTools.join(','))
    for (const d of req.addDirs ?? []) args.push('--add-dir', d)
    if (req.mcpConfig) args.push('--mcp-config', req.mcpConfig)
    if (req.role === 'dev' || req.role === 'qa' || req.acceptEdits) args.push('--permission-mode', 'acceptEdits')

    const r = await spawnCli(this.cfg.claudeBin, args, {
      cwd: req.cwd, stdin: req.prompt, timeoutMs: req.timeoutMs, onLine: rawLogAppender(req.rawLogPath), signal: req.signal,
    })
    if (r.timedOut) throw new RunnerError('timeout', `claude timed out after ${req.timeoutMs}ms`)
    if (r.exitCode !== 0) throw classifyClaudeFailure(r.stdoutLines, r.stderr, r.exitCode)
    return parseClaudeStream(r.stdoutLines)
  }
}
