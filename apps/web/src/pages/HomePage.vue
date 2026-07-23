<script setup lang="ts">
import { FIBONACCI_DECK } from '@poker/shared';
import { useI18n } from 'vue-i18n';

import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const session = useSessionStore();
</script>

<template>
  <section class="space-y-6">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">{{ t('app.name') }}</h1>
      <p class="text-muted">{{ t('app.tagline') }}</p>
    </div>

    <p>{{ t('home.lead') }}</p>
    <p class="text-muted text-sm">{{ t('home.deck', { cards: FIBONACCI_DECK.join(', ') }) }}</p>

    <UButton v-if="session.isAuthenticated" to="/teams">{{ t('home.startWithTeam') }}</UButton>
    <UButton v-else to="/login">{{ t('home.startAsGuest') }}</UButton>
  </section>
</template>
