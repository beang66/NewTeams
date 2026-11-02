import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// 화면 상태 일부를 주소(#/…?tab=…)에 남기므로, 테스트끼리 섞이지 않게 매번 비운다.
afterEach(() => { if (typeof window !== 'undefined') window.history.replaceState(null, '', '/') })
