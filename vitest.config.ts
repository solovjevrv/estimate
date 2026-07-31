import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // apps/e2e — тесты Playwright (свой раннер, свой package.json test), не Vitest
    projects: ['apps/*', 'packages/*', '!apps/e2e'],
  },
});
