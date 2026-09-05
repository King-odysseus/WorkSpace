/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  // Component tests run against happy-dom rather than jsdom: jsdom's dependency
  // chain needs `require(esm)`, which Node 20.17 (the current local runtime) does
  // not support. setup-tests.js registers jest-dom matchers and resets the fetch
  // stub between tests, so no test leaks state into the next.
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: './src/test/setup-tests.js',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
})
