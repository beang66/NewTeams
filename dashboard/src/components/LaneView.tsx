import { useEffect, useId, useMemo, useRef, useState, type WheelEvent } from 'react'
import type { Envelope } from '@orch/protocol/messages'
import type { RunState } from '@orch/store/state'
import type { AgentConfig } from '../api/client'
import { buildLanes, windowArrows, type Arrow } from '../model/lanes'
import { LaneArrow } from './LaneArrow'
import { HEAD_W, LaneHead } from './LaneHead'
import { clockHM, clockHMS } from '../model/time'

const ROW = 56, ROW_COLLAPSED = 24, TOP = 18, AXIS = 22, RIGHT_PAD = 16, LABEL_GAP = 48
type Zoom = number | 'all'
const ZOOMS: { label: string; value: Zoom }[] = [
  { label: '5분', value: 300_000 }, { label: '1시간', value: 3_600_000 }, { label: '전체', value: 'all' },
]
const clock = (ms: number, sec: boolean): string => (sec ? clockHMS(ms) : clockHM(ms))

export interface LaneViewProps {
  events: Envelope[]; state: RunState; agents: AgentConfig | null
  selectedId?: string; onSelectEvent: (id: string) => void
  /** Initial values; they become internal state afterwards. */
  windowMs?: number; follow?: boolean; width?: number
  /** Overrides "now" (default: newest event time). */
  now?: Date
  highlightIds?: string[]
}

export function LaneView({ events, state, agents, selectedId, onSelectEvent, windowMs, follow, width: widthProp, now, highlightIds }: LaneViewProps) {
  const [zoom, setZoom] = useState<Zoom>(windowMs ?? 300_000)
  const [following, setFollowing] = useState(follow ?? true)
  const [anchor, setAnchor] = useState(0)
  const [width, setWidth] = useState(widthProp ?? 800)
  const [collapseDone, setCollapseDone] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => { const w = Math.round(entry?.contentRect.width ?? 0); if (w > 0) setWidth(w) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { lanes, arrows, pausedSpans } = useMemo(() => buildLanes(events, state, agents), [events, state, agents])
  const sorted = useMemo<Arrow[]>(() => (arrows.every((a, i) => i === 0 || arrows[i - 1]!.ts <= a.ts) ? arrows : [...arrows].sort((a, b) => a.ts - b.ts)), [arrows])
  const span = useMemo(() => {
    let min = Infinity, max = -Infinity
    for (const e of events) { const ts = Date.parse(e.ts); if (ts < min) min = ts; if (ts > max) max = ts }
    return events.length ? { min, max } : null
  }, [events])
  // Per-lane latest arrow (for "current task" and elapsed time).
  const lastByLane = useMemo(() => {
    const m = new Map<string, Arrow>()
    for (const a of sorted) { m.set(a.from, a); m.set(a.to, a) }
    return m
  }, [sorted])

  const nowMs = now?.getTime() ?? span?.max ?? Date.now()
  let from: number, to: number
  if (zoom === 'all') { to = Math.max(nowMs, span?.max ?? nowMs); from = span?.min ?? to - 60_000; if (from >= to) from = to - 60_000 }
  else { to = following ? nowMs : anchor; from = to - zoom }
  const plotW = Math.max(1, width - HEAD_W - RIGHT_PAD)
  const xOf = (ms: number): number => HEAD_W + ((ms - from) / (to - from)) * plotW

  // Rows
  const rows: { lane: (typeof lanes)[number]; y: number; h: number; collapsed: boolean }[] = []
  let y = TOP
  for (const lane of lanes) {
    const collapsed = collapseDone && lane.status === 'done'
    const h = collapsed ? ROW_COLLAPSED : ROW
    rows.push({ lane, y, h, collapsed }); y += h
  }
  const plotBottom = y
  const height = y + AXIS
  const rowOf = new Map(rows.map((r) => [r.lane.key, r]))
  const fallback = rowOf.get('system') ?? rows.at(-1)
  const centerY = (key: string): number => { const r = rowOf.get(key) ?? fallback; return r ? r.y + (r.collapsed ? r.h / 2 : 22) : TOP }
  const titleOf = (key: string): string => rowOf.get(key)?.lane.title ?? (key === 'user' ? '사용자' : key)

  const visible = windowArrows(sorted, from, to)
  const highlight = new Set(highlightIds ?? [])
  let lastLabelX = -Infinity
  const arrowEls = visible.map((a) => {
    const x = xOf(a.ts)
    const showLabel = x - lastLabelX >= LABEL_GAP
    if (showLabel) lastLabelX = x
    return (
      <LaneArrow key={a.id} arrow={a} x={x} y1={centerY(a.from)} y2={centerY(a.to)} fromTitle={titleOf(a.from)} toTitle={titleOf(a.to)}
        showLabel={showLabel} selected={a.id === selectedId} highlighted={highlight.has(a.id)} onSelect={onSelectEvent} />
    )
  })

  const pausedEls = pausedSpans.flatMap((p, i) => {
    const s = Math.max(p.start, from), e = Math.min(p.end ?? to, to)
    return e > s ? [<rect key={i} className="paused-span" x={xOf(s)} y={TOP} width={xOf(e) - xOf(s)} height={plotBottom - TOP} fill={`url(#${hatchId})`} />] : []
  })
  const ticks = [0, 1, 2, 3].map((i) => from + ((to - from) * i) / 3)
  const nowX = nowMs >= from && nowMs <= to ? xOf(nowMs) : null

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0)
    if (!dx || zoom === 'all') return
    setAnchor(to + dx * ((to - from) / plotW))
    setFollowing(false)
  }
  const pickZoom = (z: Zoom) => { setAnchor(to); setFollowing(false); setZoom(z) }
  const toggleFollow = () => { if (following) setAnchor(to); setFollowing(!following) }

  return (
    <div className="laneview">
      <div className="lane-toolbar">
        <div className="seg" role="group" aria-label="시간 창">
          {ZOOMS.map((z) => (
            <button key={z.label} type="button" aria-pressed={zoom === z.value} onClick={() => pickZoom(z.value)}>{z.label}</button>
          ))}
        </div>
        <button type="button" className="lane-toggle is-follow" aria-pressed={following} onClick={toggleFollow}>실시간 따라가기</button>
        <button type="button" className="lane-toggle" aria-pressed={collapseDone} onClick={() => setCollapseDone(!collapseDone)}>완료 레인 접기</button>
      </div>
      <div className="lane-scroll" ref={scrollRef}>
        <svg className="lane-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="실시간 레인" onWheel={onWheel}>
          <defs>
            <pattern id={hatchId} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className="hatch-line" x1={0} y1={0} x2={0} y2={8} />
            </pattern>
          </defs>
          {pausedEls}
          <g className="lane-guides">
            {rows.map((r) => <line key={r.lane.key} x1={HEAD_W} y1={r.y + r.h} x2={width} y2={r.y + r.h} />)}
            <line x1={HEAD_W} y1={TOP} x2={HEAD_W} y2={plotBottom} />
          </g>
          {rows.map((r) => {
            const last = lastByLane.get(r.lane.key)
            return <LaneHead key={r.lane.key} lane={r.lane} y={r.y} height={r.h} collapsed={r.collapsed}
              task={r.lane.task ?? last?.task} elapsedMs={last ? nowMs - last.ts : undefined} />
          })}
          <g className="lane-axis">
            {ticks.map((ms, i) => <text key={i} x={xOf(ms)} y={height - 6} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}>{clock(ms, to - from <= 600_000)}</text>)}
          </g>
          {nowX !== null && (
            <g className="lane-now" aria-hidden="true">
              <line x1={nowX} y1={TOP} x2={nowX} y2={plotBottom} />
              <text x={nowX} y={12} textAnchor="end">지금</text>
            </g>
          )}
          <g className="lane-arrows">{arrowEls}</g>
        </svg>
      </div>
    </div>
  )
}
