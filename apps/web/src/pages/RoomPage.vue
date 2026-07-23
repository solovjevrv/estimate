<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{ id: string }>();
</script>

<template>
  <section class="space-y-4">
    <h1 class="text-2xl font-semibold">{{ t('room.title') }}</h1>
    <p class="text-muted text-sm">{{ t('room.id', { id }) }}</p>
    <!-- Игровой стол и подключение к комнате — Epic 5 -->
    <p>{{ t('room.soon') }}</p>
  </section>
</template>
