<script setup lang="ts">
/** Чисто визуальная «дорожка» свитча темы (см. .design/main.html) — клик обрабатывает родитель */
defineProps<{ isDark: boolean }>();
</script>

<template>
  <span
    class="relative inline-block h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
    :class="isDark ? 'bg-[var(--ui-color-primary-500)]' : 'bg-[var(--brand-border)]'"
  >
    <span
      class="absolute top-[2px] size-[18px] rounded-full bg-white transition-[left] duration-150"
      :class="isDark ? 'left-[18px]' : 'left-[2px]'"
    />
  </span>
</template>
