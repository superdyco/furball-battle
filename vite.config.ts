import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
