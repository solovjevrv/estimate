import { defineConfig } from 'tsup';

/** Пакеты документации: нужны только в дев-режиме, в прод-бандл не попадают */
const DOCS_PACKAGES = ['@scalar/fastify-api-reference', '@fastify/swagger'];
/**
 * sharp — нативный аддон (10.15): использует `import.meta.url`/`createRequire`
 * для загрузки платформенного .node-биндинга. Бандл esbuild переписывает эти
 * ссылки и ломает загрузку (воспроизводится в Linux-CI, не на всех платформах
 * одинаково) — оставляем как обычный require из node_modules в рантайм-образе.
 */
const EXTERNAL_PACKAGES = [...DOCS_PACKAGES, 'sharp'];

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  // CJS + полный бандл зависимостей: рантайм-образу почти не нужен node_modules
  format: ['cjs'],
  target: 'node24',
  clean: true,
  noExternal: [new RegExp(`^(?!(${EXTERNAL_PACKAGES.join('|')})$).*`)],
  external: EXTERNAL_PACKAGES,
});
