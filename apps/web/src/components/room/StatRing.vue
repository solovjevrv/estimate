<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

/** Кольцо-«монета»: используется и для согласия (реальный % заполнения), и для
 * среднего/мин/макс (заполнение декоративное, всегда полное) — единый визуальный стиль. */
const props = withDefaults(
  defineProps<{
    valueLabel: string;
    label: string;
    percent?: number;
  }>(),
  { percent: 100 },
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
  <div class="flex flex-col items-center gap-1">
    <div class="relative flex h-[72px] w-[72px] items-center justify-center">
      <svg viewBox="0 0 72 72" class="absolute inset-0 -rotate-90">
        <circle
          cx="36"
          cy="36"
          :r="radius"
          fill="none"
          stroke="currentColor"
          class="text-default opacity-20"
          stroke-width="8"
        />
        <circle
          cx="36"
          cy="36"
          :r="radius"
          fill="none"
          stroke="currentColor"
          class="text-primary transition-[stroke-dashoffset] duration-700 ease-out"
          stroke-width="8"
          stroke-linecap="round"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="dashOffset"
        />
      </svg>
      <span class="relative text-sm font-semibold">{{ props.valueLabel }}</span>
    </div>
    <span class="text-muted text-xs">{{ props.label }}</span>
  </div>
</template>
