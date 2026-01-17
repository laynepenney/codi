import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Default timeout (increased for e2e tests in their own files)
    testTimeout: 10000,
    // Retry failed tests (helps with flaky e2e tests)
    retry: 1,
    // Run test files in sequence to avoid resource contention
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // CLI entry point - tested via integration
        'src/**/*.d.ts',
      ],
      thresholds: {
        // Current baseline - increase as coverage improves
        statements: 45,
        branches: 75,
        functions: 60,
        lines: 45,
      },
    },
  },
});
