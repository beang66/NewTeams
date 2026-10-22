import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = process.env.NEWTEAM_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: { "/api": { target: backend, changeOrigin: true } },
  },
});
