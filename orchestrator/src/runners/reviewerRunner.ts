import { RunnerError, type Runner, type RunRequest, type RunResult } from './types.js'

/** Codex가 한도(rate_limit)면 같은 요청을 OpenAI로 보낸다. 그 외 오류와 OpenAI 오류(캡 포함)는 그대로 전파. */
export class ReviewerRunner implements Runner {
  constructor(private readonly codex: Runner, private readonly openai: Runner) {}

  async run(req: RunRequest): Promise<RunResult> {
    try {
      return await this.codex.run(req)
    } catch (e) {
      if (e instanceof RunnerError && e.kind === 'rate_limit') return this.openai.run(req)
      throw e
    }
  }
}
