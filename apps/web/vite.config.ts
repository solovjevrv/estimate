/// <reference types="vitest/config" />
import ui from '@nuxt/ui/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    vue(),
    // Плагин сам поднимает автоимпорт компонентов и генерирует
    // auto-imports.d.ts и components.d.ts — оба файла в git не хранятся
    ui(),
  ],
  define: {
    // Флаги сборки vue-i18n: работаем только через Composition API,
    // поэтому поддержка Options API и панель разработчика в бандл не нужны
    __VUE_I18N_FULL_INSTALL__: 'false',
    __VUE_I18N_LEGACY_API__: 'false',
    __INTLIFY_PROD_DEVTOOLS__: 'false',
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
