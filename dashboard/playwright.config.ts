import { defineConfig } from '@playwright/test'

const PORT = 4318

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  // Always serve a fresh production build; nothing here talks to the real orchestrator.
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'desktop', testMatch: ['flows.spec.ts', 'home.spec.ts'], grepInvert: /모바일\)/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', testMatch: ['mobile.spec.ts', 'home.spec.ts'], grep: /모바일/, use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
})
