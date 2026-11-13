import { defineConfig } from 'vitest/config';

// Development benchmarks (L5-MEASURE): not part of `npm test`. `npm run bench:sim`.
export default defineConfig({
  test: {
    include: ['packages/*/test/bench/*.bench.ts'],
    environment: 'node',
  },
});
