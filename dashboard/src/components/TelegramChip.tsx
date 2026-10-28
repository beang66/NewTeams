import { useEffect, useState } from 'react'
import { api, type TelegramStatus } from '../api/client'

const POLL_MS = 30_000

export function TelegramChip() {
  const [status, setStatus] = useState<TelegramStatus>({ state: 'off' })
  useEffect(() => {
    let disposed = false
    const read = () => { void api.telegram().then((s) => { if (!disposed) setStatus(s) }, () => undefined) }
    read()
    const id = setInterval(read, POLL_MS)
    return () => { disposed = true; clearInterval(id) }
  }, [])
  switch (status.state) {
    case 'off': return null
    case 'connecting': return <span className="chip">텔레그램 연결 중</span>
    case 'connected': return <span className="chip">{status.botUsername ? `텔레그램 @${status.botUsername}` : '텔레그램 연결됨'}</span>
    case 'error': return <span className="chip is-warn" title={status.lastError}>텔레그램 끊김</span>
  }
}
