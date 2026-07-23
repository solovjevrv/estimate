<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <section class="space-y-4">
    <h1 class="text-2xl font-semibold">{{ t('notFound.title') }}</h1>
    <p class="text-muted">{{ t('notFound.lead') }}</p>
    <UButton to="/">{{ t('notFound.home') }}</UButton>
  </section>
</template>
