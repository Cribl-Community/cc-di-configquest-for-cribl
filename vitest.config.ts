import { defineConfig } from 'vitest/config';

// The data layer is pure (no DOM), so tests run in the Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
