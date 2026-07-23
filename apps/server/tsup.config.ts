import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  // CJS + полный бандл зависимостей: рантайм-образу не нужен node_modules
  format: ['cjs'],
  target: 'node24',
  clean: true,
  noExternal: [/.*/],
});
