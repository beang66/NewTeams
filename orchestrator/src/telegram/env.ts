export interface TelegramSecrets { token: string; chatId: string }

export function readTelegramSecrets(env: NodeJS.ProcessEnv = process.env): TelegramSecrets | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = env.TELEGRAM_CHAT_ID?.trim()
  return token && chatId ? { token, chatId } : null
}

export function redact(text: string, token?: string): string {
  let out = text
  if (token) out = out.split(`bot${token}`).join('bot***').split(token).join('***')
  return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot***')
}
