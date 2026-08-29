<script setup lang="ts">
/**
 * UML database — классический «цилиндр» (Дениш/ER-нотация, часто встречается
 * и в UML-схемах компонентов данных). `preserveAspectRatio="none"`
 * растягивает схематичный цилиндр под фактические пропорции resize-бокса —
 * не пиксель-идеальная эллиптическая крышка при сильно вытянутых пропорциях,
 * но это MVP-упрощение, а не искажение самой семантики символа.
 */
defineProps<{
  fill: string;
  stroke: string;
}>();
</script>

<template>
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="uml-database-shape">
    <path
      d="M 5,12 L 5,88 A 45,10 0 0 0 95,88 L 95,12"
      :fill="fill"
      :stroke="stroke"
      stroke-width="3"
    />
    <ellipse cx="50" cy="12" rx="45" ry="10" :fill="fill" :stroke="stroke" stroke-width="3" />
  </svg>
</template>

<style scoped>
.uml-database-shape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
