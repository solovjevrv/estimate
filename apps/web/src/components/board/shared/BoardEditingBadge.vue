<script setup lang="ts">
/**
 * Индикатор мягкой блокировки текстового редактирования (14.2) — «Имя печатает…»
 * над элементом, который сейчас редактирует другой участник. Переиспользуется
 * во всех трёх текстовых нодах (Sticky/Shape/Text), чтобы не тройной раз копировать
 * разметку/стили — по образцу общих `shared/board-toolbar.css` и т.п.
 *
 * Позиционируется в левом-верхнем углу карточки: корневой элемент каждой ноды
 * имеет `relative`, так что `absolute` здесь — относительно самой карточки.
 */
import { useI18n } from 'vue-i18n';

defineProps<{ name: string }>();
const { t } = useI18n();
</script>

<template>
  <div class="board-editing-badge">
    {{ t('board.editingBy', { name }) }}
  </div>
</template>

<style scoped>
.board-editing-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 1;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--brand-surface);
  box-shadow: var(--brand-shadow-card);
  font-size: 10px;
  font-weight: 600;
  color: var(--brand-ink2);
  white-space: nowrap;
  pointer-events: none;
}
</style>
