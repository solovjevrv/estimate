<script setup lang="ts">
const props = defineProps<{
  title: string;
  subtitle: string;
  cards: readonly number[];
  cardLabel: (value: number) => string;
  selectedValue: number | null;
  isScrumMaster: boolean;
  /** Раунд уже вскрыт (20.3.6) — можно доголосовать/переголосовать, но вскрывать больше нечего */
  revealed: boolean;
  revealing: boolean;
  revealLabel: string;
  waitingForText: string | null;
}>();

const emit = defineEmits<{ vote: [value: number]; reveal: [] }>();
</script>

<template>
  <div class="surface-card surface-card-lg px-4 py-5 sm:px-8 sm:py-8">
    <div class="mb-6">
      <h2 class="font-heading text-text-secondary text-xl font-bold tracking-[-0.4px]">
        {{ props.title }}
      </h2>
      <p class="text-text-secondary mt-1 text-sm font-medium">{{ props.subtitle }}</p>
    </div>
    <div class="mb-[22px] flex flex-wrap gap-3">
      <button
        v-for="card in props.cards"
        :key="card"
        type="button"
        class="font-heading flex h-[74px] w-[58px] cursor-pointer items-center justify-center rounded-r12 text-xl font-bold tracking-[-0.4px] shadow-elevation-1 transition-[color,background-color,transform] duration-150 hover:-translate-y-1 active:scale-95"
        :class="
          props.selectedValue === card
            ? 'bg-surface-brand text-text-on-brand'
            : 'bg-surface-tertiary text-text-primary'
        "
        @click="emit('vote', card)"
      >
        {{ props.cardLabel(card) }}
      </button>
    </div>
    <!-- Status (07_Room): «Ждём: …» и кнопка вскрытия (Button Md) через 24 -->
    <div v-if="!props.revealed || props.waitingForText" class="flex flex-col items-start gap-6">
      <span v-if="props.waitingForText" class="text-text-secondary text-sm font-medium">
        {{ props.waitingForText }}
      </span>
      <UButton
        v-if="props.isScrumMaster && !props.revealed"
        class="w-full justify-center sm:w-auto"
        :loading="props.revealing"
        @click="emit('reveal')"
      >
        {{ props.revealLabel }}
      </UButton>
    </div>
  </div>
</template>
