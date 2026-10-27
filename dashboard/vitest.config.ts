import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const alias = { '@orch': fileURLToPath(new URL('../orchestrator/src', import.meta.url)) }

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'] },
      },
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: ['test/**/*.test.tsx'], setupFiles: ['test/setup.ts'] },
      },
    ],
  },
})
