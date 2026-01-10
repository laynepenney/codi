import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
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
        statements: 60,
        branches: 85,
        functions: 75,
        lines: 60,
      },
    },
  },
});
