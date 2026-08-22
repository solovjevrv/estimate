import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
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
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
    },
    rules: {
      // Async-функция без await — не дефект: у Fastify плагины и хендлеры async
      // по контракту сигнатуры, ждать им при этом нечего. 80 срабатываний, ни
      // одной реальной ошибки — правило только приучало бы игнорировать вывод.
      '@typescript-eslint/require-await': 'off',

      // Циклы между модулями: из-за них порядок инициализации становится
      // неочевидным (импортируемое значение может оказаться undefined в момент
      // обращения), а вынести кусок кода в отдельный файл становится нельзя.
      'import-x/no-cycle': ['error', { maxDepth: 10, ignoreExternal: true }],

      // Комментарии и пустые строки не считаем: в этом проекте комментарии
      // объясняют «почему» и их много — метрика должна мерить код, а не документацию.
      // Порог сознательно высокий: это не стилевой идеал, а граница, за которой
      // файл перестаёт помещаться в голову и его нельзя протестировать.
      'max-lines': ['error', { max: 700, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Словари локалей — данные, а не логика: они растут вместе с фичами, и
    // дробить их по размеру нечего.
    files: ['apps/web/src/i18n/locales/**'],
    rules: { 'max-lines': 'off' },
  },
  {
    // Тесты — линейный перечень случаев: их читают по одному, а не держат в
    // голове целиком, и связность внутри файла не растёт от его длины. Правило
    // нацелено на продовый код, где размер означает переплетённые обязанности.
    // (Отдельные разросшиеся файлы вроде room-page.test.ts дробить всё же стоит —
    // по случаю, а не под угрозой красного CI.)
    files: ['**/test/**', '**/tests/**', '**/*.test.ts', '**/*.spec.ts'],
    rules: { 'max-lines': 'off' },
  },
  {
    /**
     * Известный долг: файлы, уже переросшие порог до его появления. Список —
     * не индульгенция, а реестр: он должен только сокращаться, и каждая строка
     * названа задачей, которая его уберёт. Новый файл сверх порога так не
     * пройдёт — правило для него остаётся ошибкой.
     */
    files: [
      // 19.27–19.32: холст разбирается на composable, цель — 500–700 строк
      'apps/web/src/components/board/BoardCanvas.vue',
      // 19.19: формы и вкладки уезжают в отдельные компоненты и composable
      'apps/web/src/pages/RoomPage.vue',
    ],
    rules: { 'max-lines': 'off' },
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
    // HTTP-клиент — принадлежность слоя данных. Страница/компонент/стор, знающие
    // маршрут `/api/...`, форму FormData и коды ответов, перестают быть заменяемыми
    // и не тестируются без сети (находка W-5: холст сам маппил 413/400/403).
    // Класс `ApiError` не ограничен — разбирать ошибку в UI это нормально.
    // Единственное исключение — доменный слой `features/*/api`, который и так
    // живёт вне этого списка файлов и имеет право импортировать raw API-клиент.
    files: ['apps/web/src/pages/**', 'apps/web/src/components/**', 'apps/web/src/stores/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/api'],
              importNames: ['api', 'request'],
              message:
                'HTTP-запросы живут в features/*/api; UI и сторы не импортируют raw API-клиент.',
            },
          ],
        },
      ],
    },
  },
  {
    // Комнаты и доски не читают таблицы команд напрямую: права по членству
    // считает `access/team-access.ts` — единственное место, где членство
    // превращается в разрешение (19.10). Копия этой развилки в третьем сервисе
    // — это не дубль кода, а вторая точка отказа в авторизации.
    files: ['apps/server/src/rooms/**', 'apps/server/src/boards/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../teams', '../teams/*'],
              message:
                'Права по членству в команде спрашивают у TeamAccess (src/access), а не у TeamsRepository.',
            },
          ],
        },
      ],
    },
  },
  {
    // Контракт не должен зависеть ни от одного приложения — иначе он перестаёт
    // быть общим знаменателем и тянет за собой Vue или Fastify.
    files: ['packages/shared/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@poker/web', '@poker/server', '**/apps/**'],
              message: 'packages/shared — общий контракт, он не может зависеть от приложений.',
            },
          ],
        },
      ],
    },
  },
  {
    // 19.36: Vue Flow — только в адаптере и renderer-компонентах (см. шапку
    // vue-flow-adapter.ts). В lib/board и features/boards импорт @vue-flow/**
    // напрямую — протекание в домен/слой логики, где Vue Flow не должен жить.
    files: ['apps/web/src/features/boards/**/*.ts', 'apps/web/src/lib/board/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@vue-flow/**'],
              message:
                'Vue Flow должен использоваться только в адаптере (features/boards/adapters/vue-flow-adapter.ts) и renderer-компонентах (components/board); импорт @vue-flow прямо в features/boards — протечение.',
            },
          ],
        },
      ],
    },
  },
  {
    // Адаптер — разрешённая граница Vue Flow, правило для него отключено.
    files: ['apps/web/src/features/boards/adapters/vue-flow-adapter.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // 17.14/REFACTORING_PLAN п.1.2: одна фича не читает внутренности другой —
    // общее поднимается в lib/ или composables/, а не импортируется напрямую
    // из соседнего features/*. До сих пор это держалось только на дисциплине.
    files: ['apps/web/src/features/**/*.{ts,vue}'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: ['auth', 'boards', 'rooms', 'teams'].map((feature) => ({
            target: `./apps/web/src/features/${feature}`,
            from: './apps/web/src/features',
            except: [`./${feature}`],
            message:
              'features/a не импортирует features/b напрямую — общее поднимать в lib/ или composables/.',
          })),
        },
      ],
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
