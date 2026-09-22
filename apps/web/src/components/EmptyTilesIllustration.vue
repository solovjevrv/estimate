<script setup lang="ts">
/**
 * Три плашки, средняя — зелёная: мотив пустого состояния из Estimate UI Kit
 * (компонент Empty) и 404-страницы (там та же идея крупнее — NotFoundPage.vue).
 * Параметризовано размером тайла, а не двумя копиями разметки.
 */
withDefaults(defineProps<{ tileWidth?: number; tileHeight?: number; radius?: string }>(), {
  tileWidth: 44,
  tileHeight: 58,
  radius: 'rounded-r10',
});
</script>

<template>
  <div class="flex gap-2">
    <div
      v-for="i in 3"
      :key="i"
      :style="{ width: `${tileWidth}px`, height: `${tileHeight}px` }"
      :class="[radius, i === 2 ? 'bg-surface-brand-low' : 'bg-surface-secondary']"
    />
  </div>
</template>
