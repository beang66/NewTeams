import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const chunks = []
for await (const c of process.stdin) chunks.push(c)
const input = Buffer.concat(chunks).toString('utf8')
const mode = process.env.FAKE_MODE ?? ''
const argsFile = process.env.FAKE_ARGS_FILE
if (argsFile) writeFileSync(argsFile, JSON.stringify(process.argv.slice(2)))
const sha = createHash('sha256').update(input).digest('hex')
const text = `${Buffer.byteLength(input)}:${sha}`
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')

if (mode === 'sleep') {
  setInterval(() => {}, 1000)
  await new Promise(() => {})
}
if (mode === 'limit') {
  process.stderr.write('Claude usage limit reached. Your limit will reset at 2026-10-27T05:00:00Z\n')
  process.exit(1)
}
if (mode === 'session-limit') {
  process.stdout.write(readFileSync(new URL('../claude/session-limit.jsonl', import.meta.url), 'utf8'))
  process.exit(1)
}
if (mode === 'noresult') {
  process.stdout.write('just some text\n')
  process.exit(0)
}
if (process.argv[2] === 'exec') {
  process.stderr.write('Reading prompt from stdin...\nERROR codex_models_manager: refresh failed\n')
  if (mode === 'codexfail') {
    out({ type: 'thread.started', thread_id: 't-1' })
    out({ type: 'turn.failed', error: { message: 'You have hit your usage limit. try again later' } })
    process.exit(1)
  }
  out({ type: 'thread.started', thread_id: 't-1' })
  out({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text } })
  out({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 3 } })
  process.exit(0)
}
if (mode === 'noise') process.stdout.write('warning: not json\n')
out({ type: 'system', subtype: 'init', session_id: 's-1' })
out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: 's-1', usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 1 } })
