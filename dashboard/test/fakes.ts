import { vi } from 'vitest'
import type { Envelope } from '@orch/protocol/messages'

type Listener = (e: { data: string }) => void

/** Minimal EventSource stand-in: emit(envelope), fail(), open(). */
export class FakeEventSource {
  onerror: ((e?: unknown) => void) | null = null
  onopen: ((e?: unknown) => void) | null = null
  closed = false
  readyState = 1
  private listeners: Record<string, Listener[]> = {}
  constructor(public url = '/api/stream') {}
  addEventListener(type: string, fn: Listener): void { (this.listeners[type] ??= []).push(fn) }
  removeEventListener(type: string, fn: Listener): void { this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== fn) }
  close(): void { this.closed = true }
  emit(env: Envelope): void { for (const l of this.listeners.envelope ?? []) l({ data: JSON.stringify(env) }) }
  fail(): void { this.onerror?.() }
  /** Browser gave up reconnecting (readyState CLOSED). */
  failClosed(): void { this.readyState = 2; this.onerror?.() }
  open(): void { this.onopen?.() }
  asEventSource(): EventSource { return this as unknown as EventSource }
}

export function ev(id: string, type: Envelope['type'] = 'CHAT', payload: unknown = {}, extra: Partial<Envelope> = {}): Envelope {
  return { id, ts: '2026-01-01T00:00:00Z', type, from: 'a', to: 'b', payload, ...extra }
}

/** Route-based fetch stub. Value is [status, body] (body object -> JSON, string -> text). */
export function stubFetch(routes: Record<string, [number, unknown] | (() => [number, unknown])>): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    calls.push(key)
    const route = routes[key] ?? routes[url]
    if (!route) return new Response('{}', { status: 404 })
    const [status, body] = typeof route === 'function' ? route() : route
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(status === 204 ? null : text, { status })
  }))
  return { calls }
}
