import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // The Pipecat dev runner (`uv run bot.py` in ../server): /start
      // registers a session (SmallWebRTC) or creates a Daily room (Daily),
      // /sessions/<id>/api/offer is the SmallWebRTC offer for it, /api/offer
      // the direct offer endpoint, /status a health check.
      "/start": "http://localhost:7860",
      "/sessions": "http://localhost:7860",
      "/api/offer": "http://localhost:7860",
      "/status": "http://localhost:7860",
    },
  },
})
