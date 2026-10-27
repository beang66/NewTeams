// Records real CLI output as test fixtures. Spends real subscription usage; run deliberately.
// Each CLI call is made once. Prompts go via stdin (Windows argv limit).
import spawn from "cross-spawn";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = join(root, "test", "fixtures");
mkdirSync(join(fx, "claude"), { recursive: true });
mkdirSync(join(fx, "codex"), { recursive: true });

const work = mkdtempSync(join(tmpdir(), "orch-record-"));
const dirA = join(work, "a");
const dirB = join(work, "b");
mkdirSync(dirA);
mkdirSync(dirB);

interface Res { code: number | null; stdout: string; stderr: string }

function run(cmd: string, args: string[], cwd: string, stdin: string): Promise<Res> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout!.on("data", (d) => (stdout += d));
    p.stderr!.on("data", (d) => (stderr += d));
    p.on("error", (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }));
    p.on("close", (code) => resolve({ code, stdout, stderr }));
    p.stdin!.end(stdin);
  });
}

function lastResult(out: string): any {
  const lines = out.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const o = JSON.parse(lines[i]); if (o.type === "result") return o; } catch { /* skip */ }
  }
  return undefined;
}

function save(rel: string, r: Res): void {
  writeFileSync(join(fx, rel), r.stdout);
  if (r.stderr.trim()) writeFileSync(join(fx, rel + ".stderr.txt"), r.stderr);
}

function pngRed(): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const w = 16, h = 16;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [255, 0, 0]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const summary: Record<string, unknown> = { workDir: work };
const claudeBase = ["-p", "--output-format", "stream-json", "--verbose", "--model", "haiku"];

// 1. claude simple
const r1 = await run("claude", claudeBase, dirA, "OK라고만 답해");
save("claude/simple.jsonl", r1);
const res1 = lastResult(r1.stdout);
summary["1_simple"] = { code: r1.code, stderr: r1.stderr.slice(0, 300), result: res1 && { subtype: res1.subtype, is_error: res1.is_error, session_id: res1.session_id, usage: res1.usage, keys: Object.keys(res1) } };
const sid: string | undefined = res1?.session_id;

if (sid) {
  // 2. resume + fork, same cwd
  const r2 = await run("claude", [...claudeBase, "--resume", sid, "--fork-session"], dirA, "방금 뭐라고 답했어? 한 단어로");
  save("claude/resume-fork.jsonl", r2);
  const res2 = lastResult(r2.stdout);
  summary["2_fork_same_cwd"] = { code: r2.code, stderr: r2.stderr.slice(0, 300), parent: sid, result: res2 && { is_error: res2.is_error, session_id: res2.session_id, newId: res2.session_id !== sid, result: res2.result } };

  // 3a. fork from a different cwd
  const r3 = await run("claude", [...claudeBase, "--resume", sid, "--fork-session"], dirB, "방금 뭐라고 답했어? 한 단어로");
  writeFileSync(join(fx, "claude/resume-fork-othercwd.txt"), `exit=${r3.code}\n--- stdout ---\n${r3.stdout}\n--- stderr ---\n${r3.stderr}`);
  const res3 = lastResult(r3.stdout);
  summary["3a_fork_other_cwd"] = { code: r3.code, stderr: r3.stderr.slice(0, 400), result: res3 && { is_error: res3.is_error, session_id: res3.session_id, result: res3.result } };

  // 3b. alternative: cwd = dirA (workspace root) + --add-dir dirB
  const r3b = await run("claude", [...claudeBase, "--resume", sid, "--fork-session", "--add-dir", dirB], dirA, "방금 뭐라고 답했어? 한 단어로");
  const res3b = lastResult(r3b.stdout);
  summary["3b_fork_add_dir"] = { code: r3b.code, stderr: r3b.stderr.slice(0, 300), result: res3b && { is_error: res3b.is_error, session_id: res3b.session_id } };
}

// 4. codex simple
const cx = ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check"];
const r4 = await run("codex", [...cx, "-"], dirA, "Reply with just OK");
save("codex/simple.jsonl", r4);
summary["4_codex_simple"] = { code: r4.code, stderr: r4.stderr.slice(0, 500), eventTypes: [...new Set(r4.stdout.split(/\r?\n/).filter(Boolean).map((l) => { try { const o = JSON.parse(l); return o.type + (o.item?.type ? ":" + o.item.type : ""); } catch { return "?"; } }))] };

// 5. codex output schema
const schemaPath = join(work, "verdict.schema.json");
writeFileSync(schemaPath, JSON.stringify({ type: "object", properties: { verdict: { type: "string", enum: ["pass", "fail"] }, reason: { type: "string" } }, required: ["verdict", "reason"], additionalProperties: false }));
const r5 = await run("codex", [...cx, "--output-schema", schemaPath, "-"], dirA, "Return verdict pass with reason 'ok'.");
save("codex/schema.jsonl", r5);
summary["5_codex_schema"] = { code: r5.code, stderr: r5.stderr.slice(0, 500), tail: r5.stdout.split(/\r?\n/).filter(Boolean).slice(-3) };

// 6. codex image
const pngPath = join(work, "red.png");
writeFileSync(pngPath, pngRed());
const r6 = await run("codex", [...cx, "-i", pngPath, "-"], dirA, "What single color is this image? One word.");
save("codex/image.jsonl", r6);
summary["6_codex_image"] = { code: r6.code, stderr: r6.stderr.slice(0, 500), tail: r6.stdout.split(/\r?\n/).filter(Boolean).slice(-3) };

// 7. OpenAI API (only with key; key never printed)
if (process.env.OPENAI_API_KEY) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  try {
    const resp = await client.chat.completions.create({ model: "gpt-5-mini", messages: [{ role: "user", content: "Reply with just OK" }] });
    summary["7_openai"] = { ok: true, model: resp.model, usage: resp.usage };
  } catch (e) {
    summary["7_openai"] = { ok: false, error: String((e as Error).message).slice(0, 300) };
  }
} else {
  summary["7_openai"] = "skipped: no key";
}

writeFileSync(join(work, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
