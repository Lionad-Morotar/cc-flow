import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'cc-flow',
    environment: 'node',
    pool: 'forks',
    include: ['tests/**/*.test.ts'],
  },
})
