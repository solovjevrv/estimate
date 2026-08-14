import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Перечислены явно, а не маской `apps/*`: под маску попадал и `apps/load-test`,
    // где нет ни одного vitest-теста (там свой раннер через `pnpm loadtest`), из-за
    // чего пустой проект каждый раз поднимался впустую.
    // `apps/e2e` — тесты Playwright, свой раннер и свой `test` в package.json.
    projects: ['apps/server', 'apps/web', 'packages/shared'],
  },
});
