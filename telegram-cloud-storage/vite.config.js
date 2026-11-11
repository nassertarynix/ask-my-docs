import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `base: './'` so the built files load from the Tauri bundle (tauri://localhost) or any folder.
// Port 1420 is what the Tauri dev window and the backend's CORS allow-list expect.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});
