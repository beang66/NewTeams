import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import OpenAI from 'openai'
import type { Config } from '../config.js'
import { RunnerError, type Runner, type RunRequest, type RunResult } from './types.js'

export interface SpendTracker { get(): number; add(usd: number): Promise<void> }

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

export class OpenAIRunner implements Runner {
  private client: OpenAI | undefined
  constructor(private cfg: Config, private spend: SpendTracker, client?: OpenAI) { this.client = client }

  async run(req: RunRequest): Promise<RunResult> {
    if (this.spend.get() >= this.cfg.openaiCapUsd) throw new RunnerError('rate_limit', 'openai cap')
    if (!process.env.OPENAI_API_KEY) throw new RunnerError('auth', 'OPENAI_API_KEY not set')
    const client = (this.client ??= new OpenAI())

    const content: any[] = [{ type: 'input_text', text: req.prompt }]
    for (const img of req.images ?? []) {
      const mime = MIME[extname(img).toLowerCase()] ?? 'image/png'
      content.push({ type: 'input_image', image_url: `data:${mime};base64,${readFileSync(img).toString('base64')}` })
    }
    const body: Record<string, unknown> = {
      model: this.cfg.openaiModel,
      input: [{ role: 'user', content }],
    }
    if (req.outputSchema) {
      body.text = { format: { type: 'json_schema', name: 'output', schema: req.outputSchema, strict: true } }
    }

    let resp: any
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), req.timeoutMs)
    try {
      resp = await client.responses.create(body as any, { signal: ac.signal })
    } catch (e) {
      throw this.mapError(e, ac.signal.aborted, req.timeoutMs)
    } finally {
      clearTimeout(timer)
    }

    mkdirSync(dirname(req.rawLogPath), { recursive: true })
    appendFileSync(req.rawLogPath, JSON.stringify(resp) + '\n', 'utf8')

    const inTok = Number(resp?.usage?.input_tokens ?? 0)
    const outTok = Number(resp?.usage?.output_tokens ?? 0)
    const cached = Number(resp?.usage?.input_tokens_details?.cached_tokens ?? 0)
    const p = this.cfg.openaiPricePerMTok
    const costUsd = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out
    await this.spend.add(costUsd)

    const text = typeof resp?.output_text === 'string' ? resp.output_text : ''
    if (!text) throw new RunnerError('format', 'openai response has no output_text')
    return { text, usage: { in: inTok, out: outTok, cached, costUsd } }
  }

  private mapError(e: unknown, aborted: boolean, timeoutMs: number): RunnerError {
    if (e instanceof RunnerError) return e
    if (aborted) return new RunnerError('timeout', `openai timed out after ${timeoutMs}ms`)
    const status = (e as { status?: number }).status
    const msg = (e as Error)?.message ?? String(e)
    if (status === 404 || /model.*not found|does not exist/i.test(msg)) {
      return new RunnerError('crash', `openai model not found: ${this.cfg.openaiModel}`)
    }
    if (status === 429) return new RunnerError('rate_limit', msg)
    if (status === 401) return new RunnerError('auth', msg)
    return new RunnerError('crash', msg)
  }
}
