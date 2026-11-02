import { RunnerError, type Runner, type RunRequest, type RunResult } from './types.js'

/**
 * Codex가 한도(rate_limit)면 같은 요청을 OpenAI로 보낸다. 그 외 오류와 OpenAI 오류(캡 포함)는 그대로 전파.
 * OpenAI는 Codex 세션을 모르므로 이어가기 요청은 세션을 빼고 freshPrompt(전체 프롬프트)로 보낸다.
 */
export class ReviewerRunner implements Runner {
  constructor(private readonly codex: Runner, private readonly openai: Runner) {}

  async run(req: RunRequest): Promise<RunResult> {
    try {
      return await this.codex.run(req)
    } catch (e) {
      if (!(e instanceof RunnerError && e.kind === 'rate_limit')) throw e
      const { resumeSessionId, freshPrompt, ...rest } = req
      return this.openai.run(resumeSessionId && freshPrompt ? { ...rest, prompt: freshPrompt } : req)
    }
  }
}
