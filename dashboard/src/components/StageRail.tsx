import type { Stage } from '@orch/store/state'
import { STAGE_ORDER, stageLabel } from '../model/labels'

/** waitingFor: 사람이 처리해야 하는 단계. 진행 단계와 구분해 테두리로 표시한다. */
export function StageRail({ stage, waitingFor }: { stage: Stage; waitingFor?: Stage }) {
  const current = STAGE_ORDER.indexOf(stage)
  return (
    <ol className="stage-rail" aria-label="진행 단계">
      {STAGE_ORDER.map((s, i) => (
        <li key={s} className={i < current ? 'is-done' : i === current ? 'is-current' : s === waitingFor ? 'is-waiting' : ''} aria-current={i === current ? 'step' : undefined}>
          {stageLabel[s]}{s === waitingFor && <span className="stage-wait"> · 내 차례</span>}
        </li>
      ))}
    </ol>
  )
}
