import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const EXCLUDED = new Set(['node_modules', '.git', '.worktrees', 'dist'])

export async function buildRepoMap(dir: string, maxDepth = 3, maxEntries = 300): Promise<string> {
  const lines: string[] = []
  let total = 0
  const walk = async (path: string, depth: number): Promise<void> => {
    const ents = (await readdir(path, { withFileTypes: true })).filter((e) => !EXCLUDED.has(e.name))
    ents.sort((a, b) => {
      const da = a.isDirectory() ? 0 : 1
      const db = b.isDirectory() ? 0 : 1
      return da - db || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    })
    for (const e of ents) {
      total++
      if (lines.length < maxEntries) lines.push(`${'  '.repeat(depth)}${e.name}${e.isDirectory() ? '/' : ''}`)
      if (e.isDirectory() && depth + 1 < maxDepth) await walk(join(path, e.name), depth + 1)
    }
  }
  await walk(dir, 0)
  if (total > lines.length) lines.push(`… (${total - lines.length}개 더 있음)`)
  return lines.join('\n')
}
