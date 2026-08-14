import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Правила, требующие типов, ловят то, чего синтаксический разбор не видит —
 * прежде всего незакрытые промисы. Раньше их гасили вручную (`void
 * app.register(...)` в `app.ts`), то есть про проблему знали, но проверял её
 * только человек.
 *
 * Часть правил набора отключена ниже — не «чтобы было зелено», а потому что на
 * этом стеке они дают ложные срабатывания. Каждое отключение с обоснованием.
 *
 * ВАЖНО про `eslint --fix` в `.vue`: типы там линтер считает сам, и считает
 * иначе, чем vue-tsc. Автофикс `no-unnecessary-type-assertion` уже снимал
 * `as BoardOp`, который на самом деле нужен (контекстный тип массива не
 * протекает в колбэк `.map` через спред) — `pnpm lint` при этом зеленел, а
 * `pnpm typecheck` падал. После автофикса по `.vue` всегда прогонять typecheck.
 */
const UNSAFE_ANY_RULES = {
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: {
        // projectService сам подбирает tsconfig для каждого файла монорепозитория
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Async-функция без await — не дефект: у Fastify плагины и хендлеры async
      // по контракту сигнатуры, ждать им при этом нечего. 80 срабатываний, ни
      // одной реальной ошибки — правило только приучало бы игнорировать вывод.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    // typescript-eslint — не vue-tsc: импорт `./Foo.vue` он не типизирует и отдаёт
    // `any`, из-за чего любое обращение к импортированному компоненту помечается
    // как небезопасное. Это ограничение инструмента, а не свойство кода —
    // настоящую проверку типов SFC делает `pnpm typecheck` через vue-tsc.
    // Шим `declare module '*.vue'` не заводим намеренно: он бы «починил» линтер,
    // но заодно огрубил бы типы компонентов до generic и для vue-tsc.
    // Сюда же два .ts-файла, которые импортируют SFC напрямую.
    files: ['**/*.vue', 'apps/web/src/main.ts', 'apps/web/src/router/index.ts'],
    rules: UNSAFE_ANY_RULES,
  },
  {
    files: ['apps/web/**/*.{ts,vue}'],
    languageOptions: {
      // __APP_VERSION__ — build-time define из vite.config.ts (см. env.d.ts)
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
    },
  },
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Тесты работают с моками и обобщёнными типами библиотек (`VueWrapper<any, any>`
    // у @vue/test-utils), поэтому `any` там приходит извне и убрать его нечем.
    // Правила про промисы намеренно оставлены включёнными: незакрытый промис в
    // тесте — это флакующий тест.
    files: ['**/test/**', '**/tests/**', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      ...UNSAFE_ANY_RULES,
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Сохранение метода ради восстановления (`const original = localStorage.setItem`)
      // — стандартная идиома теста: ссылку кладут обратно, а не вызывают отвязанной.
      '@typescript-eslint/unbound-method': 'off',
      // checksVoidReturn выключен точечно: мок `fetch` обязан возвращать промис,
      // а `vi.fn()` типизирован как возвращающий void — правило считает это ошибкой.
      // Остальные проверки (промис в условии, в спреде) остаются включёнными, и
      // `no-floating-promises` в тестах тоже: незакрытый промис — это флакующий тест.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    // Конфиги сборки вне tsconfig проектов — без типовых правил, иначе
    // projectService ругается «файл не входит ни в один проект»
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettierConfig,
);
