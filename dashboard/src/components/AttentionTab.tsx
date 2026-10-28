import { useEffect, useRef, useState } from 'react'
import type { AttentionItem } from '../model/attention'
import { AttentionCard, retryMessageFor, type CardCtx } from './AttentionCard'

const RETRY_WINDOW_MS = 5000
const itemKey = (i: AttentionItem): string => (i.kind === 'spec' ? 'spec' : i.eventId)

export function AttentionTab({ items, ...ctx }: { items: AttentionItem[] } & Omit<CardCtx, 'onResumed' | 'retryMessage'>) {
  const resumed = useRef<{ at: number; seen: Set<string> } | null>(null)
  const [repeated, setRepeated] = useState<Set<string>>(new Set())

  useEffect(() => {
    const r = resumed.current
    if (!r || Date.now() - r.at > RETRY_WINDOW_MS) return
    const fresh = items.filter((i) => !r.seen.has(itemKey(i)) && retryMessageFor(i))
    if (fresh.length === 0) return
    for (const i of fresh) r.seen.add(itemKey(i))
    setRepeated((prev) => new Set([...prev, ...fresh.map(itemKey)]))
  }, [items])

  if (items.length === 0) return <p className="panel-empty">지금 사람이 처리할 일이 없습니다</p>
  return (
    <div className="attention-list">
      {items.map((item) => {
        const key = itemKey(item)
        return (
          <AttentionCard key={key} item={item}
            ctx={{
              ...ctx,
              onResumed: () => { resumed.current = { at: Date.now(), seen: new Set(items.map(itemKey)) } },
              retryMessage: repeated.has(key) ? retryMessageFor(item) : undefined,
            }} />
        )
      })}
    </div>
  )
}
