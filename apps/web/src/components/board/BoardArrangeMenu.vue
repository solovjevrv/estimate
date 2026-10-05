<script setup lang="ts">
/**
 * Меню «Разложить» из тулбара выделения (15.4, кит — BoardArrangeMenu):
 * по голосам — сеткой по убыванию точек, по цвету и по автору — фрейм на
 * кучку. «По голосам» недоступно, пока не открыты итоги голосования, в
 * котором были выделенные элементы (вариант NoVotes).
 */
import { useI18n } from 'vue-i18n';

import type { BoardArrangeMode } from '../../features/boards/domain/board-arrange';

defineProps<{ canByVotes: boolean }>();

const emit = defineEmits<{ pick: [mode: BoardArrangeMode] }>();

const { t } = useI18n();

const MODES: readonly { mode: BoardArrangeMode; icon: string }[] = [
  { mode: 'votes', icon: 'i-lucide-arrow-down-wide-narrow' },
  { mode: 'color', icon: 'i-lucide-palette' },
  { mode: 'author', icon: 'i-lucide-users' },
];
</script>

<template>
  <div data-testid="board-arrange-menu" class="board-arrange-menu">
    <div class="text-text-tertiary px-2.5 pt-1.5 pb-0.5 text-xs leading-[18px] font-bold">
      {{ t('board.arrange.menuTitle') }}
    </div>
    <button
      v-for="item in MODES"
      :key="item.mode"
      type="button"
      :data-testid="`board-arrange-${item.mode}`"
      class="board-arrange-menu-item"
      :disabled="item.mode === 'votes' && !canByVotes"
      :title="
        item.mode === 'votes' && !canByVotes ? t('board.arrange.votesUnavailable') : undefined
      "
      @click="emit('pick', item.mode)"
    >
      <UIcon :name="item.icon" class="board-arrange-menu-icon size-4" />
      <span class="text-sm font-medium">{{ t(`board.arrange.${item.mode}`) }}</span>
    </button>
  </div>
</template>

<style scoped>
/* BoardArrangeMenu: 220, паддинг 6, шаг 4; пункт — MenuItem (9/12, шаг 10) */
.board-arrange-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 220px;
  padding: 6px;
}

.board-arrange-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  color: var(--text-primary);
  cursor: pointer;
}

.board-arrange-menu-icon {
  color: var(--icons-primary);
}

.board-arrange-menu-item:hover:not(:disabled) {
  background: var(--surface-hover);
}

.board-arrange-menu-item:disabled {
  color: var(--text-disabled);
  cursor: default;
}

.board-arrange-menu-item:disabled .board-arrange-menu-icon {
  color: var(--icons-disabled);
}
</style>
