<script setup lang="ts">
defineProps<{
  tabs: { key: string; label: string }[];
  modelValue: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [key: string] }>();
</script>

<template>
  <div class="flex items-center gap-8 border-b border-default">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="relative cursor-pointer pb-2.5 text-base font-bold transition-colors"
      :class="
        modelValue === tab.key ? 'text-text-brand' : 'text-text-secondary hover:text-text-primary'
      "
      @click="emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
      <span
        v-if="modelValue === tab.key"
        class="bg-text-brand absolute inset-x-0 -bottom-px h-[3px]"
      />
    </button>
  </div>
</template>
