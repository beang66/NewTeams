import { useEffect, useState } from 'react'
import { useRun, type RunView } from './api/useRun'
import { hasDraft, useSpecDraft } from './api/useSpecDraft'
import { Skeleton } from './components/Skeleton'
import { TopBar } from './components/TopBar'
import { ControlScreen } from './screens/ControlScreen'
import { DoneScreen } from './screens/DoneScreen'
import { HomeScreen } from './screens/HomeScreen'
import { IntakeScreen } from './screens/IntakeScreen'

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

function LiveApp() {
  return <Shell run={useRun()} />
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
  return useHashPath().startsWith('/run') ? <LiveApp /> : <HomeScreen />
}

/** `runOverride` lets tests supply a fixed run instead of the live server connection. */
export function App({ runOverride }: { runOverride?: RunView }) {
  return runOverride ? <Shell run={runOverride} /> : <Routed />
}
