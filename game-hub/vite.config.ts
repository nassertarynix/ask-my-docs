import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` makes the build work from any folder or sub-path (Cloudflare Pages,
// GitHub Pages project sites, or any static server) without configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    // the artillery AI tests really solve shots; on a busy shared CI runner they need far more than the 5 s default
    testTimeout: 30_000,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts', 'relay/__tests__/**/*.test.ts'],
  },
});
