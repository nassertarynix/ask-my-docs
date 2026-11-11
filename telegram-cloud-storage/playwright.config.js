import { defineConfig } from '@playwright/test';

// The browser tests run the real backend (with a local folder standing in for the Telegram channel, so no account is
// needed) and the built frontend. Chunks are 64 KB, so a few hundred KB spans several chunks.
const PY = process.env.TGCS_E2E_PYTHON || 'python';
const API = 'http://127.0.0.1:8765';
export const TOKEN = 'e2e-token-0123456789abcdef';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false, // one shared backend and data folder
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:1420', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  webServer: [
    {
      command: `rm -rf .e2e && ${PY} -m backend.main`,
      url: `${API}/api/health`,
      reuseExistingServer: false,
      env: { TGCS_BACKEND: 'local', TGCS_DATA_DIR: '.e2e/data', TGCS_LOCAL_DIR: '.e2e/channel', TGCS_TOKEN: TOKEN, TGCS_PORT: '8765', TGCS_CHUNK_MB: '0.0625' },
    },
    { command: 'npm run build && npx vite preview --port 1420 --host 127.0.0.1 --strictPort', url: 'http://127.0.0.1:1420', reuseExistingServer: false, timeout: 120_000 },
  ],
});
