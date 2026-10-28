import { describe, it, expect } from 'vitest'
import { readTelegramSecrets, redact } from '../../src/telegram/env.js'

describe('telegram env', () => {
  it('토큰과 채팅이 모두 있어야 켜진다', () => {
    expect(readTelegramSecrets({ TELEGRAM_BOT_TOKEN: 'a', TELEGRAM_CHAT_ID: '' })).toBeNull()
    expect(readTelegramSecrets({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '1' })).toBeNull()
    expect(readTelegramSecrets({})).toBeNull()
    expect(readTelegramSecrets({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42' })).toEqual({ token: '123:abc', chatId: '42' })
  })
  it('토큰 치환', () => {
    expect(redact('POST https://api.telegram.org/bot123:abc/sendMessage failed', '123:abc')).toBe('POST https://api.telegram.org/bot***/sendMessage failed')
    expect(redact('token 123:abc leaked', '123:abc')).toBe('token *** leaked')
    expect(redact('bot123:abc and bot123:abc', '123:abc')).toBe('bot*** and bot***')
  })
  it('토큰 없이도 bot<id>:<secret> 패턴 치환', () => {
    expect(redact('GET /bot123456789:AAE_abcdefghijklmnopqrstu-vw/getMe')).toBe('GET /bot***/getMe')
    expect(redact('nothing here')).toBe('nothing here')
  })
})
