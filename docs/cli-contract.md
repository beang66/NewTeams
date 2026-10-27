# CLI contract (recorded 2026-10-26)

Recorded by `orchestrator/scripts/record-fixtures.ts` (`npm run record`) against: Claude Code 2.1.310, codex-cli 0.163.0 (logged in with ChatGPT), Node v24.22.1, Windows 10. Each CLI call was made once. Prompts are sent via stdin (Windows argv limit ~8191 chars). Fixtures live in `orchestrator/test/fixtures/`.

| # | Command | Result | Fixture |
|---|---------|--------|---------|
| 1 | `claude -p --output-format stream-json --verbose --model haiku` (stdin prompt) | OK, exit 0 | `claude/simple.jsonl` |
| 2 | same + `--resume <id> --fork-session`, same cwd | OK, exit 0, new session_id | `claude/resume-fork.jsonl` |
| 3 | same as 2 but run from a different cwd | OK, exit 0, resume works, new session_id | `claude/resume-fork-othercwd.txt` (exit code, stdout, stderr) |
| 4 | `codex exec --json --sandbox read-only --skip-git-repo-check -` | OK, exit 0 | `codex/simple.jsonl` |
| 5 | `codex exec --json --sandbox read-only --skip-git-repo-check --output-schema <file> -` | OK, exit 0, message matches schema | `codex/schema.jsonl` |
| 6 | `codex exec --json --sandbox read-only --skip-git-repo-check -i <png> -` | OK, exit 0, image seen | `codex/image.jsonl` (+ `.stderr.txt`) |
| 7 | OpenAI API `gpt-5-mini` | skipped: no key (`OPENAI_API_KEY` not set) | none |

`claude/rate-limit.txt`: not recorded initially. Task 14 (2026-10-27) encountered an already exhausted subscription: the anonymized minimal `claude/session-limit.jsonl` records the observed rejected rate-limit and error-result shapes. No limit was deliberately provoked.

## 1. Claude stream-json
- Stdout is JSONL. Event order seen: `system:hook_started` x N, `system:hook_response` x N, `system:init`, `system:commands_changed`, `assistant`, `rate_limit_event`, `system:post_turn_summary`, `system:commands_changed`, then the final `result`. The number of hook events depends on the user's installed plugins, so parsers must ignore unknown `type`/`subtype`.
- Every event carries `session_id`. The `system:init` event includes `apiKeySource`, `claude_code_version`, `cwd`.
- The `assistant` event: `message.content[]` with `{type:"text", text}`, `message.model` (`claude-haiku-5-5`), `message.usage`.
- Last line is `type:"result"`, `subtype:"success"`. Observed fields: `is_error` (false), `result` (final text), `session_id`, `stop_reason` ("end_turn"), `terminal_reason` ("completed"), `total_cost_usd`, `num_turns`, `duration_ms`, `duration_api_ms`, `permission_denials`, `modelUsage`, `api_error_status`, `usage`.
- `usage` fields confirmed: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, plus `cache_creation_input_tokens`, `cache_creation.{ephemeral_1h,ephemeral_5m}_input_tokens`, `service_tier`, `iterations[]`. Sample: input 2, output 4, cache_read 26449, cache_creation 34951.
- `rate_limit_event.rate_limit_info`: `status` ("allowed"), `resetsAt` (unix s), `rateLimitType` ("five_hour"), `unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt,status}`, `isUsingOverage`. Useful for detecting limits before a hard failure.
- stderr was empty, exit code 0.

## 2. Resume with fork (same cwd)
`--resume <id> --fork-session` works. The new run printed a different `session_id` than the parent (parent `8aff4c4d-...`, fork `291fc507-...`), and answered from the parent's context ("OK"). Every event, including `result`, carries the new id.

## 3. Resume from a different cwd
Session created in `<tmp>/a`, then `--resume <id> --fork-session` run with cwd `<tmp>/b` (a different directory, no shared parent project): exit 0, `is_error:false`, new session_id (`dd4fa1e6-...`), and the answer showed the parent context was restored. So resume across cwd works on this version.
Also tried the alternative (cwd = original dir + `--add-dir <other>`): exit 0, new session_id. It also works.
Design guidance for Task 6 ClaudeRunner: cross-cwd resume is not blocked on 2.1.310, so the worktree can be the cwd. Keep `--add-dir` as a fallback if a later version stops finding the session. Only one resume per parent was tested per cwd; behaviour for sessions created inside a git worktree was not tested.

## 4. Codex simple
Args: `exec --json --sandbox read-only --skip-git-repo-check -` with prompt on stdin. Events (JSONL):
- `{"type":"thread.started","thread_id":"<uuid>"}`
- `{"type":"turn.started"}`
- `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}`
- `{"type":"turn.completed","usage":{"input_tokens","cached_input_tokens","cache_write_input_tokens","output_tokens","reasoning_output_tokens"}}`
Final message = last `item.completed` whose `item.type == "agent_message"` (`item.text`). Usage is on `turn.completed.usage` (sample: input 20186, cached 12416, output 5). Option names are as in the brief; nothing differed. stdout contains only JSONL; stderr may print `Reading prompt from stdin...` and non-fatal ERROR log lines (see 6).

## 5. Codex output schema
`--output-schema <file>` works. The final `agent_message.text` is a JSON string that parses to the schema shape, e.g. `{"verdict":"pass","reason":"ok"}`. The test schema used `additionalProperties:false` with all properties in `required` (needed for strict structured output). Parse `item.text` with `JSON.parse`.

## 6. Codex image
`-i <png>` works. Sent a 16x16 solid red PNG; the reply was "Red". Event shape is identical to item 4. In this run stderr contained `Reading prompt from stdin...` and a non-fatal `ERROR codex_models_manager::manager: failed to refresh available models: request timed out`, with exit code 0. Do not treat stderr content as failure; use exit code and events.

## 7. OpenAI API
Skipped: no key (`OPENAI_API_KEY` is not set). The `gpt-5-mini` name is unverified.

## Auth
Both CLIs were already logged in (codex: "Logged in using ChatGPT"). No auth failures.

## 8. Claude session-limit failure (observed 2026-10-27)

Task 14 stopped at the first master call because five_hour utilization was already 1.0. The stream included `rate_limit_event` with `rate_limit_info.status="rejected"` and Unix-seconds `resetsAt=1793079000` (2026-10-27 14:30 Asia/Seoul). The seven_day window was allowed with a later reset and must not extend the pause. The error result had `is_error=true` despite `subtype="success"`, text “You've hit your session limit · resets 2:30pm (Asia/Seoul)”, and zero usage/cost. Prefer the rejected window's structured timestamp over localized text. The parser and nonzero-exit runner paths are covered with a minimal anonymized fixture; no additional live call was used for the fix.
