import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for the pure-logic unit tests. Node environment only —
 * these tests never touch Electron, Playwright, the DOM or the filesystem.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@core': resolve('src/core')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false
  }
})
