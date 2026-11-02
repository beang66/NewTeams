import { useState } from 'react'
import type { RunState } from '@orch/store/state'
import { api } from '../api/client'

/** 시작이 필요한 상태: 스펙은 승인됐지만 사람이 아직 시작하지 않았거나 정지한 상태. */
export function pipelineIdle(state: RunState): 'not_started' | 'stopped' | undefined {
  if (state.stage === 'INTAKE' || state.stage === 'DONE' || state.pipeline === 'running') return undefined
  return state.pipeline === 'stopped' ? 'stopped' : 'not_started'
}

/** 시작은 실제 Claude·GPT 호출로 비용이 들므로 한 번 더 묻는다. */
export async function startWithConfirm(): Promise<boolean> {
  if (!window.confirm('파이프라인을 시작할까요? 에이전트가 실제 Claude·GPT를 호출해 비용이 듭니다.')) return false
  await api.startPipeline()
  return true
}

/**
 * 상단 바: 실행 상태와 [정지]만 둔다. 시작·다시 시작은 사람이 결정하는 흐름 안에 있다
 * (요구사항 화면의 스펙 승인 다음 단계, 관제 화면의 결정 큐 맨 위).
 */
export function PipelineControl({ state }: { state: RunState }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  // 스펙 승인 전에는 실행 상태가 남아 있어도(예전 기록) 돌 수 없으므로 정지를 보이지 않는다.
  const running = state.pipeline === 'running' && state.stage !== 'INTAKE' && state.stage !== 'DONE'
  const label = state.stage === 'DONE' ? '완료' : state.stage === 'INTAKE' ? '시작 전' : running ? '실행 중' : state.pipeline === 'stopped' ? '정지됨' : '시작 전'
  const stop = async () => {
    setBusy(true); setErr(undefined)
    try { await api.stopPipeline() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <span className="pipe-ctl">
      <span className={`pipe-state${running ? ' is-running' : ''}`}>{label}</span>
      {running && <button type="button" className="btn" disabled={busy} onClick={() => void stop()} title="지금 돌고 있는 작업은 마치고 멈춥니다">정지</button>}
      {err && <span className="acard-error" role="alert">{err}</span>}
    </span>
  )
}
