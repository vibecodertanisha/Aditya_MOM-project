import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,     // ⬅️ binds to 0.0.0.0 so it’s accessible externally
    port: 5174,     // ⬅️ optional – set to your desired port
  },
})
