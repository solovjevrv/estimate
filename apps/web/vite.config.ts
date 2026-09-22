/// <reference types="vitest/config" />
import ui from '@nuxt/ui/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

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
          slots: { base: 'font-bold' },
          variants: {
            size: {
              sm: { base: 'px-2.5 py-2 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-3 py-2.5 text-sm gap-2 rounded-r10' },
              lg: { base: 'px-4 py-3 text-base gap-2 rounded-r12' },
            },
          },
        },
        input: {
          variants: {
            size: {
              sm: { base: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-2.5 py-1.5 text-sm gap-1.5 rounded-r10' },
              lg: { base: 'px-3 py-2 text-sm gap-2 rounded-r12' },
            },
          },
        },
        // Тот же паттерн, что Input — тач ин-плейс редактор шага (BoardExportModal
        // и др.), в Figma отдельно не описан
        inputNumber: {
          variants: {
            size: {
              sm: { base: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-2.5 py-1.5 text-sm gap-1.5 rounded-r10' },
              lg: { base: 'px-3 py-2 text-sm gap-2 rounded-r12' },
            },
          },
        },
        select: {
          variants: {
            size: {
              sm: { base: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-2.5 py-1.5 text-sm gap-1.5 rounded-r10' },
              lg: { base: 'px-3 py-2 text-sm gap-2 rounded-r12' },
            },
          },
        },
        textarea: {
          variants: {
            size: {
              sm: { base: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-2.5 py-1.5 text-sm gap-1.5 rounded-r10' },
              lg: { base: 'px-3 py-2 text-sm gap-2 rounded-r12' },
            },
          },
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
        // (не Bold), иконка 16px, hover — заливка surface-secondary вместо
        // полупрозрачного оверлея по умолчанию.
        dropdownMenu: {
          slots: {
            content: 'rounded-r12 shadow-popup ring-0 bg-[var(--brand-surface)]',
            group: 'p-1.5',
          },
          variants: {
            size: {
              md: {
                item: 'rounded-r8 px-3 py-2.5 text-xs font-medium gap-2.5 data-highlighted:before:bg-surface-secondary data-[state=open]:before:bg-surface-secondary',
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
