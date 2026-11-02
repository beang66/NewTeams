import { useLayoutEffect, useRef } from 'react'
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import type { Envelope } from '@orch/protocol/messages'
import { typeLabel } from '../model/labels'
import { clockHMS } from '../model/time'

const ROW_H = 44
const FALLBACK_H = 480
const clock = (ts: string): string => clockHMS(new Date(ts))

/** Narrow-screen chronological list (oldest on top, newest at the bottom), virtualized. */
export function TimelineList({ events, selectedId, onSelectEvent }: { events: Envelope[]; selectedId?: string; onSelectEvent: (id: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const v = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 6,
    initialRect: { width: 0, height: FALLBACK_H },
    initialOffset: () => Math.max(0, events.length * ROW_H - FALLBACK_H),
    // Unmeasured (hidden / no layout) containers report 0 height; keep a sane window instead of rendering nothing.
    observeElementRect: (inst, cb) => observeElementRect(inst, (r) => cb(r.height ? r : { ...r, height: FALLBACK_H })),
  })

  useLayoutEffect(() => {
    if (stick.current && events.length) v.scrollToIndex(events.length - 1, { align: 'end' })
  }, [events.length, v])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_H
  }

  return (
    <div className="timeline" ref={scrollRef} onScroll={onScroll}>
      <ul role="list" aria-label="이벤트 목록" className="timeline-list" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((item) => {
          const e = events[item.index]!
          return (
            <li key={e.id} className="timeline-row" style={{ transform: `translateY(${item.start}px)`, height: ROW_H }}>
              <button type="button" className="timeline-item" aria-pressed={e.id === selectedId} onClick={() => onSelectEvent(e.id)}>
                <span className="mono timeline-time">{clock(e.ts)}</span>
                <span className="truncate">{e.from} → {e.to}{e.task ? ` · ${e.task}` : ''}</span>
                <span className="timeline-type">{typeLabel[e.type]}</span>
                <span className="mono timeline-id">{e.id}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
