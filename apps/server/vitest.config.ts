import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Миграции накатываются один раз до всех файлов тестов
    globalSetup: ['./test/global-setup.ts'],
  },
});
