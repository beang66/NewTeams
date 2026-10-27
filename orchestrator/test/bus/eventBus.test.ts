import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { ProjectStore } from '../../src/store/projectStore.js'
import { EventBus } from '../../src/bus/eventBus.js'
import { tmpDir, rmDir, fakeClock, ev } from '../helpers.js'

let dir: string
let store: ProjectStore
beforeEach(async () => { dir = await tmpDir(); store = new ProjectStore(join(dir, 'p')); await store.init() })
afterEach(async () => { vi.restoreAllMocks(); await rmDir(dir) })

describe('EventBus', () => {
  it('ID는 재시작 후에도 이어진다', async () => {
    const bus1 = new EventBus(store, fakeClock)
    await bus1.publish(ev('CHAT')); await bus1.publish(ev('CHAT'))
    const bus2 = new EventBus(store, fakeClock, (await store.readEvents()).at(-1)!.id)
    expect((await bus2.publish(ev('CHAT'))).id).toBe('msg-0003')
  })
  it('ts는 clock에서, 구독자 호출 및 해제', async () => {
    const bus = new EventBus(store, fakeClock)
    const got: string[] = []
    const off = bus.subscribe(e => got.push(e.id))
    const e1 = await bus.publish(ev('CHAT'))
    expect(e1.ts).toBe('2026-10-26T00:00:00.000Z')
    off(); await bus.publish(ev('CHAT'))
    expect(got).toEqual(['msg-0001'])
  })
  it('구독자 예외는 publish를 깨지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bus = new EventBus(store, fakeClock)
    const got: string[] = []
    bus.subscribe(() => { throw new Error('boom') })
    bus.subscribe(e => got.push(e.id))
    await expect(bus.publish(ev('CHAT'))).resolves.toBeTruthy()
    expect(got).toEqual(['msg-0001']); expect(err).toHaveBeenCalled()
  })
  it('동시에 publish 20번 → ID 1..20 오름차순', async () => {
    const bus = new EventBus(store, fakeClock)
    await Promise.all(Array.from({ length: 20 }, () => bus.publish(ev('CHAT'))))
    const ids = (await store.readEvents()).map(e => e.id)
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => `msg-${String(i + 1).padStart(4, '0')}`))
  })
  it('10000 이상도 이어진다', async () => {
    const bus = new EventBus(store, fakeClock, 'msg-9999')
    expect((await bus.publish(ev('CHAT'))).id).toBe('msg-10000')
  })
  it('실패한 publish 뒤에도 큐가 계속 동작', async () => {
    const bus = new EventBus(store, fakeClock)
    const orig = store.appendEvent.bind(store)
    let fail = true
    store.appendEvent = async (e) => { if (fail) { fail = false; throw new Error('disk') } return orig(e) }
    await expect(bus.publish(ev('CHAT'))).rejects.toThrow('disk')
    expect((await bus.publish(ev('CHAT'))).id).toBe('msg-0001')
  })
})
