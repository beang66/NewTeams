import { promises as fs } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Obsidian Vault 연결. PC의 Vault 폴더를 직접 읽는다.
 * - 읽기는 허용 폴더(기본 `01 Projects`, `wiki`) 안의 Markdown만.
 * - 쓰기는 AI Inbox 폴더 한 곳에 새 파일로만(덮어쓰기 없음). 원본 노트는 고치지 않는다.
 * - 경로는 정규화와 실제 경로(심볼릭 링크 해석) 비교로 폴더 경계를 강제한다.
 */
export interface VaultOptions {
  root: string
  read: string[]
  inbox: string
  /** 허용 폴더 안에서도 건너뛸 이름(폴더·파일). 점으로 시작하는 이름은 항상 건너뛴다. */
  skip?: string[]
  maxNotes?: number
  cacheMs?: number
}

export interface NoteMeta { path: string; title: string; group: string; mtimeMs: number; size: number }
export interface VaultSummary {
  state: 'connected'
  name: string
  readFolders: string[]
  inbox: string
  total: number
  groups: { key: string; label: string; count: number }[]
  inboxCount: number
  scannedAt: string
  truncated: boolean
}
export interface GraphNode { id: string; title: string; group: string; degree: number }
export interface VaultGraph { nodes: GraphNode[]; links: { source: string; target: string }[]; truncated: boolean; scannedAt: string }
export interface SearchHit { path: string; title: string; group: string; snippet: string; mtimeMs: number }
export interface InboxInput { title: string; body: string; project?: string; runId?: string; sources?: string[] }

export class VaultError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) { super(message); this.name = 'VaultError' }
}

const GROUPS: { key: string; label: string; match: (p: string) => boolean }[] = [
  { key: 'sources', label: '출처', match: (p) => p.startsWith('wiki/sources/') },
  { key: 'concepts', label: '개념', match: (p) => p.startsWith('wiki/concepts/') },
  { key: 'entities', label: '엔티티', match: (p) => p.startsWith('wiki/entities/') },
  { key: 'questions', label: '질문', match: (p) => p.startsWith('wiki/questions/') },
  { key: 'wiki', label: '위키', match: (p) => p.startsWith('wiki/') },
  { key: 'projects', label: '프로젝트', match: (p) => p.startsWith('01 Projects/') },
]
const groupOf = (p: string) => GROUPS.find((g) => g.match(p))?.key ?? 'other'
const toPosix = (p: string) => p.split(sep).join('/')
const norm = (p: string) => toPosix(p).replace(/^\/+|\/+$/g, '')

export class Vault {
  readonly root: string
  private readonly read: string[]
  private readonly inbox: string
  private readonly skip: Set<string>
  private readonly maxNotes: number
  private readonly cacheMs: number
  private cache: { at: number; notes: NoteMeta[]; truncated: boolean } | null = null

  constructor(opts: VaultOptions) {
    if (!isAbsolute(opts.root)) throw new Error(`vault.path는 절대 경로여야 함: ${opts.root}`)
    this.root = resolve(opts.root)
    this.read = opts.read.map(norm).filter(Boolean)
    this.inbox = norm(opts.inbox)
    if (!this.read.length) throw new Error('vault.read에 허용 폴더가 하나 이상 필요함')
    this.skip = new Set(['AI Inbox', 'node_modules', ...(opts.skip ?? [])])
    this.maxNotes = opts.maxNotes ?? 5000
    this.cacheMs = opts.cacheMs ?? 30_000
  }

  /** Vault 폴더가 실제로 있는지 확인한다. */
  async check(): Promise<void> {
    const st = await fs.stat(this.root).catch(() => null)
    if (!st?.isDirectory()) throw new Error(`Vault 폴더를 찾을 수 없음: ${this.root}`)
  }

  async summary(): Promise<VaultSummary> {
    const { notes, truncated, at } = await this.scan()
    const counts = new Map<string, number>()
    for (const n of notes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1)
    const groups = [...GROUPS, { key: 'other', label: '기타' }]
      .map((g) => ({ key: g.key, label: g.label, count: counts.get(g.key) ?? 0 }))
      .filter((g) => g.count > 0)
    return {
      state: 'connected', name: basename(this.root), readFolders: this.read, inbox: this.inbox,
      total: notes.length, groups, inboxCount: await this.countInbox(), scannedAt: new Date(at).toISOString(), truncated,
    }
  }

  async search(query: string, limit = 20, group?: string): Promise<SearchHit[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const { notes } = await this.scan()
    const hits: (SearchHit & { score: number })[] = []
    for (const n of notes) {
      if (group && n.group !== group) continue
      const text = await fs.readFile(join(this.root, n.path), 'utf8').catch(() => '')
      const inTitle = n.title.toLowerCase().includes(q)
      const at = text.toLowerCase().indexOf(q)
      if (!inTitle && at < 0) continue
      hits.push({ path: n.path, title: n.title, group: n.group, mtimeMs: n.mtimeMs, snippet: snippet(text, at, q.length), score: (inTitle ? 2 : 0) + (at >= 0 ? 1 : 0) })
    }
    return hits.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs).slice(0, limit).map(({ score: _s, ...h }) => h)
  }

  /**
   * Obsidian 그래프 보기와 같은 데이터: 허용 폴더의 노트(점)와 노트 사이 링크(선).
   * `[[노트]]`, `[[폴더/노트|별칭]]`, `[[노트#제목]]`, `[텍스트](경로.md)`를 읽는다.
   * 허용 폴더 밖이나 없는 노트로 가는 링크는 그리지 않는다. 점의 위치는 Obsidian이 저장하지 않으므로 화면에서 계산한다.
   */
  async graph(maxNodes = 1500): Promise<VaultGraph> {
    const { notes, truncated, at } = await this.scan()
    const list = notes.slice(0, maxNodes)
    const byPath = new Map(list.map((n) => [n.path.toLowerCase(), n.path]))
    const byName = new Map<string, string>()
    for (const n of list) { const k = n.title.toLowerCase(); if (!byName.has(k)) byName.set(k, n.path) }
    const resolveLink = (from: string, raw: string): string | undefined => {
      let t = raw.trim().replace(/\\/g, '/')
      try { t = decodeURIComponent(t) } catch { /* 그대로 */ }
      t = t.replace(/^\.\//, '')
      if (!t || /^[a-z]+:/i.test(t)) return undefined
      const withExt = t.toLowerCase().endsWith('.md') ? t : `${t}.md`
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
      const rel = normalizeRel(dir ? `${dir}/${withExt}` : withExt)
      return byPath.get(withExt.toLowerCase()) ?? (rel ? byPath.get(rel.toLowerCase()) : undefined)
        ?? byName.get(basename(withExt, '.md').toLowerCase())
    }
    const seen = new Set<string>()
    const links: { source: string; target: string }[] = []
    const degree = new Map<string, number>()
    for (const n of list) {
      const text = await fs.readFile(join(this.root, n.path), 'utf8').catch(() => '')
      const targets: string[] = []
      // 폴더 이름에 [진행] 같은 대괄호가 있으므로 처음 나오는 ]]까지 읽고, 별칭(|)·절(#, ^)을 뗀다.
      for (const m of text.matchAll(/\[\[(.+?)\]\](?!\])/g)) targets.push(m[1]!.split('|')[0]!.split(/[#^]/)[0]!)
      for (const m of text.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/gi)) targets.push(m[1]!)
      for (const raw of targets) {
        const to = resolveLink(n.path, raw)
        if (!to || to === n.path) continue
        const key = n.path < to ? `${n.path}\0${to}` : `${to}\0${n.path}`
        if (seen.has(key)) continue
        seen.add(key)
        links.push({ source: n.path, target: to })
        degree.set(n.path, (degree.get(n.path) ?? 0) + 1)
        degree.set(to, (degree.get(to) ?? 0) + 1)
      }
    }
    return {
      nodes: list.map((n) => ({ id: n.path, title: n.title, group: n.group, degree: degree.get(n.path) ?? 0 })),
      links, truncated: truncated || notes.length > list.length, scannedAt: new Date(at).toISOString(),
    }
  }

  async note(path: string): Promise<{ path: string; title: string; content: string }> {
    const rel = await this.allowedRead(path)
    return { path: rel, title: titleOf(rel), content: await fs.readFile(join(this.root, rel), 'utf8') }
  }

  /** AI 결과를 Inbox에 새 Markdown으로 저장한다. 같은 이름이 있으면 409. */
  async writeInbox(input: InboxInput, now = new Date()): Promise<{ path: string }> {
    const title = input.title.trim()
    if (!title || !input.body.trim()) throw new VaultError(400, '제목과 본문이 필요함')
    const dir = await this.inside(this.inbox)
    await fs.mkdir(dir, { recursive: true })
    const realDir = await fs.realpath(dir)
    if (!within(await fs.realpath(this.root), realDir)) throw new VaultError(403, 'Inbox가 Vault 밖을 가리킴')
    const stamp = kst(now)
    const name = `${stamp.file}-${slug(title)}${input.runId ? `-${slug(input.runId)}` : ''}.md`
    const sources = (input.sources ?? []).map((s) => `  - ${JSON.stringify(`[[${norm(s).replace(/\.md$/, '')}]]`)}`).join('\n')
    const doc = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `created: ${stamp.iso}`,
      ...(input.project ? [`project: ${JSON.stringify(input.project)}`] : []),
      ...(input.runId ? [`run: ${JSON.stringify(input.runId)}`] : []),
      'source: newteam-orchestrator',
      ...(sources ? ['references:', sources] : []),
      '---',
      '',
      `# ${title}`,
      '',
      input.body.trim(),
      '',
    ].join('\n')
    try {
      await fs.writeFile(join(realDir, name), doc, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new VaultError(409, `이미 같은 이름의 파일이 있음: ${name}`)
      throw error
    }
    this.cache = null
    return { path: `${this.inbox}/${name}` }
  }

  private async scan(): Promise<{ notes: NoteMeta[]; truncated: boolean; at: number }> {
    if (this.cache && Date.now() - this.cache.at < this.cacheMs) return this.cache
    const notes: NoteMeta[] = []
    let truncated = false
    const realRoot = await fs.realpath(this.root)
    const walk = async (relDir: string): Promise<void> => {
      if (truncated) return
      const abs = join(this.root, relDir)
      const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (e.name.startsWith('.') || this.skip.has(e.name)) continue
        const rel = relDir ? `${relDir}/${e.name}` : e.name
        if (rel === this.inbox || rel.startsWith(`${this.inbox}/`)) continue
        // 심볼릭 링크는 따라가지 않는다(폴더 경계 밖으로 나갈 수 있음).
        if (e.isSymbolicLink()) continue
        if (e.isDirectory()) { await walk(rel); continue }
        if (!e.isFile() || extname(e.name).toLowerCase() !== '.md') continue
        if (notes.length >= this.maxNotes) { truncated = true; return }
        const st = await fs.stat(join(this.root, rel)).catch(() => null)
        if (!st) continue
        notes.push({ path: rel, title: titleOf(rel), group: groupOf(rel), mtimeMs: st.mtimeMs, size: st.size })
      }
    }
    for (const folder of this.read) {
      const abs = join(this.root, folder)
      const real = await fs.realpath(abs).catch(() => null)
      if (!real || !within(realRoot, real)) continue
      await walk(folder)
    }
    this.cache = { at: Date.now(), notes, truncated }
    return this.cache
  }

  private async countInbox(): Promise<number> {
    let count = 0
    const walk = async (abs: string): Promise<void> => {
      for (const e of await fs.readdir(abs, { withFileTypes: true }).catch(() => [])) {
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue
        if (e.isDirectory()) await walk(join(abs, e.name))
        else if (e.isFile() && extname(e.name).toLowerCase() === '.md') count++
      }
    }
    await walk(join(this.root, this.inbox))
    return count
  }

  private async allowedRead(input: string): Promise<string> {
    const rel = norm(input)
    if (!rel || rel.includes('\0') || extname(rel).toLowerCase() !== '.md') throw new VaultError(400, 'Markdown 경로만 읽을 수 있음')
    if (rel.split('/').some((s) => s === '..' || s.startsWith('.') || this.skip.has(s))) throw new VaultError(403, '허용되지 않은 경로')
    if (!this.read.some((f) => rel.startsWith(`${f}/`))) throw new VaultError(403, '검색 허용 폴더 밖의 노트')
    if (rel === this.inbox || rel.startsWith(`${this.inbox}/`)) throw new VaultError(403, 'AI Inbox는 검색 대상이 아님')
    const abs = await this.inside(rel)
    const real = await fs.realpath(abs).catch(() => null)
    if (!real) throw new VaultError(404, '노트 없음')
    // 실제 경로가 허용 폴더(의 실제 경로) 안이어야 한다. 링크로 다른 Vault 폴더를 읽는 것도 막는다.
    const folder = this.read.find((f) => rel.startsWith(`${f}/`))!
    const realFolder = await fs.realpath(join(this.root, folder)).catch(() => null)
    if (!realFolder || !within(realFolder, real) || !within(await fs.realpath(this.root), real)) throw new VaultError(403, '허용 폴더 밖을 가리키는 링크')
    return rel
  }

  private async inside(rel: string): Promise<string> {
    if (isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new VaultError(400, '상대 경로만 허용')
    const abs = resolve(this.root, rel)
    if (!within(this.root, abs)) throw new VaultError(403, 'Vault 밖 경로')
    return abs
  }
}

/** `a/b/../c.md` → `a/c.md`. Vault 밖으로 나가면 undefined. */
function normalizeRel(p: string): string | undefined {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { if (!out.length) return undefined; out.pop() } else out.push(seg)
  }
  return out.join('/')
}

function within(root: string, target: string): boolean {
  const r = relative(root, target)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}
function titleOf(rel: string): string { return basename(rel, extname(rel)) }
function snippet(text: string, at: number, len: number): string {
  const body = text.replace(/^---[\s\S]*?\n---\n/, '')
  if (at < 0) return body.replace(/\s+/g, ' ').trim().slice(0, 120)
  const shift = text.length - body.length
  const i = Math.max(0, at - shift)
  const start = Math.max(0, i - 50)
  return `${start > 0 ? '…' : ''}${body.slice(start, i + len + 70).replace(/\s+/g, ' ').trim()}…`
}
function slug(s: string): string {
  return s.normalize('NFC').replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note'
}
/** 파일 이름과 frontmatter는 한국 시간으로 쓴다. */
function kst(d: Date): { file: string; iso: string } {
  const k = new Date(d.getTime() + 9 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`
  const time = `${p(k.getUTCHours())}${p(k.getUTCMinutes())}${p(k.getUTCSeconds())}`
  return { file: `${date}-${time}`, iso: `${date}T${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}+09:00` }
}
