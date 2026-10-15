import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/rules/**', 'tests/e2e/**', 'node_modules/**'],
    testTimeout: 120_000,
  },
});
