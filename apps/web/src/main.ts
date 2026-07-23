import ui from '@nuxt/ui/vue-plugin';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import './assets/main.css';
import { createAppI18n } from './i18n';
import { createAppRouter } from './router';

createApp(App).use(createPinia()).use(createAppRouter()).use(createAppI18n()).use(ui).mount('#app');
