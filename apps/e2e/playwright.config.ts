import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // нет .env — переменные приходят из окружения (CI)
}

const WEB_PORT = 5173;
const SERVER_PORT = 3000;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

// Хелперы читают тот же адрес, чтобы куки ставились под правильный origin
process.env.E2E_WEB_ORIGIN = WEB_ORIGIN;

export default defineConfig({
  testDir: './tests',
  globalSetup: './src/global-setup.ts',
  globalTeardown: './src/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'on-first-retry',
    // Приложение определяет язык по navigator.languages — тексты в тестах на русском
    locale: 'ru-RU',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Собранный сервер (не tsx watch) — быстрее стартует и не перезагружается на лету
      command: 'node dist/index.cjs',
      cwd: '../server',
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(SERVER_PORT),
        WEB_ORIGIN,
        PUBLIC_ORIGIN: `http://localhost:${SERVER_PORT}`,
        DOCS_ENABLED: 'false',
        NODE_ENV: 'production',
      },
    },
    {
      // Дев-сервер веба — его прокси на /api и /socket.io избавляет от отдельного nginx в E2E
      command: 'pnpm --filter @estimate/web dev -- --port 5173 --strictPort',
      cwd: '../..',
      url: WEB_ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
