import type { Stage } from '@orch/store/state'
import { STAGE_ORDER, stageLabel } from '../model/labels'

export function StageRail({ stage }: { stage: Stage }) {
  const current = STAGE_ORDER.indexOf(stage)
  return (
    <ol className="stage-rail" aria-label="진행 단계">
      {STAGE_ORDER.map((s, i) => (
        <li key={s} className={i < current ? 'is-done' : i === current ? 'is-current' : ''} aria-current={i === current ? 'step' : undefined}>
          {stageLabel[s]}
        </li>
      ))}
    </ol>
  )
}
