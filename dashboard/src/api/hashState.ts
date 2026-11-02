import { useCallback, useState } from 'react'

/** `#/run?tab=detail` → path `/run`, params `tab=detail`. */
function splitHash(): { path: string; params: URLSearchParams } {
  const hash = window.location.hash.replace(/^#/, '')
  const i = hash.indexOf('?')
  return { path: i >= 0 ? hash.slice(0, i) : hash, params: new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '') }
}

/**
 * 화면 상태 하나를 해시 주소의 질의(`#/run?tab=detail`)와 맞춘다. 새로고침·링크 공유 뒤에도 같은 화면이 열린다.
 * replaceState로 쓰므로 hashchange가 나지 않아 라우팅을 다시 타지 않고, 뒤로 가기 기록도 쌓이지 않는다.
 * 기본값은 주소에서 지운다. fromUrl=false면 처음 값으로 주소를 읽지 않는다(링크가 열 화면을 정한 경우).
 */
export function useHashParam<T extends string>(key: string, fallback: T, allowed?: readonly T[], fromUrl = true): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const v = fromUrl ? splitHash().params.get(key) : null
    return v !== null && (!allowed || (allowed as readonly string[]).includes(v)) ? (v as T) : fallback
  })
  const set = useCallback((v: T) => {
    setValue(v)
    const { path, params } = splitHash()
    if (v === fallback) params.delete(key)
    else params.set(key, v)
    const qs = params.toString()
    window.history.replaceState(window.history.state, '', `#${path || '/'}${qs ? `?${qs}` : ''}`)
  }, [key, fallback])
  return [value, set]
}
