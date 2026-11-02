/**
 * 실제 Claude CLI·Codex CLI 연결 확인(짧은 질문 한 번씩, 비용 아주 적음). OpenAI API는 키가 있을 때만.
 * 실행: npx tsx scripts/smoke-runners.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../src/config.js'
import { ClaudeRunner } from '../src/runners/claudeRunner.js'
import { CodexRunner } from '../src/runners/codexRunner.js'
import { OpenAIRunner } from '../src/runners/openaiRunner.js'
import type { Runner } from '../src/runners/types.js'

const cwd = mkdtempSync(join(tmpdir(), 'orch-smoke-'))
const prompt = '연결 확인입니다. 다른 말 없이 OK 한 단어만 답하세요.'
const runners: [string, Runner, string][] = [
  ['Claude CLI', new ClaudeRunner(DEFAULT_CONFIG), 'haiku'],
  ['Codex CLI', new CodexRunner(DEFAULT_CONFIG), 'codex-default'],
]
if (process.env.OPENAI_API_KEY) runners.push(['OpenAI API', new OpenAIRunner(DEFAULT_CONFIG, { get: () => 0, add: async () => undefined }), DEFAULT_CONFIG.openaiModel])
else console.log('OpenAI API  건너뜀: OPENAI_API_KEY 없음')

for (const [name, runner, model] of runners) {
  const t = Date.now()
  try {
    const r = await runner.run({ role: 'reviewer', prompt, model, cwd, timeoutMs: 120_000, rawLogPath: join(cwd, `${name}.log`) })
    console.log(`${name}  성공 ${((Date.now() - t) / 1000).toFixed(1)}s  응답="${r.text.trim().slice(0, 40)}"  토큰 in=${r.usage.in} out=${r.usage.out}`)
  } catch (e) {
    console.log(`${name}  실패: ${e instanceof Error ? e.message : String(e)}`)
  }
}
