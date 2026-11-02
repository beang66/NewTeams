import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@orch': fileURLToPath(new URL('../orchestrator/src', import.meta.url)) } },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:4317', '/p/': 'http://127.0.0.1:4317' } },
})
