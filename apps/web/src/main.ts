import ui from '@nuxt/ui/vue-plugin';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import './assets/main.css';
import { createAppI18n } from './i18n';
import { createAppRouter } from './router';
import { applyPostLoginRedirect } from './router/post-login';
import { useSessionStore } from './stores/session';

const app = createApp(App);
const pinia = createPinia();
const router = createAppRouter();

app.use(pinia).use(router).use(createAppI18n()).use(ui);
app.mount('#app');

// Если пользователь вернулся с экрана провайдера, уводим его туда, куда он шёл
// до входа (сервер всегда возвращает на «/»).
void applyPostLoginRedirect(router, useSessionStore(pinia));
