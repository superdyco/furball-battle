import { defineConfig } from 'vitest/config';

// 規則測試：需由 firebase emulators:exec 啟動 Emulator 後執行（npm run test:rules）
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
