import { describe, it, expect } from 'vitest'
import { encodeCallback, decodeCallback, type Callback } from '../../src/telegram/callbacks.js'

const ALL_CALLBACKS: Callback[] = [
  { kind: 'guide', eventId: 'msg-0058' }, { kind: 'skip', eventId: 'msg-1' }, { kind: 'skipConfirm', eventId: 'msg-1234567890' },
  { kind: 'detail', eventId: 'msg-7' }, { kind: 'approve' }, { kind: 'approveConfirm' }, { kind: 'resume' },
  { kind: 'ask', key: 'abc123' }, { kind: 'report' }, { kind: 'cancel' },
]

describe('telegram callbacks', () => {
  it('버튼 데이터 왕복과 64바이트 제한', () => {
    for (const c of ALL_CALLBACKS) expect(decodeCallback(encodeCallback(c))).toEqual(c)
    expect(Buffer.byteLength(encodeCallback({ kind: 'skipConfirm', eventId: 'msg-1234567890' }))).toBeLessThanOrEqual(64)
    expect(decodeCallback('zz:what')).toBeNull()
  })
  it('정확한 형식', () => {
    expect(ALL_CALLBACKS.map(encodeCallback)).toEqual(['g:msg-0058', 'k:msg-1', 'K:msg-1234567890', 'd:msg-7', 'a', 'A', 'r', 'q:abc123', 'rp', 'x'])
  })
  it('잘못된 값은 null', () => {
    for (const s of ['g:foo', 'g:msg-', 'g:msg-1x', 'q:', 'q:ABC', 'q:' + 'a'.repeat(17), 'a:1', 'rp:1', '', 'g:msg-1\n', 'toString:msg-1', 'constructor:msg-1', 'valueOf:msg-1', '__proto__:msg-1']) expect(decodeCallback(s)).toBeNull()
  })
})
