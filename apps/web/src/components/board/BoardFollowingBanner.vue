<script setup lang="ts">
/**
 * Плашка «Вы следите за …» (14.5) — та же пилюля-подложка, что и у presence,
 * без лишней внутренней карточки: текст + компактная кнопка закрытия.
 * Родитель показывает её, только когда есть за кем следить (`followedName`).
 * Вынесена из `BoardCanvas.vue` (17.1).
 */
import { Panel } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

defineProps<{
  name: string;
}>();

const emit = defineEmits<{
  stop: [];
}>();

const { t } = useI18n();
</script>

<template>
  <Panel position="top-center">
    <div data-testid="board-following" class="board-following surface-card flex items-center">
      <span class="board-following-label">
        {{ t('board.followingPrefix') }}
        <span class="board-following-name">{{ name }}</span>
      </span>
      <button
        type="button"
        class="board-following-stop"
        :aria-label="t('board.stopFollowing')"
        @click="emit('stop')"
      >
        <UIcon name="i-lucide-x" class="size-3.5" />
      </button>
    </div>
  </Panel>
</template>

<style scoped>
.board-following {
  gap: 8px;
  height: 32px;
  padding: 0 8px 0 14px;
  border-radius: 16px;
}

.board-following-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand-ink);
  white-space: nowrap;
}

.board-following-name {
  color: var(--brand-primary-text);
}

.board-following-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  color: var(--brand-ink2);
  transition: background-color 0.15s ease;
}

.board-following-stop:hover {
  background: var(--ui-bg);
}
</style>
