import { useRun } from './api/useRun'
import { ControlScreen } from './screens/ControlScreen'

// Placeholders until the intake/done screens land.
const IntakeScreen = () => <h1 className="sr-only">요구사항 정리</h1>
const DoneScreen = () => <h1 className="sr-only">완료</h1>

export function App() {
  const run = useRun()
  if (run.loading) return <h1 className="sr-only">에이전트 관제</h1>
  if (run.state.stage === 'INTAKE') return <IntakeScreen />
  if (run.state.stage === 'DONE') return <DoneScreen />
  return <ControlScreen run={run} />
}
