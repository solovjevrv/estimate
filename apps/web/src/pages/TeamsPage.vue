<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <section class="space-y-4">
    <h1 class="text-2xl font-semibold">{{ t('teams.title') }}</h1>
    <!-- Список команд появится в задаче 3.2 -->
    <p class="text-muted">{{ t('teams.empty') }}</p>
  </section>
</template>
