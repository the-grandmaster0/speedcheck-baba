import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy upload requests through the dev server to bypass CORS
      '/upload-proxy': {
        target: 'https://speed.cloudflare.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/upload-proxy/, '/__up'),
      },
    },
  },
})
