<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

/** Кольцо-«монета»: используется и для согласия (реальный % заполнения), и для
 * среднего/мин/макс (заполнение декоративное, всегда полное) — единый визуальный стиль. */
const props = withDefaults(
  defineProps<{
    valueLabel: string;
    label: string;
    percent?: number;
    /** Ключевой показатель (победившая оценка) — StatRing IsWinner в 54_RoundResult */
    isWinner?: boolean;
  }>(),
  { percent: 100, isWinner: false },
);

const radius = 30;
const circumference = 2 * Math.PI * radius;
const targetOffset = computed(() => circumference * (1 - props.percent / 100));

/**
 * Кольцо монтируется уже с готовым значением — просто забиндить transition на
 * computed недостаточно, CSS-переход играет только на ИЗМЕНЕНИЕ уже отрисованного
 * значения. Стартуем с пустого кольца и переключаем на целевое значение кадром
 * позже, чтобы transition реально сыграл при появлении (вскрытие карт), а не
 * молча взял итоговое значение.
 */
const dashOffset = ref(circumference);
watch(targetOffset, (value) => {
  dashOffset.value = value;
});
onMounted(() => {
  requestAnimationFrame(() => {
    dashOffset.value = targetOffset.value;
  });
});
</script>

<template>
  <!-- 54_RoundResult / StatRing: кольцо 72px, обводка 4, трек border-medium, значение
       border-brand; IsWinner — заливка surface-brand-low -->
  <div class="flex flex-col items-center gap-2">
    <div class="relative flex h-[72px] w-[72px] items-center justify-center">
      <svg viewBox="0 0 72 72" class="absolute inset-0 -rotate-90">
        <circle
          cx="36"
          cy="36"
          :r="radius"
          :fill="props.isWinner ? 'var(--surface-brand-low)' : 'none'"
          stroke="var(--border-medium)"
          stroke-width="4"
        />
        <circle
          cx="36"
          cy="36"
          :r="radius"
          fill="none"
          stroke="var(--border-brand)"
          class="transition-[stroke-dashoffset] duration-700 ease-out"
          stroke-width="4"
          stroke-linecap="round"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="dashOffset"
        />
      </svg>
      <span class="text-text-primary relative text-base leading-6 font-bold tracking-[-0.01em]">{{
        props.valueLabel
      }}</span>
    </div>
    <span class="text-text-tertiary text-xs font-bold">{{ props.label }}</span>
  </div>
</template>
