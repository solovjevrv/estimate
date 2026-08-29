<script setup lang="ts">
/**
 * Значок UML component — два маленьких прямоугольника-«разъёма» на левом
 * крае — рисуется поверх обычного прямоугольного бокса `BoardDiagramNode.vue`
 * (23.3), не сам бокс. Фиксированный пиксельный размер, не масштабируется с
 * элементом — как и в остальных UML-тулах, значок остаётся читаемым на любом
 * зуме, только позиция крепится к верхнему левому углу бокса.
 */
</script>

<template>
  <svg viewBox="0 0 16 20" class="uml-component-icon" aria-hidden="true">
    <rect
      x="0"
      y="2"
      width="8"
      height="5"
      fill="currentColor"
      fill-opacity="0.15"
      stroke="currentColor"
      stroke-width="1.5"
    />
    <rect
      x="0"
      y="12"
      width="8"
      height="5"
      fill="currentColor"
      fill-opacity="0.15"
      stroke="currentColor"
      stroke-width="1.5"
    />
    <rect x="3" y="0" width="13" height="19" fill="none" stroke="currentColor" stroke-width="1.5" />
  </svg>
</template>

<style scoped>
.uml-component-icon {
  width: 18px;
  height: 22px;
}
</style>
