import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    files: ['apps/web/**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Композаблы Nuxt UI подставляются автоимпортом (см. auto-imports.d.ts),
        // поэтому в исходниках их не импортируют — объявляем как глобальные
        useToast: 'readonly',
        useOverlay: 'readonly',
      },
    },
  },
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  prettierConfig,
);
