import { useEffect, useState } from 'react'
import { reasonLabel } from '../model/labels'
import type { UsageView } from '../model/usage'
import { clockHM } from '../model/time'

type Paused = NonNullable<UsageView['paused']>

function remainingText(ms: number): string {
  if (ms <= 0) return '곧'
  const sec = Math.ceil(ms / 1000)
  if (sec < 60) return `${sec}초 남음`
  const min = Math.ceil(sec / 60)
  return min < 60 ? `${min}분 남음` : `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''} 남음`
}

const hhmm = (d: Date): string => clockHM(d)

export function PausedBanner({ paused, now = Date.now }: { paused: Paused; now?: () => number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000) // only forces a re-render
    return () => clearInterval(id)
  }, [])
  const label = `일시정지 · ${reasonLabel(paused.reason)}`
  let text: string
  if (paused.needsHuman) {
    if (paused.reason === 'auth') text = `${label} — 터미널에서 다시 로그인 필요`
    else if (paused.reason === 'openai_cap') text = `${label} — OpenAI API 지출 상한($8) 도달 — 설정에서 상한(openaiCapUsd)을 올린 뒤 [재개]를 누르세요`
    else text = `${label} — 사람 확인 필요`
  } else if (paused.until) {
    text = `${label} — ${hhmm(paused.until)}에 자동 재개 (${remainingText(paused.until.getTime() - now())})`
  } else text = `${label} — 재개 시각 미정`
  return <div className="paused-banner" role="status">{text}</div>
}
