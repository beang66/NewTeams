export type Callback =
  | { kind: 'guide'; eventId: string } | { kind: 'skip'; eventId: string } | { kind: 'skipConfirm'; eventId: string }
  | { kind: 'detail'; eventId: string } | { kind: 'approve' } | { kind: 'approveConfirm' }
  | { kind: 'resume' } | { kind: 'ask'; key: string } | { kind: 'report' } | { kind: 'cancel' }

const EVENT_ID = /^msg-\d+$/
const ASK_KEY = /^[a-z0-9]{1,16}$/
const WITH_EVENT = { g: 'guide', k: 'skip', K: 'skipConfirm', d: 'detail' } as const
const PREFIX = { guide: 'g', skip: 'k', skipConfirm: 'K', detail: 'd' } as const

export function encodeCallback(c: Callback): string {
  switch (c.kind) {
    case 'guide': case 'skip': case 'skipConfirm': case 'detail': return `${PREFIX[c.kind]}:${c.eventId}`
    case 'ask': return `q:${c.key}`
    case 'approve': return 'a'
    case 'approveConfirm': return 'A'
    case 'resume': return 'r'
    case 'report': return 'rp'
    case 'cancel': return 'x'
  }
}

export function decodeCallback(data: string): Callback | null {
  switch (data) {
    case 'a': return { kind: 'approve' }
    case 'A': return { kind: 'approveConfirm' }
    case 'r': return { kind: 'resume' }
    case 'rp': return { kind: 'report' }
    case 'x': return { kind: 'cancel' }
  }
  const i = data.indexOf(':')
  if (i < 1) return null
  const head = data.slice(0, i), rest = data.slice(i + 1)
  if (head === 'q') return ASK_KEY.test(rest) ? { kind: 'ask', key: rest } : null
  if (head in WITH_EVENT && EVENT_ID.test(rest)) return { kind: WITH_EVENT[head as keyof typeof WITH_EVENT], eventId: rest }
  return null
}
