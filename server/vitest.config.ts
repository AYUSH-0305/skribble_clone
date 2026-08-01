import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests spin up a real HTTP + Socket.IO server; give them room
    // and don't run test files in parallel to avoid port/timer contention.
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
  },
});
