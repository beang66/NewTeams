import type { Lane } from '../model/lanes'

export const HEAD_W = 200

const STATUS: Record<Lane['status'], { label: string; tone: string }> = {
  running: { label: '실행 중', tone: 'accent' },
  waiting: { label: '대기', tone: 'neutral' },
  blocked: { label: '막힘', tone: 'bad' },
  paused: { label: '일시정지', tone: 'warn' },
  done: { label: '완료', tone: 'ok' },
}

export const fmtTokens = (n: number): string => (n < 1000 ? String(n) : `${Math.round(n / 1000)}k`)
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}초`
  if (s < 3600) return `${Math.floor(s / 60)}분`
  return `${Math.floor(s / 3600)}시간`
}

/** One lane head row (left 200px): badge, title, status chip, then task · rN · elapsed · tokens. */
export function LaneHead({ lane, y, height, collapsed, task, elapsedMs }: {
  lane: Lane; y: number; height: number; collapsed: boolean; task?: string; elapsedMs?: number
}) {
  const st = STATUS[lane.status]
  const titleX = lane.badge ? 32 : 8
  const meta = [task, lane.round !== undefined ? `r${lane.round}` : undefined, elapsedMs !== undefined ? fmtElapsed(elapsedMs) : undefined, lane.tokens ? fmtTokens(lane.tokens) : undefined]
    .filter(Boolean).join(' · ')
  const baseline = collapsed ? height / 2 + 4 : 22
  return (
    <g className="lane-head" data-lane={lane.key} data-collapsed={collapsed ? '' : undefined} transform={`translate(0,${y})`}>
      <rect className="lane-head-bg" x={0} y={0} width={HEAD_W} height={height} />
      {lane.badge && (
        <g className="lane-badge" aria-label={lane.badge === 'C' ? 'Claude' : 'GPT'}>
          <rect x={8} y={baseline - 12} width={18} height={16} rx={4} />
          <text x={17} y={baseline} textAnchor="middle">{lane.badge}</text>
        </g>
      )}
      <text className="lane-title" x={titleX} y={baseline}>
        <title>{lane.task ? `${lane.title} · ${lane.task}` : lane.title}</title>
        {lane.title}
      </text>
      <text className={`lane-status is-${st.tone}`} x={HEAD_W - 8} y={baseline} textAnchor="end">
        {collapsed ? '완료 · 접힘' : st.label}
      </text>
      {!collapsed && meta && <text className="lane-meta" x={titleX} y={42}>{meta}</text>}
    </g>
  )
}
