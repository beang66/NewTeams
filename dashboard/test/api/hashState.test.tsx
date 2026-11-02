import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHashParam } from '../../src/api/hashState'

afterEach(() => { window.history.replaceState(null, '', '/') })

describe('useHashParam', () => {
  it('주소에 값이 없으면 기본값', () => {
    window.history.replaceState(null, '', '/#/run')
    const { result } = renderHook(() => useHashParam('tab', 'attention', ['attention', 'detail'] as const))
    expect(result.current[0]).toBe('attention')
  })
  it('주소의 값을 읽고, 허용되지 않은 값은 기본값', () => {
    window.history.replaceState(null, '', '/#/run?tab=detail&sub=nope')
    expect(renderHook(() => useHashParam('tab', 'attention', ['attention', 'detail'] as const)).result.current[0]).toBe('detail')
    expect(renderHook(() => useHashParam('sub', 'human', ['human', 'raw'] as const)).result.current[0]).toBe('human')
  })
  it('바꾸면 경로와 다른 값은 지키며 주소에 남기고, 기본값이면 지운다', () => {
    window.history.replaceState(null, '', '/#/run?sub=raw')
    const { result } = renderHook(() => useHashParam('tab', 'attention', ['attention', 'detail'] as const))
    act(() => result.current[1]('detail'))
    expect(result.current[0]).toBe('detail')
    expect(window.location.hash).toBe('#/run?sub=raw&tab=detail')
    act(() => result.current[1]('attention'))
    expect(window.location.hash).toBe('#/run?sub=raw')
  })
  it('fromUrl=false면 주소의 값을 무시하고 기본값으로 시작한다(보고서 링크로 특정 화면에 갈 때)', () => {
    window.history.replaceState(null, '', '/#/run?tab=master')
    const { result } = renderHook(() => useHashParam('tab', 'detail', ['attention', 'master', 'detail'] as const, false))
    expect(result.current[0]).toBe('detail')
  })
  it('허용 목록이 없으면 아무 문자열이나 받는다', () => {
    window.history.replaceState(null, '', '/#/?project=%ED%99%88')
    const { result } = renderHook(() => useHashParam('project', ''))
    expect(result.current[0]).toBe('홈')
    act(() => result.current[1](''))
    expect(window.location.hash).toBe('#/')
  })
})
