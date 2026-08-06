<script setup lang="ts">
/**
 * Левый вертикальный тулбар инструментов холста (12.6) — позиция/чехол по
 * референсу `.design/main.html` (`top:50%; left:20px`, кнопки 40×40, radius 11).
 * Из макета сознательно взяты только «Выделение»/«Стикер»: остальные пять
 * иконок (фигура/стрелка/текст/картинка/эмодзи) относятся к ещё не
 * реализованным задачам (12.7+) — рендерить их сейчас значило бы дать
 * нерабочие кнопки.
 */
import { useI18n } from 'vue-i18n';

export type BoardTool = 'select' | 'sticky';

const tool = defineModel<BoardTool>({ required: true });

const { t } = useI18n();

function isActive(value: BoardTool): boolean {
  return tool.value === value;
}
</script>

<template>
  <div class="board-toolbar" @click.stop>
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('select') }"
      :aria-label="t('board.toolSelect')"
      :aria-pressed="isActive('select')"
      @click="tool = 'select'"
    >
      <UIcon name="i-lucide-mouse-pointer-2" class="size-[19px]" />
    </button>
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('sticky') }"
      :aria-label="t('board.toolSticky')"
      :aria-pressed="isActive('sticky')"
      @click="tool = 'sticky'"
    >
      <UIcon name="i-lucide-sticky-note" class="size-[19px]" />
    </button>
  </div>
</template>

<style scoped>
.board-toolbar {
  position: absolute;
  top: 50%;
  left: 20px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--brand-surface);
  border-radius: 16px;
  box-shadow: var(--brand-shadow-card);
  transform: translateY(-50%);
}

.board-toolbar-btn {
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  color: var(--brand-ink);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 11px;
}

.board-toolbar-btn:hover {
  background: var(--ui-bg-elevated);
}

.board-toolbar-btn-active {
  color: white;
  background: var(--ui-primary);
}

.board-toolbar-btn-active:hover {
  background: var(--ui-primary);
}
</style>
