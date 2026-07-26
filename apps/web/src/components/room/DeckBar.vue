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
}>();

const emit = defineEmits<{ vote: [value: number]; reveal: [] }>();
</script>

<template>
  <div
    class="border-default bg-default/95 sticky bottom-0 left-0 right-0 -mx-4 border-t px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border"
  >
    <div class="mb-2 flex items-center justify-between">
      <h2 class="font-medium">{{ props.title }}</h2>
      <span class="text-muted text-sm">{{ props.votedCountText }}</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="card in props.cards"
        :key="card"
        :color="props.selectedValue === card ? 'primary' : 'neutral'"
        :variant="props.selectedValue === card ? 'solid' : 'outline'"
        @click="emit('vote', card)"
      >
        {{ props.cardLabel(card) }}
      </UButton>
    </div>
    <UButton
      v-if="props.isScrumMaster"
      class="mt-3"
      :loading="props.revealing"
      @click="emit('reveal')"
    >
      {{ props.revealLabel }}
    </UButton>
  </div>
</template>
