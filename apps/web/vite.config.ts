/// <reference types="vitest/config" />
import ui from '@nuxt/ui/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Figma (06_Input, Focus): рамка становится border-brand (зелёная), без
// внешнего свечения/кольца — у Nuxt UI дефолт для фокуса (color="primary",
// свой применяется по умолчанию, наш app.config цвет не переопределяет) —
// это focus-visible:outline-3 (полупрозрачный ореол шириной 3px) плюс
// focus-visible:ring-primary (--ui-primary — тот же не по месту применённый
// токен, что был в 20.12 у навигации: в тёмной теме темнее, чем наш
// border-brand). Тот же паттерн у Input/InputNumber/Select/Textarea — все
// используют один ring-based "outline" вариант из общей темы Nuxt UI.
const inputFocusFix = {
  color: 'primary',
  variant: 'outline',
  class: 'focus-visible:outline-none! focus-visible:ring-[var(--border-brand)]!',
};

export default defineConfig({
  plugins: [
    vue(),
    // Плагин сам поднимает автоимпорт компонентов и генерирует
    // auto-imports.d.ts и components.d.ts — оба файла в git не хранятся.
    // Размеры Button/Input/Select/Textarea/Modal — по факту компонентов
    // Estimate UI Kit в Figma (08_Button, 06_Input, 07_Select, 10_Textarea,
    // 27_Modal), не по формулам: радиусы 8/10/12 — токены --radius-r* из
    // assets/tokens.css (20.1), а не глобальный множитель --ui-radius
    // (тот продолжает отвечать за rounded-*, применяемые вне этих компонентов).
    ui({
      ui: {
        button: {
          // Nuxt UI сам не ставит cursor-pointer на активную (не disabled) кнопку —
          // только disabled:cursor-not-allowed. Без этого все UButton показывают
          // обычный курсор вместо pointer при наведении
          slots: { base: 'font-bold cursor-pointer' },
          variants: {
            size: {
              sm: { base: 'px-2.5 py-2 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-3 py-2.5 text-sm gap-2 rounded-r10' },
              lg: { base: 'px-4 py-3 text-base gap-2 rounded-r12' },
            },
          },
        },
        // Высоты — по факту Container (counterAxisSizingMode: FIXED) компонента
        // Input в Figma: 34/40/48, не по формуле padding+line-height (не сходится
        // на пару px, отсюда h-* явно, а не расчёт через py-*). Md/Lg — 40/48,
        // совпадает с кнопками той же ступени. Шрифт Md/Lg — 16px (text-base),
        // не text-sm, как ошибочно было при первом промере в 20.2. `md:text-base!`
        // не опечатка: у Nuxt UI в собственной теме Input зашит `md:text-sm`
        // (брейкпоинт вьюпорта, а не наш размер компонента); twMerge внутри их
        // tv()-конфига сохраняет именно их класс при конфликте в одной и той же
        // группе брейкпоинта, обычный `md:text-base` тут молча проигрывает —
        // побеждает только через `!important` (суффикс `!`).
        input: {
          variants: {
            size: {
              sm: { base: 'h-[34px] px-2.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'h-10 px-2.5 text-base md:text-base! gap-1.5 rounded-r10' },
              lg: { base: 'h-12 px-3 text-base md:text-base! gap-2 rounded-r12' },
            },
          },
          compoundVariants: [inputFocusFix],
        },
        // Тот же паттерн, что Input — тач ин-плейс редактор шага (BoardExportModal
        // и др.), в Figma отдельно не описан
        inputNumber: {
          variants: {
            size: {
              sm: { base: 'h-[34px] px-2.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'h-10 px-2.5 text-base md:text-base! gap-1.5 rounded-r10' },
              lg: { base: 'h-12 px-3 text-base md:text-base! gap-2 rounded-r12' },
            },
          },
          compoundVariants: [inputFocusFix],
        },
        select: {
          variants: {
            size: {
              sm: { base: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-2.5 py-1.5 text-sm gap-1.5 rounded-r10' },
              lg: { base: 'px-3 py-2 text-sm gap-2 rounded-r12' },
            },
          },
          compoundVariants: [inputFocusFix],
        },
        textarea: {
          variants: {
            size: {
              sm: { base: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-2.5 py-1.5 text-sm gap-1.5 rounded-r10' },
              lg: { base: 'px-3 py-2 text-sm gap-2 rounded-r12' },
            },
          },
          compoundVariants: [inputFocusFix],
        },
        modal: {
          slots: {
            overlay: 'bg-black/40',
            content:
              'w-[calc(100%-2rem)] max-w-[420px] rounded-r24 shadow-modal ring-0 divide-y-0 bg-[var(--brand-surface)]',
            header: 'p-6 pb-0',
            body: 'p-6 pt-4',
            footer: 'p-6 pt-4 justify-end gap-2',
            title: 'font-heading text-xl font-bold',
            description: 'mt-1 text-sm font-medium',
          },
        },
        // По факту компонента DropdownMenu в Kit (35_DropdownMenu) — раньше не
        // было пресета вовсе, меню жило на чистых дефолтах Nuxt UI (нашёл
        // пользователь по свежесобранному меню участника, 20.3.3). Контейнер
        // r12/Shadow-Popup/паддинг 6, пункт 36px/r8/паддинг 12×9/шрифт 12 Medium
        // (не Bold), иконка 16px. Цвет hover — не здесь: и Button (ghost/neutral),
        // и пункт меню красятся Nuxt UI через bg-elevated, поэтому сам цвет
        // (surface-secondary) фиксирован один раз в токене --ui-bg-elevated
        // (main.css), не дублируется в пресетах. items-center и before:rounded-r8
        // — свои дефолты Nuxt UI (items-start, before:rounded-md) не сверены с
        // китом: из-за items-start пункт с доп. контентом в trailing-слоте
        // (переключатель темы) не центрируется по вертикали относительно лейбла.
        dropdownMenu: {
          slots: {
            content: 'rounded-r12 shadow-popup ring-0 bg-[var(--brand-surface)]',
            group: 'p-1.5',
          },
          variants: {
            size: {
              md: {
                item: 'items-center rounded-r8 px-3 py-2.5 text-xs font-medium gap-2.5 before:rounded-r8',
                itemLeadingIcon: 'size-4',
                itemTrailingIcon: 'size-4',
              },
            },
          },
        },
      },
    }),
  ],
  define: {
    // Флаги сборки vue-i18n: работаем только через Composition API,
    // поэтому поддержка Options API и панель разработчика в бандл не нужны
    __VUE_I18N_FULL_INSTALL__: 'false',
    __VUE_I18N_LEGACY_API__: 'false',
    __INTLIFY_PROD_DEVTOOLS__: 'false',
    // Короткий git-хэш сборки для футера (CD прокидывает через APP_VERSION,
    // см. Dockerfile/docker-compose.prod.yml); локально — просто 'dev'
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
  },
  server: {
    port: 5173,
    // Дев-фронт ходит теми же путями, что прод через nginx
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Сценарии Playwright запускает свой раннер
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
