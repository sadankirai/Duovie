import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const apiOrigin =
    loadEnv(mode, process.cwd(), '').DUOVIE_API_ORIGIN || 'https://127.0.0.1:7245'

  return {
    plugins: [react()],
    server: command === 'serve' && mode !== 'test'
      ? {
          proxy: {
            '/api': {
              target: apiOrigin,
              changeOrigin: true,
              secure: false,
            },
            '/hubs': {
              target: apiOrigin,
              changeOrigin: true,
              secure: false,
              ws: true,
            },
          },
        }
      : undefined,
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  }
})
