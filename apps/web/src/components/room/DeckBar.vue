<script setup lang="ts">
const props = defineProps<{
  title: string;
  votedCountText: string;
  cards: readonly number[];
  cardLabel: (value: number) => string;
  selectedValue: number | null;
  isScrumMaster: boolean;
  revealing: boolean;
  revealLabel: string;
  waitingForText: string | null;
}>();

const emit = defineEmits<{ vote: [value: number]; reveal: [] }>();
</script>

<template>
  <div class="surface-card surface-card-lg px-[30px] py-[26px]">
    <div class="mb-[22px] flex items-center justify-between gap-3">
      <h2 class="text-muted text-sm font-bold tracking-[0.03em] uppercase">{{ props.title }}</h2>
      <span class="text-muted text-sm font-bold">{{ props.votedCountText }}</span>
    </div>
    <div class="mb-[22px] flex flex-wrap gap-3">
      <button
        v-for="card in props.cards"
        :key="card"
        type="button"
        class="font-heading flex h-[74px] w-[58px] cursor-pointer items-center justify-center rounded-[12px] text-lg font-extrabold transition-[color,background-color,transform] duration-150 hover:-translate-y-1 active:scale-95"
        :class="
          props.selectedValue === card
            ? 'bg-primary text-white'
            : 'bg-[var(--brand-well-bg)] text-[var(--brand-ink)] shadow-[inset_0_0_0_1px_var(--brand-outline-border)]'
        "
        @click="emit('vote', card)"
      >
        {{ props.cardLabel(card) }}
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-3.5">
      <UButton
        v-if="props.isScrumMaster"
        class="rounded-[12px] px-[26px] py-3.5 text-[15px] font-bold"
        :loading="props.revealing"
        @click="emit('reveal')"
      >
        {{ props.revealLabel }}
      </UButton>
      <span v-if="props.waitingForText" class="text-muted text-[13.5px]">
        {{ props.waitingForText }}
      </span>
    </div>
  </div>
</template>
