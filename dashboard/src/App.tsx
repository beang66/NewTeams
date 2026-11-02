import { useEffect, useState } from 'react'
import { useRun, type RunView } from './api/useRun'
import { api, setProject } from './api/client'
import { hasDraft, useSpecDraft } from './api/useSpecDraft'
import { Skeleton } from './components/Skeleton'
import { TopBar } from './components/TopBar'
import { ControlScreen } from './screens/ControlScreen'
import { DoneScreen } from './screens/DoneScreen'
import { HomeScreen } from './screens/HomeScreen'
import { IntakeScreen } from './screens/IntakeScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'

function Shell({ run }: { run: RunView }) {
  const { draft, setDraft } = useSpecDraft(!run.loading && run.state.stage === 'INTAKE')
  if (run.loading) {
    return (
      <div className="control">
        <TopBar run={run} />
        <main className="skeleton-page">{[4, 6, 4].map((n, i) => <Skeleton key={i} lines={n} />)}</main>
      </div>
    )
  }
  const { stage } = run.state
  if (stage === 'INTAKE') return <IntakeScreen run={run} draft={draft} onDraft={setDraft} />
  if (stage === 'DONE') return <DoneScreen run={run} />
  return <ControlScreen run={run} hasSpecDraft={hasDraft(draft)} />
}

/** `#/run`은 실행 관제, 그 밖의 주소는 통합 홈이다. */
function useHashPath(): string {
  const read = () => window.location.hash.replace(/^#/, '') || '/'
  const [path, setPath] = useState(read)
  useEffect(() => {
    const on = () => setPath(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return path
}

function Routed() {
  const path = useHashPath()
  // #/run/<이름>: 그 프로젝트만의 관제 페이지. 이름이 없으면(#/run) 서버를 켤 때 지정한 주 프로젝트.
  const m = /^\/run\/([^/?]+)/.exec(path)
  if (m) {
    let name = m[1]!
    try { name = decodeURIComponent(name) } catch { /* 그대로 */ }
    return <ProjectShell key={name} name={name} />
  }
  return <Primary path={path} />
}

function ProjectShell({ name }: { name: string }) {
  setProject(name) // 아래 useRun과 화면의 모든 관제 API가 /p/<이름>/api/... 로 간다
  // 정리 함수로 지우지 않는다: 개발 모드의 이중 실행이 지워 버리면 관제 API가 주 프로젝트로 샌다. 홈 등 다른 화면이 그릴 때 직접 비운다.
  const run = useRun()
  return <Shell run={run} />
}

function Primary({ path }: { path: string }) {
  setProject(undefined)
  const run = useRun()
  // #/run(내 차례·알림 링크)은 주 프로젝트의 #/run/<이름>으로 보낸다. 같은 프로젝트는 주소도 하나.
  useEffect(() => {
    if (!/^\/run\/?(\?.*)?$/.test(path)) return
    api.project().then((p) => { window.location.replace(`#/run/${encodeURIComponent(p.name)}${path.slice(path.indexOf('?') >= 0 ? path.indexOf('?') : path.length)}`) }).catch(() => undefined)
  }, [path])
  if (path.startsWith('/run')) return <Shell run={run} />
  if (/^\/(brand|content|ideas|calendar|settings|outputs)/.test(path)) return <WorkspaceScreen path={path} run={run} />
  return <HomeScreen run={run} />
}

/** `runOverride` lets tests supply a fixed run instead of the live server connection. */
export function App({ runOverride }: { runOverride?: RunView }) {
  return runOverride ? <Shell run={runOverride} /> : <Routed />
}
