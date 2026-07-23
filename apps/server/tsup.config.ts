import { defineConfig } from 'tsup';

/** Пакеты документации: нужны только в дев-режиме, в прод-бандл не попадают */
const DOCS_PACKAGES = ['@scalar/fastify-api-reference', '@fastify/swagger'];

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  // CJS + полный бандл зависимостей: рантайм-образу не нужен node_modules
  format: ['cjs'],
  target: 'node24',
  clean: true,
  // Бандлим всё, кроме документации: страница Scalar весит почти 4 МБ
  noExternal: [new RegExp(`^(?!(${DOCS_PACKAGES.join('|')})$).*`)],
  external: DOCS_PACKAGES,
});
