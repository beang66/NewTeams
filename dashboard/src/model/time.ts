// 화면 전체의 시각·날짜 표기. 직접 조립하지 않고 Intl로 만든다(24시간제, 두 자리).
const HM = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const HMS = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const YM = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit' })

/** 08:05 */
export const clockHM = (d: Date | number): string => HM.format(d)
/** 08:05:03 */
export const clockHMS = (d: Date | number): string => HMS.format(d)
/** 2026.11 — 연·월 숫자는 Intl에서 받고, 구분자만 화면 디자인에 맞춘다. */
export const yearMonth = (d: Date): string =>
  YM.formatToParts(d).filter((p) => p.type === 'year' || p.type === 'month').map((p) => p.value).join('.')
