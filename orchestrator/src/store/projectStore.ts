import { promises as fs, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { EnvelopeSchema, type Envelope } from '../protocol/messages.js'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd })
  return stdout
}

async function initRepo(dir: string): Promise<boolean> {
  if (existsSync(join(dir, '.git'))) return false
  await git(dir, ['init'])
  await git(dir, ['config', 'user.name', 'orchestrator'])
  await git(dir, ['config', 'user.email', 'orchestrator@localhost'])
  return true
}

export class ProjectStore {
  readonly paths: {
    workspace: string; human: string; raw: string; events: string; prompts: string
    sessions: string; evidence: string; iterations: string; wiki: string; state: string; plan: string
  }

  constructor(private readonly root: string) {
    const human = join(root, 'human')
    const raw = join(root, 'raw')
    this.paths = {
      workspace: join(root, 'workspace'),
      human,
      raw,
      events: join(raw, 'events.jsonl'),
      prompts: join(raw, 'prompts'),
      sessions: join(raw, 'sessions'),
      evidence: join(human, 'evidence'),
      iterations: join(human, 'iterations'),
      wiki: join(human, 'wiki'),
      state: join(root, 'state.json'),
      plan: join(root, 'plan.json'),
    }
  }

  async init(): Promise<void> {
    const p = this.paths
    for (const d of [p.workspace, p.iterations, p.evidence, p.wiki, p.prompts, p.sessions]) {
      await fs.mkdir(d, { recursive: true })
    }
    if (await initRepo(p.workspace)) {
      await git(p.workspace, ['commit', '--allow-empty', '-m', 'init workspace'])
    }
    const gi = join(this.root, '.gitignore')
    if (!existsSync(gi)) await fs.writeFile(gi, 'raw/\nworkspace/\n')
    await initRepo(this.root)
  }

  async commitHuman(message: string): Promise<void> {
    const targets = ['human']
    if (existsSync(this.paths.plan)) targets.push('plan.json')
    await git(this.root, ['add', '--', ...targets])
    const staged = await git(this.root, ['diff', '--cached', '--name-only', '--', ...targets])
    if (!staged.trim()) return
    await git(this.root, ['commit', '--only', '-m', message, '--', ...targets])
  }

  async appendEvent(e: Envelope): Promise<void> {
    await fs.mkdir(dirname(this.paths.events), { recursive: true })
    let prefix = ''
    try {
      const fh = await fs.open(this.paths.events, 'r')
      try {
        const { size } = await fh.stat()
        if (size > 0) {
          const buf = Buffer.alloc(1)
          await fh.read(buf, 0, 1, size - 1)
          if (buf[0] !== 0x0a) prefix = '\n'
        }
      } finally {
        await fh.close()
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    await fs.appendFile(this.paths.events, prefix + JSON.stringify(e) + '\n')
  }

  async readEvents(): Promise<Envelope[]> {
    let text: string
    try {
      text = await fs.readFile(this.paths.events, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const out: Envelope[] = []
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return
      try {
        out.push(EnvelopeSchema.parse(JSON.parse(line)))
      } catch {
        console.warn(`events.jsonl line ${i + 1}: unparseable, skipped`)
      }
    })
    return out
  }

  async writePrompt(id: string, text: string): Promise<string> {
    await fs.mkdir(this.paths.prompts, { recursive: true })
    await fs.writeFile(join(this.paths.prompts, `${id}.txt`), text)
    return `raw/prompts/${id}.txt`
  }

  sessionLogPath(agent: string, task?: string): string {
    return join(this.paths.sessions, `${agent}-${task ?? 'main'}.jsonl`)
  }

  async writeHuman(rel: string, content: string): Promise<void> {
    const full = join(this.paths.human, rel)
    await fs.mkdir(dirname(full), { recursive: true })
    await fs.writeFile(full, content)
  }
}
