import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

/**
 * 전문가 그래프: Vault 폴더의 Markdown 노트를 노드로, frontmatter의 정해진 키를 엣지로 읽는다.
 * 노드 종류: 작업(entry) · 지식 · 과정 · 도구 · 기준. 에이전트는 자기 작업에서 시작해 정해진 엣지만 따라 읽는다(검색이 아니라 순회).
 *
 *   type: 작업
 *   applies_to: [dev]                 # 이 작업을 읽는 파이프라인 역할 키
 *   knowledge: ["[[...]]"]  process: "[[...]]"  tools: ["[[...]]"]  done: "[[...]]"
 *   requires: ["[[다른 작업]]"]        # 선행 작업: 그 작업의 완료 기준만 함께 읽는다
 */
export const EDGES = ['knowledge', 'process', 'tools', 'done'] as const
export interface GraphNode { title: string; path: string; type: string; meta: Record<string, unknown>; body: string }
export interface GraphDoc { path: string; text: string; via: string }

const NODE_MAX = 3000
const TOTAL_MAX = 12000

/** 폴더 아래 모든 .md(점·밑줄로 시작하는 폴더 제외)를 노드로 읽는다. 제목은 파일 이름. */
export function loadGraph(dir: string, vaultRoot = dir): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>()
  const walk = (d: string): void => {
    let names: string[]
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      if (n.startsWith('.') || n.startsWith('_')) continue
      const p = join(d, n)
      const st = statSync(p, { throwIfNoEntry: false })
      if (st?.isDirectory()) { walk(p); continue }
      if (!st?.isFile() || !n.toLowerCase().endsWith('.md')) continue
      const { meta, body } = splitFrontmatter(readFileSync(p, 'utf8'))
      const title = basename(n, '.md')
      nodes.set(title.toLowerCase(), { title, path: relative(vaultRoot, p).replaceAll('\\', '/'), type: String(meta.type ?? ''), meta, body })
    }
  }
  walk(dir)
  return nodes
}

/**
 * 역할 키로 시작 작업을 고르고 경로를 펼친다: 작업 → 지식·과정·도구·기준, 선행 작업 → 그 기준.
 * 같은 노드는 한 번만, 노드당 3천 자·전체 1만 2천 자까지. 반환 순서 = 프롬프트에 붙는 순서.
 */
export function traverse(nodes: Map<string, GraphNode>, roleKey: string): GraphDoc[] {
  const tasks = [...nodes.values()].filter((n) => n.type === '작업' && list(n.meta.applies_to).includes(roleKey))
  const out: GraphDoc[] = []
  const seen = new Set<string>()
  let total = 0
  const add = (n: GraphNode | undefined, via: string): void => {
    if (!n || seen.has(n.title) || total >= TOTAL_MAX) return
    seen.add(n.title)
    const text = n.body.trim().slice(0, Math.min(NODE_MAX, TOTAL_MAX - total))
    total += text.length
    out.push({ path: n.path, text, via })
  }
  const get = (link: string) => nodes.get(link.toLowerCase())
  for (const t of tasks) {
    add(t, '작업')
    for (const e of EDGES) for (const l of links(t.meta[e])) add(get(l), `${t.title} → ${e}`)
    for (const l of links(t.meta.requires)) {
      const pre = get(l)
      for (const d of links(pre?.meta.done)) add(get(d), `${t.title} → requires ${pre!.title} → done`)
    }
  }
  return out
}

/** `[[제목]]`, `[[폴더/제목|별칭]]` → 제목. 문자열 하나 또는 목록. */
function links(v: unknown): string[] {
  return list(v).flatMap((s) => [...s.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => basename(m[1]!.trim())))
}
function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []
}

/** 단순 YAML: `key: value`, `key: [a, b]`, `key:` 아래 `- item`. 값은 JSON이면 JSON으로. */
export function splitFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, unknown> = {}
  let listKey: string | undefined
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && listKey) { (meta[listKey] as string[]).push(unquote(item[1]!)); continue }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, key, raw] = kv as unknown as [string, string, string]
    listKey = undefined
    if (raw === '') { meta[key] = []; listKey = key; continue }
    try { meta[key] = JSON.parse(raw) } catch {
      meta[key] = raw.startsWith('[') && raw.endsWith(']') ? splitList(raw.slice(1, -1)).map(unquote) : unquote(raw)
    }
  }
  return { meta, body: text.slice(m[0].length) }
}
const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2')
/** `[[a]], [[b]]` 처럼 링크 안 쉼표가 없다는 가정의 단순 분리 */
const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
