import { promises as fs } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { VaultError } from './vault.js'

/**
 * 대시보드 라이브러리(브랜드·콘텐츠·아이디어)의 Vault 저장소.
 * - 쓰기는 `Libraries/brand|content|ideas` 세 폴더 안의 `.md` 파일만. 하위 폴더·숨김 파일·심볼릭 링크는 다루지 않는다.
 * - 수정은 화면이 읽은 수정 시각(mtimeMs)과 디스크가 다르면 409(Obsidian·Git 동기화가 그사이 바꿈).
 * - 저장은 임시 파일에 쓴 뒤 이름 바꾸기, 삭제는 `Libraries/.trash/`로 옮기기.
 */
export const LIBRARY_KINDS = ['brand', 'content', 'ideas'] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]
export const LIBRARY_DIR = 'Libraries'

export interface LibraryInput { title: string; status: string; kind: string; tags: string[]; body: string }
export interface LibraryItem extends LibraryInput { file: string; updated: string; mtimeMs: number }

const FILE = /^[^\\/\0:*?"<>|]+\.md$/

export class Library {
  constructor(private readonly root: string) {}

  async list(kind: LibraryKind): Promise<LibraryItem[]> {
    const dir = await this.dir(kind)
    const items: LibraryItem[] = []
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.') || !FILE.test(e.name)) continue
      items.push(await this.read(dir, e.name))
    }
    return items.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  async get(kind: LibraryKind, file: string): Promise<LibraryItem> {
    return this.read(await this.dir(kind), this.name(file))
  }

  async create(kind: LibraryKind, input: LibraryInput, now = new Date()): Promise<LibraryItem> {
    const dir = await this.dir(kind)
    const file = `${slug(input.title)}.md`
    try {
      await fs.writeFile(join(dir, file), serialize(input, now), { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new VaultError(409, `같은 이름의 항목이 있음: ${file}`)
      throw error
    }
    return this.read(dir, file)
  }

  async update(kind: LibraryKind, file: string, input: LibraryInput & { mtimeMs: number }, now = new Date()): Promise<LibraryItem> {
    const dir = await this.dir(kind)
    const name = this.name(file)
    const st = await this.stat(dir, name)
    // mtime은 소수점까지 오므로 1ms 안쪽 차이는 같은 것으로 본다.
    if (Math.abs(st.mtimeMs - input.mtimeMs) > 1) throw new VaultError(409, '다른 곳에서 바뀐 노트입니다. 다시 불러온 뒤 고치세요.')
    const tmp = join(dir, `.${name}.${process.pid}.tmp`)
    await fs.writeFile(tmp, serialize(input, now))
    await fs.rename(tmp, join(dir, name))
    return this.read(dir, name)
  }

  async remove(kind: LibraryKind, file: string, now = new Date()): Promise<void> {
    const dir = await this.dir(kind)
    const name = this.name(file)
    await this.stat(dir, name)
    const trash = join(this.root, LIBRARY_DIR, '.trash')
    await fs.mkdir(trash, { recursive: true })
    await fs.rename(join(dir, name), join(trash, `${kind}-${now.getTime()}-${name}`))
  }

  /** 종류 폴더를 만들고, 실제 경로가 Vault 안인지 확인한다(폴더가 링크로 밖을 가리키는 경우 차단). */
  private async dir(kind: LibraryKind): Promise<string> {
    if (!LIBRARY_KINDS.includes(kind)) throw new VaultError(400, '알 수 없는 라이브러리')
    const dir = join(this.root, LIBRARY_DIR, kind)
    await fs.mkdir(dir, { recursive: true })
    const [realRoot, realDir] = await Promise.all([fs.realpath(this.root), fs.realpath(dir)])
    const rel = relative(realRoot, realDir)
    if (rel !== join(LIBRARY_DIR, kind)) throw new VaultError(403, '라이브러리 폴더가 Vault 밖을 가리킴')
    return realDir
  }

  private name(file: string): string {
    if (!FILE.test(file) || file.startsWith('.') || isAbsolute(file)) throw new VaultError(400, '라이브러리 폴더의 .md 파일 이름만 허용')
    return file
  }

  private async stat(dir: string, name: string) {
    const st = await fs.lstat(join(dir, name)).catch(() => null)
    if (!st) throw new VaultError(404, '항목 없음')
    if (!st.isFile()) throw new VaultError(403, '일반 파일만 다룸')
    return st
  }

  private async read(dir: string, name: string): Promise<LibraryItem> {
    const st = await this.stat(dir, name)
    const { meta, body } = parse(await fs.readFile(join(dir, name), 'utf8'))
    const str = (k: string) => (typeof meta[k] === 'string' ? meta[k] as string : '')
    return {
      file: name, title: str('title') || name.slice(0, -3), status: str('status'), kind: str('kind'),
      tags: Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [],
      updated: str('updated') || st.mtime.toISOString(), body, mtimeMs: st.mtimeMs,
    }
  }
}

/** 값은 JSON으로 쓴다(YAML로도 유효). 줄바꿈·콜론이 든 값이 다른 키를 만들지 못한다. */
function serialize(input: LibraryInput, now: Date): string {
  const tags = input.tags.map((t) => t.trim()).filter(Boolean)
  return [
    '---',
    `title: ${JSON.stringify(input.title.trim())}`,
    `status: ${JSON.stringify(input.status)}`,
    `kind: ${JSON.stringify(input.kind)}`,
    `tags: ${JSON.stringify(tags)}`,
    `updated: ${JSON.stringify(now.toISOString())}`,
    '---',
    '',
    input.body.replace(/\r\n/g, '\n').trimEnd(),
    '',
  ].join('\n')
}

/** 이 저장소가 쓴 형식과, Obsidian에서 손으로 고친 단순 `key: value`·`[a, b]`를 읽는다. */
export function parse(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { meta: {}, body: text.trim() }
  const meta: Record<string, unknown> = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const raw = kv[2]!.trim()
    try { meta[kv[1]!] = JSON.parse(raw) } catch {
      meta[kv[1]!] = raw.startsWith('[') && raw.endsWith(']')
        ? raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        : raw.replace(/^['"]|['"]$/g, '')
    }
  }
  return { meta, body: text.slice(m[0].length).replace(/^\n+/, '').trimEnd() }
}

function slug(s: string): string {
  return s.normalize('NFC').replace(/[\\/:*?"<>|#^[\]\0]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|-$/g, '').slice(0, 80) || 'item'
}
