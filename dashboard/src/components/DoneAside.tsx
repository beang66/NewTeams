import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { RunView } from '../api/useRun'
import { doneStats, formatDuration } from '../model/doneStats'
import { usageView } from '../model/usage'

const DOCS = ['spec.md', 'plan.md', 'timeline.md', 'decisions.md']

/** Links only to files that exist (a 404 probe resolves to null); others show a muted 없음. */
function DocLink({ path }: { path: string }) {
  const [found, setFound] = useState<boolean | undefined>()
  useEffect(() => {
    let live = true
    api.human(path).then((t) => t !== null, () => false).then((ok) => { if (live) setFound(ok) })
    return () => { live = false }
  }, [path])
  if (found === undefined) return <span className="muted">{path}</span>
  return found
    ? <a href={`/api/human/${path}`} target="_blank" rel="noreferrer">{path}</a>
    : <span className="muted">{`${path} 없음`}</span>
}
const num = (n: number) => n.toLocaleString('ko-KR')

/** "숫자로 보기" column: everything is computed from the run, nothing is typed in. */
export function DoneAside({ run }: { run: RunView }) {
  const s = doneStats(run.events, run.state)
  const u = usageView(run.events, run.state, run.agents, new Date())
  const rows: [string, string][] = [
    ['태스크', num(s.tasks)], ['반려', num(s.rejects)], ['하네스 반려', num(s.harnessRejects)], ['리뷰어 반려', num(s.reviewerRejects)], ['승인', num(s.approves)], ['사람 호출', num(s.humanCalls)],
  ]
  if (s.durationMs !== undefined) rows.push(['소요', formatDuration(s.durationMs)])
  return (
    <aside className="done-aside" aria-label="숫자로 보기">
      <h3>숫자로 보기</h3>
      <table><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="r">{v}</td></tr>)}</tbody></table>
      <h3>토큰</h3>
      <table>
        <thead><tr><th>공급자</th><th className="r">토큰</th><th className="r">캐시 토큰</th></tr></thead>
        <tbody>
          <tr><td>Claude</td><td className="r">{num(u.byProvider.claude.tokens)}</td><td className="r">{num(u.byProvider.claude.cached)}</td></tr>
          <tr><td>GPT</td><td className="r">{num(u.byProvider.codex.tokens)}</td><td className="r">{num(u.byProvider.codex.cached)}</td></tr>
          <tr><td>API 지출</td><td className="r" colSpan={2}>{`$${u.apiSpendUsd.toFixed(2)} / $${u.apiCapUsd}`}</td></tr>
        </tbody>
      </table>
      <h3>남은 개선</h3>
      <p className="done-note"><DocLink path="wiki/backlog.md" /></p>
      <h3>문서</h3>
      <p className="done-note">{DOCS.map((d, i) => <span key={d}>{i > 0 && ' · '}<DocLink path={d} /></span>)}</p>
    </aside>
  )
}
