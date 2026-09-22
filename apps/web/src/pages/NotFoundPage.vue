<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <section class="flex flex-col items-center py-16 text-center">
    <div class="mb-6 flex gap-2.5">
      <div
        v-for="(digit, i) in ['4', '0', '4']"
        :key="i"
        class="flex h-[100px] w-[78px] items-center justify-center rounded-r16 text-[34px] font-bold"
        :class="
          i === 1
            ? 'bg-surface-brand-low text-text-brand'
            : 'bg-surface-secondary text-text-secondary'
        "
      >
        {{ digit }}
      </div>
    </div>
    <h1 class="text-2xl font-bold">{{ t('notFound.title') }}</h1>
    <p class="text-muted mt-1.5 text-base font-medium">{{ t('notFound.lead') }}</p>
    <UButton to="/" size="lg" class="mt-6">{{ t('notFound.home') }}</UButton>
  </section>
</template>
