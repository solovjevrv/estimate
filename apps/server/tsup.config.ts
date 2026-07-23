import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  // Workspace-пакет экспортирует TypeScript-исходники, поэтому вбандливаем его в сборку
  noExternal: ['@poker/shared'],
});
