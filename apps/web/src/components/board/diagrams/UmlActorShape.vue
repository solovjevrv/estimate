<script setup lang="ts">
/**
 * UML 2.5.1 actor — классический «человечек» (голова-окружность, торс,
 * руки, две ноги), контур без заливки. Только фигура — подпись рисует
 * `BoardDiagramNode.vue` под ней, тем же текстовым оверлеем, что и у
 * остальных kind (23.3).
 */
</script>

<template>
  <svg viewBox="0 0 40 66" preserveAspectRatio="xMidYMid meet" class="uml-actor-shape">
    <circle cx="20" cy="9" r="8" fill="none" stroke="currentColor" stroke-width="3" />
    <line
      x1="20"
      y1="17"
      x2="20"
      y2="44"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
    <line
      x1="4"
      y1="25"
      x2="36"
      y2="25"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
    <line
      x1="20"
      y1="44"
      x2="4"
      y2="64"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
    <line
      x1="20"
      y1="44"
      x2="36"
      y2="64"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.uml-actor-shape {
  width: 100%;
  height: 100%;
}
</style>
