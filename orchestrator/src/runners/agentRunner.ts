import type { AgentProvider, Config } from '../config.js'
import { pickProvider } from '../router/modelRouter.js'
import { ClaudeRunner } from './claudeRunner.js'
import { CodexRunner } from './codexRunner.js'
import type { Runner, RunRequest, RunResult } from './types.js'

/** Route roles independently and keep provider-specific session ids from crossing CLIs. */
export class AgentRunner implements Runner {
  private readonly runners: Record<AgentProvider, Runner>
  constructor(private readonly config: Config, runners?: Record<AgentProvider, Runner>) {
    this.runners = runners ?? { claude: new ClaudeRunner(config), codex: new CodexRunner(config) }
  }

  async run(request: RunRequest): Promise<RunResult> {
    const provider = request.provider ?? pickProvider(request.role, this.config)
    const session = request.resumeSessionId
    const tagged = session ? /^@(claude|codex)\/(.+)$/.exec(session) : null
    const resumeSessionId = tagged ? (tagged[1] === provider ? tagged[2] : undefined) : provider === 'claude' ? session : undefined
    const result = await this.runners[provider].run({ ...request, resumeSessionId, fork: !!resumeSessionId && request.fork })
    return { ...result, ...(result.sessionId ? { sessionId: `@${provider}/${result.sessionId}` } : {}) }
  }
}
