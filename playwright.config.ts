import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' } },
  projects: [{ name: 'escritorio', use: { ...devices['Desktop Chrome'] } }, { name: 'movil', use: { ...devices['Pixel 7'] } }],
});
