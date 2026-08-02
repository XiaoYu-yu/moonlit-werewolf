import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'game-core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
