import type { KeyboardEvent } from 'react'
import type { Arrow } from '../model/lanes'
import { typeLabel } from '../model/labels'

/** Vertical arrow from the sender lane to the receiver lane at the event time. */
export function LaneArrow({ arrow, x, y1, y2, fromTitle, toTitle, showLabel, selected, highlighted, onSelect }: {
  arrow: Arrow; x: number; y1: number; y2: number; fromTitle: string; toTitle: string
  showLabel: boolean; selected: boolean; highlighted: boolean; onSelect: (id: string) => void
}) {
  const label = typeLabel[arrow.type]
  const same = Math.abs(y2 - y1) < 1
  const base = y2 >= y1 ? y2 - 6 : y2 + 6
  const cls = ['arrow', `tone-${arrow.tone}`, selected && 'is-selected', highlighted && 'is-highlight'].filter(Boolean).join(' ')
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(arrow.id) }
  }
  return (
    <g role="button" tabIndex={0} aria-label={`${fromTitle} → ${toTitle}: ${label} ${arrow.id}`} aria-pressed={selected}
      className={cls} onClick={() => onSelect(arrow.id)} onKeyDown={onKeyDown}>
      <line className="arrow-hit" x1={x} y1={y1} x2={x} y2={y2} />
      {same
        ? <circle className="arrow-tip" cx={x} cy={y1} r={3} />
        : <>
            <line className="arrow-line" x1={x} y1={y1} x2={x} y2={base} />
            <path className="arrow-tip" d={`M${x - 4},${base} L${x + 4},${base} L${x},${y2} Z`} />
          </>}
      {showLabel && <text className="arrow-label" x={x + 4} y={(y1 + y2) / 2}>{label}</text>}
    </g>
  )
}
