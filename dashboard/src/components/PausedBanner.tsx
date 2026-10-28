import { useEffect, useRef, useState } from 'react'
import { reasonLabel } from '../model/labels'
import type { UsageView } from '../model/usage'

type Paused = NonNullable<UsageView['paused']>

function remainingText(ms: number): string {
  if (ms <= 0) return '곧'
  const sec = Math.ceil(ms / 1000)
  if (sec < 60) return `${sec}초 남음`
  const min = Math.ceil(sec / 60)
  return min < 60 ? `${min}분 남음` : `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''} 남음`
}

const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export function PausedBanner({ paused, now = Date.now }: { paused: Paused; now?: () => number }) {
  const start = useRef(now())
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  void tick
  const label = reasonLabel(paused.reason)
  let text: string
  if (paused.needsHuman) text = `${label}으로 일시정지 — 터미널에서 다시 로그인 필요`
  else if (paused.until && paused.remainingMs !== undefined) {
    const left = Math.max(0, paused.remainingMs - (now() - start.current))
    text = `${label}으로 일시정지 — ${hhmm(paused.until)}에 자동 재개 (${remainingText(left)})`
  } else text = `${label}으로 일시정지 — 재개 시각 미정`
  return <div className="paused-banner" role="status">{text}</div>
}
