<script setup lang="ts">
import { FIBONACCI_DECK } from '@poker/shared';
</script>

<template>
  <main class="app">
    <h1>Planning Poker</h1>
    <p>Каркас приложения готов. Колода Фибоначчи: {{ FIBONACCI_DECK.join(', ') }}</p>
  </main>
</template>

<style scoped>
.app {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: system-ui, sans-serif;
  text-align: center;
}
</style>
