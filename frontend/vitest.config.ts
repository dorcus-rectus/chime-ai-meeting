/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      typecheck: { tsconfig: './tsconfig.test.json' },
      setupFiles: ['./src/__tests__/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['node_modules', 'dist', 'e2e'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/__tests__/**',
          'src/**/*.{test,spec}.{ts,tsx}',
          'src/main.tsx',
        ],
        thresholds: {
          statements: 50,
          branches: 50,
          functions: 50,
          lines: 50,
        },
      },
    },
  }),
);
