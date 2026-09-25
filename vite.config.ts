import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // MapLibre worker'į kuria kaip ES modulį (new Worker(url, { type: 'module' })).
  worker: { format: 'es' },
})
