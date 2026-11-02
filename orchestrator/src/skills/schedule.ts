// 루틴 일정 계산. Node API를 쓰지 않아 대시보드도 그대로 불러 쓴다.

/** days: 0=일 … 6=토 (weekly만). time: 이 PC 시간대의 HH:MM */
export interface Schedule { kind: 'daily' | 'weekly'; time: string; days?: number[] }

const at = (day: Date, time: string): Date => {
  const [h, m] = time.split(':').map(Number)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
}
const onDay = (s: Schedule, d: Date): boolean => s.kind === 'daily' || (s.days ?? []).includes(d.getDay())

/** now 이전(같은 시각 포함)의 가장 최근 예정 시각. 최근 8일 안에 없으면 null. */
export function latestDue(s: Schedule, now: Date): Date | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const t = at(d, s.time)
    if (onDay(s, d) && t <= now) return t
  }
  return null
}

/** now 이후의 다음 예정 시각. */
export function nextDue(s: Schedule, now: Date): Date | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const t = at(d, s.time)
    if (onDay(s, d) && t > now) return t
  }
  return null
}
