import { RunnerError, type Runner, type RunRequest, type RunResult } from './types.js'

export type FakeItem = RunResult | RunnerError | ((req: RunRequest) => RunResult | RunnerError)

export class FakeRunner implements Runner {
  calls: RunRequest[] = []
  private i = 0
  constructor(private script: FakeItem[]) {}

  async run(req: RunRequest): Promise<RunResult> {
    const idx = this.i++
    this.calls.push(structuredClone(req))
    if (idx >= this.script.length) throw new Error(`FakeRunner script exhausted at call ${idx} (script length ${this.script.length})`)
    const item = this.script[idx]!
    const out = typeof item === 'function' ? item(req) : item
    if (out instanceof RunnerError) throw out
    return out
  }
}
