export type Callback =
  | { kind: 'guide'; eventId: string } | { kind: 'skip'; eventId: string } | { kind: 'skipConfirm'; eventId: string }
  | { kind: 'detail'; eventId: string } | { kind: 'approve' } | { kind: 'approveConfirm' }
  | { kind: 'resume' } | { kind: 'ask'; key: string } | { kind: 'report' } | { kind: 'cancel' }

const EVENT_ID = /^msg-\d+$/
const ASK_KEY = /^[a-z0-9]{1,16}$/
const PREFIX = { guide: 'g', skip: 'k', skipConfirm: 'K', detail: 'd' } as const
type EventKind = keyof typeof PREFIX
const WITH_EVENT = new Map<string, EventKind>((Object.entries(PREFIX) as [EventKind, string][]).map(([k, p]) => [p, k]))

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
  const kind = WITH_EVENT.get(head)
  return kind && EVENT_ID.test(rest) ? { kind, eventId: rest } : null
}
